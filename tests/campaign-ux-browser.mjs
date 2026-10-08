import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { startSandbox } from "../scripts/visual-refresh/sandbox.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDir = resolve(root, "reports/campaign-ux/browser");
const webRoot = resolve(root, "artifacts/mbs-crm/dist/public");
const report = { candidate: ".local/campaign-ux-source", parent: "5177557", checks: [], unexpectedHttp: [], fixtureIds: {}, screenshots: [], cleanup: null };
const check = (name, pass, detail = "") => report.checks.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 500) });
const assert = (name, condition, detail = "") => check(name, condition, detail);
let sandbox, browser, context, page;
const api = async (path, method = "GET", rolePage = page) => rolePage.evaluate(async ({ path, method }) => {
  const r = await fetch(path, { method, credentials: "include" });
  return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) };
}, { path, method });
const campaignSql = (name, status, owner = 1, rules = "{}", dates = "") =>
  `INSERT INTO campaigns(name,status,channel,owner_id,created_by,audience_rules${dates ? ",launched_at,completed_at" : ""}) VALUES ('${name}','${status}','email',${owner},${owner},'${rules}'::jsonb${dates ? `,'2026-09-01','2026-09-02'` : ""}) RETURNING id`;
const seedCampaign = (name, status, owner = 1, rules = "{}", dates = "") =>
  Number(sandbox.seedFixture(campaignSql(name, status, owner, rules, dates)));
const seedLaunch = (campaignId, mode, status, counts = "0,0,0,0") =>
  Number(sandbox.seedFixture(`INSERT INTO campaign_launches(campaign_id,idempotency_key,requested_by,mode,status,eligible_count,excluded_count,sent_count,failed_count) VALUES (${campaignId},'fixture-${campaignId}-${mode}-${status}',1,'${mode}','${status}',${counts}) RETURNING id`));
const seedRecipient = (campaignId, launchId, leadId, status, reason = null, sentAt = null) => {
  const why = reason ? `'${reason}'` : "NULL", sent = sentAt ? `'${sentAt}'` : "NULL";
  return Number(sandbox.seedFixture(`INSERT INTO campaign_recipients(campaign_id,launch_id,lead_id,channel,status,exclusion_reason,sent_at) VALUES (${campaignId},${launchId},${leadId},'email','${status}',${why},${sent}) RETURNING id`));
};
const goCampaign = async id => { await page.goto(`${sandbox.url}/campaigns/${id}`); await page.getByTestId("campaign-stepper").or(page.getByTestId("tab-results")).waitFor({ state: "visible", timeout: 10000 }); };
const resultSnapshot = async id => api(`/api/campaigns/${id}/results`);
const adminFetch = async (id, suffix, method) => api(`/api/campaigns/${id}${suffix}`, method);

try {
  await mkdir(evidenceDir, { recursive: true });
  sandbox = await startSandbox({ build: false, port: 4360, webRoot });
  console.log("sandbox-ready");
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? "/repl/tools/bin/chromium" });
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "UTC" });
  page = await context.newPage();
  const responseErrors = [];
  page.on("response", r => { if (r.url().includes("/api/") && [403,404,503].includes(r.status())) responseErrors.push({ status: r.status(), path: new URL(r.url()).pathname }); });
  await sandbox.login(page, "admin");
  console.log("admin-authenticated");
  await page.goto(`${sandbox.url}/campaigns`);
  await page.getByTestId("button-create-campaign").waitFor();

  // Create and delete a never-approved, never-launched campaign through the UI.
  await page.getByTestId("button-create-campaign").click();
  await page.getByLabel("Campaign Name").fill("Synthetic Journey Draft");
  await page.getByRole("button", { name: "Create Campaign" }).click();
  await page.waitForURL(/\/campaigns\/\d+$/);
  const disposableId = Number(page.url().split("/").at(-1));
  report.fixtureIds.disposableDraft = disposableId;
  const stepper = page.getByTestId("campaign-stepper");
  const stepTexts = await stepper.innerText();
  assert("Draft shows exactly four in-page steps", (await stepper.locator("button").count()) === 4 && ["Content", "Audience", "Review", "Launch"].every(t => stepTexts.includes(t)), stepTexts);
  assert("Draft has no second tab navigation", (await page.getByRole("tab").count()) === 0);
  for (const step of ["content", "audience", "review", "launch"]) {
    await page.getByTestId(`step-${step}`).click();
    assert(`Draft ${step} step stays on same campaign route`, new URL(page.url()).pathname === `/campaigns/${disposableId}`);
  }
  await page.getByTestId("campaign-delete").click();
  assert("Delete confirmation names campaign", (await page.getByRole("dialog").innerText()).includes("Synthetic Journey Draft"));
  await page.getByTestId("campaign-confirm-delete").click();
  await page.waitForURL(/\/campaigns$/);
  const deletedList = await api("/api/campaigns");
  assert("Confirmed delete hides draft from list", !deletedList.body.some(c => c.id === disposableId));
  const deletedDetail = await api(`/api/campaigns/${disposableId}`);
  assert("Confirmed delete hides detail", deletedDetail.status === 404, `status=${deletedDetail.status}`);

  // Approval history and every launch mode, including dry_run, permanently bar deletion.
  const approvalDraft = seedCampaign("Guarded Approval Draft", "draft");
  const dryRunDraft = seedCampaign("Guarded Dry Run Draft", "draft");
  report.fixtureIds.approvalDraft = approvalDraft; report.fixtureIds.dryRunDraft = dryRunDraft;
  sandbox.seedFixture(`INSERT INTO campaign_approvals(campaign_id,approval_type,content_version,approved_by) VALUES (${approvalDraft},'campaign',1,1) RETURNING id`);
  seedLaunch(dryRunDraft, "dry_run", "completed", "1,0,0,0");
  for (const id of [approvalDraft, dryRunDraft]) {
    const detail = await api(`/api/campaigns/${id}`);
    assert(`Historical approval/launch campaign ${id} reports canDelete false`, detail.body?.campaign?.canDelete === false || detail.body?.canDelete === false);
    const del = await adminFetch(id, "", "DELETE");
    assert(`Historical approval/launch campaign ${id} DELETE returns 409`, del.status === 409, `status=${del.status}`);
  }

  // Lifecycle fixtures include every archivable state plus ineligible active/approved states.
  const archivable = Object.fromEntries(["draft", "completed", "cancelled", "failed"].map(s => [s, seedCampaign(`Archive ${s}`, s, 1, "{}", s === "completed" ? "dates" : "")]));
  const approved = seedCampaign("Archive Guard Approved", "approved");
  const running = seedCampaign("Archive Guard Running", "running");
  report.fixtureIds.archivable = archivable; report.fixtureIds.active = { approved, running };
  for (const id of [approved, running]) {
    const blocked = await adminFetch(id, "/archive", "POST");
    assert(`Active/approved campaign ${id} archive returns 409`, blocked.status === 409, `status=${blocked.status}`);
  }
  // Use the visible control for draft archive and restore; exercise the other lifecycle statuses by API.
  await goCampaign(archivable.draft);
  assert("Admin sees Archive for eligible draft", await page.getByTestId("campaign-archive").isVisible());
  await page.getByTestId("campaign-archive").click();
  await page.waitForTimeout(400);
  let list = await api("/api/campaigns");
  assert("Archive hides campaign from default list", !list.body.some(c => c.id === archivable.draft));
  await page.goto(`${sandbox.url}/campaigns`);
  await page.getByTestId("checkbox-show-archived").click();
  await page.getByText("Archive draft", { exact: true }).waitFor();
  assert("Show archived reveals archived draft", true);
  await goCampaign(archivable.draft);
  assert("Admin sees Unarchive for archived draft", await page.getByTestId("campaign-unarchive").isVisible());
  await page.getByTestId("campaign-unarchive").click();
  await page.waitForTimeout(400);
  list = await api("/api/campaigns");
  assert("Unarchive restores campaign to default list", list.body.some(c => c.id === archivable.draft));
  for (const status of ["completed", "cancelled", "failed"]) {
    const r = await adminFetch(archivable[status], "/archive", "POST");
    assert(`${status} campaign archive succeeds`, r.status === 200, `status=${r.status}`);
  }
  console.log("lifecycle-verified");

  // Recovery family: root recipients are synthetic; a child sent one and one excluded lead remains.
  const root = seedCampaign("Recovery Root", "cancelled");
  const childDraft = seedCampaign("Recovery Draft Child", "draft", 1, `{"remainingFromCampaignId":${root},"remainingRootCampaignId":${root},"pickedLeadIds":[1]}`);
  const rootLaunch = seedLaunch(root, "live", "cancelled", "2,1,1,0");
  const childLaunch = seedLaunch(childDraft, "live", "queued", "1,0,0,0");
  const suppressedLead = Number(sandbox.seedFixture(`INSERT INTO leads(email,is_unsubscribed,application_type,status,lead_source) VALUES ('suppressed@example.invalid',true,'working_capital','new_lead','manual') RETURNING id`));
  seedRecipient(root, rootLaunch, 1, "queued");
  seedRecipient(root, rootLaunch, 2, "excluded", "Suppressed fixture opt-out");
  seedRecipient(root, rootLaunch, suppressedLead, "queued");
  seedRecipient(childDraft, childLaunch, 1, "sent", null, "2026-09-02");
  const completedRoot = seedCampaign("Completed Recovery Root", "cancelled");
  const completedChild = seedCampaign("Completed Recovery Child", "completed", 1, `{"remainingFromCampaignId":${completedRoot},"remainingRootCampaignId":${completedRoot},"pickedLeadIds":[1]}`, "dates");
  const completedLaunch = seedLaunch(completedRoot, "live", "completed", "2,1,1,0");
  const completedChildLaunch = seedLaunch(completedChild, "live", "completed", "1,0,1,0");
  seedRecipient(completedRoot, completedLaunch, 1, "queued");
  seedRecipient(completedRoot, completedLaunch, 2, "excluded", "Suppressed fixture opt-out");
  seedRecipient(completedRoot, completedLaunch, suppressedLead, "queued");
  seedRecipient(completedChild, completedChildLaunch, 1, "sent", null, "2026-09-02");
  const eligibleRoot = seedCampaign("Recovery Eligible Root", "cancelled");
  const eligibleLaunch = seedLaunch(eligibleRoot, "live", "cancelled", "1,0,0,0");
  seedRecipient(eligibleRoot, eligibleLaunch, 1, "queued");
  const family = { root, childDraft, completedRoot, completedChild, eligibleRoot };
  report.fixtureIds.recoveryFamily = family;
  const beforeResults = await resultSnapshot(root);
  assert("Cancelled source Results API responds", beforeResults.status === 200, `status=${beforeResults.status}`);
  await goCampaign(root);
  assert("Cancelled campaign defaults to Results", await page.getByTestId("tab-results").getAttribute("data-state") === "active");
  const launchedTabs = await page.locator('[role="tab"]').allInnerTexts();
  assert("Launched campaign has only Results Content Audience tabs", launchedTabs.length === 3 && ["Results", "Content", "Audience"].every(t => launchedTabs.includes(t)), launchedTabs.join("|"));
  await page.getByTestId("campaign-recovery-summary").waitFor({ timeout: 10000 });
  const summary = await page.getByTestId("campaign-recovery-summary").innerText();
  assert("Recovery summary accounts for not sent / linked sent / exclusions", summary.includes("3 not sent here") && summary.includes("1 sent via linked recovery") && summary.includes("2 excluded"), summary);
  assert("Suppressed recipient exclusion includes its reason", summary.includes("Opted out / suppressed"), summary);
  assert("Pending recovery summary is safe and explicit", summary.includes("still pending") || !summary.includes("queued"), summary);
  assert("Linked draft replaces recovery-create action", await page.getByTestId("campaign-recovery-linked").isVisible() && !(await page.getByTestId("campaign-send-remaining").count()));
  assert("Draft child copy says awaiting approval, not sent", (await page.getByTestId("campaign-recovery-linked").innerText()).includes("awaiting send"));
  const resultsText = await page.locator('[role="tabpanel"][data-state="active"]').innerText();
  assert("Cancelled Results avoid a misleading queued summary label", !/^\s*Queued\s*$/im.test(resultsText), resultsText.match(/.{0,30}Queued.{0,30}/g)?.join("|") ?? "");
  await page.getByTestId("tab-content").click();
  assert("Launched content fields are read-only", await page.getByTestId("fieldset-content").getAttribute("disabled") !== null);
  await page.getByTestId("tab-audience").click();
  const audienceFieldset = page.locator('[data-testid="fieldset-audience"]');
  assert("Launched audience fields are read-only", await audienceFieldset.count() === 0 || await audienceFieldset.isDisabled());
  const beforeHistory = JSON.stringify(beforeResults.body);
  await page.getByTestId("tab-results").click();
  await page.getByTestId("campaign-archive").click();
  await page.waitForTimeout(400);
  const afterResults = await resultSnapshot(root);
  assert("Archive leaves Results/tracking history unchanged", JSON.stringify(afterResults.body) === beforeHistory);
  assert("Cancelled source archive succeeds", (await api(`/api/campaigns/${root}`)).status === 200);

  await goCampaign(completedRoot);
  await page.getByTestId("campaign-recovery-summary").waitFor({ timeout: 10000 });
  assert("Completed recovery child copy says sent", (await page.getByTestId("campaign-recovery-linked").innerText()).includes("sent via"));
  await goCampaign(eligibleRoot);
  await page.getByTestId("campaign-send-remaining").waitFor({ timeout: 10000 });
  assert("Admin sees create recovery only when eligible recipients remain", await page.getByTestId("campaign-send-remaining").isVisible());
  const archivedEligible = await adminFetch(eligibleRoot, "/archive", "POST");
  assert("Eligible recovery source can be archived", archivedEligible.status === 200);
  await goCampaign(eligibleRoot);
  assert("Archived source cannot offer create recovery", !(await page.getByTestId("campaign-send-remaining").count()));

  // Duplicate compare labels must distinguish status/date and drafts must say Not sent.
  const dupDraft = seedCampaign("Duplicate Compare", "draft");
  const dupCompleted = seedCampaign("Duplicate Compare", "completed", 1, "{}", "dates");
  seedLaunch(dupCompleted, "live", "completed", "1,0,1,0");
  report.fixtureIds.compareDuplicates = [dupDraft, dupCompleted];
  await page.goto(`${sandbox.url}/campaigns`);
  const draftChoice = page.getByTestId(`toggle-compare-${dupDraft}`);
  const completeChoice = page.getByTestId(`toggle-compare-${dupCompleted}`);
  await draftChoice.waitFor();
  const draftLabel = await draftChoice.innerText(), completeLabel = await completeChoice.innerText();
  assert("Compare choices disambiguate duplicate name by status/date", draftLabel !== completeLabel && draftLabel.includes("Draft") && completeLabel.includes("Completed"));
  assert("Draft compare label says Not sent", draftLabel.includes("Not sent"), draftLabel);
  assert("Archived campaigns are hidden from default comparison choices", !(await page.getByTestId(`toggle-compare-${archivable.completed}`).count()));
  console.log("recovery-retention-compare-verified");

  // Capture both requested mobile/tablet widths before role switching.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${sandbox.url}/campaigns`);
  await page.getByRole("heading", { name: "Campaigns", exact: true }).waitFor();
  await page.screenshot({ path: resolve(evidenceDir, "campaigns-390.png") });
  report.screenshots.push("reports/campaign-ux/browser/campaigns-390.png");
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.screenshot({ path: resolve(evidenceDir, "campaigns-768.png") });
  report.screenshots.push("reports/campaign-ux/browser/campaigns-768.png");
  console.log("responsive-screenshots-captured");

  // Manager and rep: no lifecycle controls, server mutations are deliberately probed and must 403.
  const archivedTarget = archivable.failed;
  for (const role of ["manager", "rep"]) {
    await page.evaluate(() => window.Clerk.signOut());
    await sandbox.login(page, role);
    await page.goto(role === "manager" ? `${sandbox.url}/campaigns/${archivedTarget}` : `${sandbox.url}/campaigns`);
    if (role === "manager") await page.getByTestId("tab-results").waitFor();
    const controls = await page.locator('[data-testid^="campaign-archive"],[data-testid^="campaign-unarchive"],[data-testid^="campaign-delete"]').count();
    assert(`${role} sees no Archive/Unarchive/Delete UI`, controls === 0, `count=${controls}`);
    for (const [suffix, method, label] of [["/archive","POST","archive"],["/archive","DELETE","unarchive"],["","DELETE","delete"]]) {
      const probe = await adminFetch(archivedTarget, suffix, method);
      assert(`${role} direct ${label} mutation is denied 403`, probe.status === 403, `status=${probe.status}`);
    }
    const recovery = await api(`/api/campaigns/${root}/recovery`);
    if (role === "manager") {
      await goCampaign(root);
      await page.getByTestId("campaign-recovery-summary").waitFor();
      assert("Manager can see linked recovery summary", await page.getByTestId("campaign-recovery-summary").isVisible());
      assert("Manager sees linked recovery but no create action", await page.getByTestId("campaign-recovery-linked").isVisible() && !(await page.getByTestId("campaign-send-remaining").count()));
      assert("Manager recovery summary endpoint accessible", recovery.status === 200, `status=${recovery.status}`);
      const createProbe = await adminFetch(completedRoot, "/send-remaining", "POST");
      assert("Manager cannot create recovery", createProbe.status === 403, `status=${createProbe.status}`);
    } else {
      assert("Rep cannot read recovery endpoint", recovery.status === 403, `status=${recovery.status}`);
      assert("Rep cannot create recovery from UI", !(await page.getByTestId("campaign-send-remaining").count()));
    }
  }
  console.log("role-probes-verified");
  report.unexpectedHttp = responseErrors.filter(e => {
    if (e.status === 403 && /\/api\/campaigns\/\d+(\/archive|\/send-remaining|\/recovery)?$/.test(e.path)) return false;
    if (e.status === 404 && e.path === `/api/campaigns/${disposableId}`) return false;
    return true;
  });
  assert("No unexpected browser 403/404/503 responses", report.unexpectedHttp.length === 0, JSON.stringify(report.unexpectedHttp));
} catch (error) {
  check("Journey script completed", false, error?.message ?? "unknown error");
} finally {
  try { if (context) await context.close(); } catch {}
  try { if (browser) await browser.close(); } catch {}
  try {
    if (sandbox) {
      await sandbox.close();
      report.cleanup = { ...sandbox.cleanupReport(), completed: true };
    }
  } catch { report.cleanup = { completed: false }; }
  const passed = report.checks.filter(c => c.pass).length;
  report.summary = { passed, failed: report.checks.length - passed };
  await writeFile(resolve(evidenceDir, "results.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Campaign UX browser journey: ${passed}/${report.checks.length} checks passed. Sanitized report: ${resolve(evidenceDir, "results.json")}`);
  if (report.summary.failed) process.exitCode = 1;
}
