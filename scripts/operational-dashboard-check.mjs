import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { startSandbox } from "./visual-refresh/sandbox.mjs";
import { addCalendarDays, companyDate, companyDayWindow } from "../artifacts/api-server/src/lib/companyCalendar.ts";

const report = "reports/task-dates-inbound-funnel-2026-10-13";
await mkdir(report, { recursive: true });
const fixture = await startSandbox({ build: false, port: 4430 });
let browser;
const evidence = { syntheticOnly: true, outboundDeliveryBlocked: true, roles: {}, browserFailures: [], assertions: [] };
try {
  const today = companyDate();
  const window = companyDayWindow();
  const old = new Date(window.start.getTime() - 48 * 3_600_000).toISOString();
  const recent = new Date(window.start.getTime() - 2 * 3_600_000).toISOString();
  const callTime = new Date(window.start.getTime() + 3_600_000).toISOString();
  fixture.seedFixture(`INSERT INTO leads (id,first_name,last_name,company_name,status,assigned_rep_id,lead_source,created_at) VALUES
    (10,'Synthetic','History','History fixture','approved',3,'manual','2026-09-15'),
    (11,'Synthetic','Submitted','Submitted fixture','submitted_to_underwriting',3,'manual','2026-09-15'),
    (12,'Synthetic','Other','Other rep fixture','approved',1,'manual','2026-09-15'),
    (13,'Synthetic','Old','Old cohort fixture','submitted_to_underwriting',3,'manual','2020-01-01'),
    (14,'Synthetic','Logged','Logged submission fixture','approved',3,'manual','2026-09-15'),
    (15,'Synthetic','Unsent','Unsent fixture','new_lead',3,'manual','2026-09-15'),
    (21,'Synthetic','Website','Old website fixture','new_lead',NULL,'website','${old}'),
    (22,'Synthetic','Qr','Old QR fixture','new_lead',NULL,'qr-card','${old}'),
    (23,'Synthetic','Recent','Recent intake fixture','new_lead',NULL,'qr-card','${recent}'),
    (24,'Synthetic','Manual','Manual fixture','new_lead',NULL,'manual','${old}'),
    (25,'Synthetic','Assigned','Assigned intake fixture','new_lead',3,'website','${old}')
    RETURNING id;`);
  fixture.seedFixture(`INSERT INTO lead_status_history (lead_id,from_status,to_status,changed_by_user_id) VALUES
    (10,'new_lead','contacted',3),(10,'application_received','contacted',3),
    (12,'new_lead','contacted',1) RETURNING id;`);
  fixture.seedFixture(`INSERT INTO lender_submissions (lead_id,lender_id,status,source) VALUES
    (11,1,'submitted','manual'),(12,1,'approved','manual'),
    (14,1,'submitted','manual'),(14,1,'declined','manual') RETURNING id;`);
  fixture.seedFixture(`INSERT INTO tasks (id,lead_id,user_id,title,due_date,is_completed) VALUES
    (101,1,3,'Today rep','${today}',false),(102,1,3,'Yesterday rep','${addCalendarDays(today, -1)}',false),
    (103,1,3,'Completed rep','${addCalendarDays(today, -1)}',true),
    (104,1,3,'Tomorrow rep','${addCalendarDays(today, 1)}',false),
    (105,12,1,'Other ownership','${today}',false),
    (106,1,2,'Today manager','${today}',false),(107,1,2,'Yesterday manager','${addCalendarDays(today, -1)}',false)
    RETURNING id;`);
  fixture.seedFixture(`INSERT INTO communications (id,lead_id,type,direction,status,call_outcome,twilio_sid,created_at) VALUES
    (101,1,'call','inbound','completed','connected','CA-synthetic-answer','${callTime}'),
    (102,1,'call','inbound','no-answer','no_answer','CA-synthetic-missed','${callTime}'),
    (103,1,'call','inbound','completed','voicemail','CA-synthetic-voicemail','${callTime}'),
    (104,1,'call','inbound','completed',NULL,'CA-synthetic-voicemail','${callTime}'),
    (105,NULL,'call','inbound','ringing',NULL,'CA-synthetic-progress','${callTime}'),
    (106,1,'call','inbound','completed','connected','CA-synthetic-old','${new Date(window.start.getTime() - 1).toISOString()}'),
    (107,1,'call','outbound','completed','connected','CA-synthetic-outbound','${callTime}'),
    (108,1,'call','inbound','completed','connected','CA-synthetic-future','${window.end.toISOString()}')
    RETURNING id;`);
  browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", headless: true, args: ["--no-sandbox"] });
  for (const role of ["admin", "manager", "rep"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 980 }, serviceWorkers: "block" });
    const page = await context.newPage();
    page.on("response", response => {
      if ([403, 404, 503].includes(response.status())) evidence.browserFailures.push({ role, path: new URL(response.url()).pathname, status: response.status() });
    });
    await fixture.login(page, role);
    await page.goto(`${fixture.url}/dashboard`);
    const get = async path => {
      const result = await page.evaluate(async path => {
        const response = await fetch(path);
        return { status: response.status, data: await response.json() };
      }, path);
      assert.equal(result.status, 200, `${role} ${path}`);
      return result.data;
    };
    const tasks = await get("/api/dashboard/my-tasks");
    assert.ok(tasks.dueToday.every(task => task.dueDate === today));
    assert.ok(tasks.overdue.every(task => task.dueDate < today && !task.isCompleted));
    if (role === "manager") {
      assert.deepEqual(tasks.dueToday.map(task => task.id), [106]);
      assert.deepEqual(tasks.overdue.map(task => task.id), [107]);
    }
    if (role === "rep") {
      assert.ok(tasks.dueToday.some(task => task.id === 101));
      assert.ok(!tasks.dueToday.some(task => task.id === 105));
      assert.ok(tasks.overdue.some(task => task.id === 102));
      assert.ok(!tasks.overdue.some(task => task.id === 103));
    }
    const calls = await get("/api/dashboard/calls");
    assert.equal(calls.inboundCount, role === "rep" ? 3 : 4);
    assert.equal(calls.answeredCount, 1);
    assert.equal(calls.voicemailCount, 1);
    const result = { tasks, calls };
    if (role !== "rep") {
      const pipeline = await get("/api/analytics/pipeline?start_date=2026-09-01&end_date=2026-12-01");
      const repPipeline = await get("/api/analytics/pipeline?start_date=2026-09-01&end_date=2026-12-01&rep_id=3");
      assert.equal(pipeline.stages.find(stage => stage.status === "contacted").count, 3);
      assert.equal(pipeline.stages.find(stage => stage.status === "submitted_to_underwriting").count, 3);
      assert.equal(repPipeline.stages.find(stage => stage.status === "contacted").count, 2);
      assert.equal(repPipeline.stages.find(stage => stage.status === "submitted_to_underwriting").count, 2);
      result.pipeline = pipeline; result.repPipeline = repPipeline;
    }
    if (role === "admin") {
      result.inbound = await get("/api/analytics/unassigned-inbound-count");
      assert.equal(result.inbound.count, 2);
      assert.equal(result.inbound.inboundCallsToday, 4);
      assert.equal(result.inbound.totalCount, 6);
      assert.equal(result.inbound.answeredCallsToday, 1);
      assert.equal(result.inbound.missedCallsToday, 1);
      assert.equal(result.inbound.voicemailCallsToday, 1);
      assert.equal(result.inbound.otherCallsToday, 1);
      await page.waitForFunction(() => document.querySelector('[data-testid="dashboard-inbound"]')?.textContent?.includes("Inbound: 6"));
      await page.locator("#calls-today").getByText("4", { exact: true }).waitFor();
      await page.screenshot({ path: `${report}/dashboard-admin.png` });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: `${report}/dashboard-mobile.png` });
    }
    evidence.roles[role] = result;
    await context.close();
  }
  assert.deepEqual(evidence.browserFailures, []);
  evidence.assertions.push("PASS company date and strict-overdue HTTP responses for all roles",
    "PASS completed tasks excluded and rep lead ownership retained",
    "PASS existing intake predicate plus distinct answered/missed/voicemail/in-progress calls",
    "PASS local day boundaries; yesterday, future and outbound calls excluded",
    "PASS current Contacted and recorded Contacted history, deduplicated",
    "PASS current Submitted or logged lender submissions, deduplicated",
    "PASS lead creation cohort and rep filter retained",
    "PASS no 403/404/503 requests for admin/manager/rep dashboards");
} finally {
  await browser?.close();
  evidence.cleanup = await fixture.close();
  await writeFile(`${report}/fixture-results.json`, JSON.stringify(evidence, null, 2) + "\n");
}
console.log(evidence.assertions.join("\n"));
console.log("Cleanup:", JSON.stringify(evidence.cleanup));
