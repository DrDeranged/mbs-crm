import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import { startSandbox } from "../../scripts/visual-refresh/sandbox.mjs";
import { waitForPage } from "../../scripts/visual-refresh/readiness.mjs";

const root = resolve(import.meta.dirname, "../..");
const output = join(root, "reports/opt-in-recertification");
const webRoot = join(root, ".local/certification-853f4e4/public");
const sourcePath = join(root, ".local/certification-853f4e4/historical-campaign.json");
const pages = [
  ["dashboard", "/dashboard"], ["leads", "/leads"], ["lead-detail", "/leads/1"],
  ["pipeline", "/deals"], ["apply", "/apply"], ["settings", "/settings"],
];
const roles = ["admin", "manager", "rep"];
const httpErrors = [], consoleErrors = [], pageErrors = [], visits = [], pendingBodies = new Set();
const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", headless: true });
let fixture, fixtureDbName, campaignProvenance;

function scrubText(value) {
  return String(value ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/\b(access|refresh|id|session)[_-]?token\b\s*[:=]\s*[^,\s;"']+/gi, "$1=[REDACTED]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/\+?\d[\d ()-]{7,}\d/g, "[REDACTED_PHONE]")
    .replace(/\b(?:sk_(?:live|test)_|pk_(?:live|test)_)[A-Za-z0-9_-]+/g, "[REDACTED_KEY]")
    .slice(0, 1200);
}
function safeUrl(raw) {
  try {
    const u = new URL(raw);
    const path = u.pathname
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
      .replace(/(\/(?:users|leads|deals|contacts|recipients)\/)[^/]+/gi, "$1[REDACTED_ID]")
      .replace(/\/(?:eyJ[A-Za-z0-9_-]{30,}|[A-Za-z0-9_-]{48,})(?=\/|$)/g, "/[REDACTED_TOKEN]");
    const keys = [...new Set([...u.searchParams.keys()])].sort();
    return { origin: u.origin, path, query: keys.length ? Object.fromEntries(keys.map(key => [scrubText(key), "[REDACTED]"])) : undefined };
  } catch { return { origin: "[non-url]", path: scrubText(raw) }; }
}
function safeInitiator(initiator) {
  if (!initiator) return null;
  return {
    type: initiator.type ?? null,
    url: initiator.url ? safeUrl(initiator.url) : null,
    stack: (initiator.stack?.callFrames ?? []).slice(0, 5).map(frame => ({
      functionName: scrubText(frame.functionName || "(anonymous)"),
      url: frame.url ? safeUrl(frame.url) : null, lineNumber: frame.lineNumber, columnNumber: frame.columnNumber,
    })),
  };
}
function safeReason(text) {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      const allowed = ["error", "message", "reason", "code", "detail", "title", "status"];
      const result = {};
      for (const key of allowed) {
        if (typeof parsed[key] === "string" || typeof parsed[key] === "number") result[key] = scrubText(parsed[key]);
      }
      if (Object.keys(result).length) return result;
      return { responseType: "json", keys: Object.keys(parsed).map(scrubText).slice(0, 20) };
    }
  } catch {}
  const trimmed = text.trim();
  if (/^\s*</.test(trimmed)) return { responseType: "html-or-xml", bodyOmitted: true };
  return { responseType: "text", text: scrubText(trimmed) };
}
function pagePath(page) {
  try { return new URL(page.url()).pathname; } catch { return null; }
}
async function attachTrace(page, role, phaseRef) {
  const requestMeta = new WeakMap(), cdpByRequestId = new Map();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  cdp.on("Network.requestWillBeSent", event => {
    const url = safeUrl(event.request.url);
    cdpByRequestId.set(event.requestId, {
      method: event.request.method, url, role, phase: phaseRef.value,
      pagePathAtInitiation: event.type === "Document" ? url.path : pagePath(page),
      initiator: safeInitiator(event.initiator), initiatedAt: new Date().toISOString(),
      resourceType: event.type ?? null,
    });
  });
  cdp.on("Network.responseReceived", event => {
    const status = event.response.status;
    if (![403, 404, 503].includes(status)) return;
    const request = cdpByRequestId.get(event.requestId) ?? {};
    const path = safeUrl(event.response.url);
    httpErrors.push({
      eventId: `http-${httpErrors.length + 1}`, method: request.method ?? null, ...request,
      url: path, status, statusText: scrubText(event.response.statusText),
      responseHeaders: {
        contentType: event.response.mimeType ?? null,
        fromDiskCache: event.response.fromDiskCache ?? false,
        fromServiceWorker: event.response.fromServiceWorker ?? false,
      },
      reason: null, responseObservedAt: new Date().toISOString(), cdpRequestId: event.requestId,
    });
  });
  page.on("request", request => {
    const url = safeUrl(request.url());
    requestMeta.set(request, {
      method: request.method(), url, role, phase: phaseRef.value,
      pagePathAtInitiation: request.resourceType() === "document" ? url.path : pagePath(page),
      resourceType: request.resourceType(), initiatedAt: new Date().toISOString(),
    });
  });
  page.on("response", response => {
    if (![403, 404, 503].includes(response.status())) return;
    const task = (async () => {
      const request = response.request(), meta = requestMeta.get(request) ?? {};
      const responseUrl = safeUrl(response.url());
      const matching = [...httpErrors].reverse().find(row => row.role === role
        && row.phase === meta.phase && row.method === request.method() && row.url?.origin === responseUrl.origin
        && row.url?.path === responseUrl.path && row.status === response.status() && !row.reason);
      let reason = null;
      try { reason = safeReason(await response.text()); } catch (error) { reason = { bodyUnavailable: scrubText(error?.message) }; }
      if (matching) matching.reason = reason;
      else httpErrors.push({
        eventId: `http-${httpErrors.length + 1}`, ...meta, url: responseUrl,
        status: response.status(), statusText: scrubText(response.statusText()), reason,
        responseObservedAt: new Date().toISOString(), initiator: null,
      });
    })().catch(() => {});
    pendingBodies.add(task);
    task.finally(() => pendingBodies.delete(task));
  });
  page.on("console", message => {
    if (message.type() !== "error") return;
    const location = message.location();
    consoleErrors.push({
      eventId: `console-${consoleErrors.length + 1}`, role, phase: phaseRef.value,
      pagePathAtConsole: pagePath(page), message: scrubText(message.text()),
      location: { url: location.url ? safeUrl(location.url) : null, lineNumber: location.lineNumber, columnNumber: location.columnNumber },
      observedAt: new Date().toISOString(),
    });
  });
  page.on("pageerror", error => pageErrors.push({
    eventId: `pageerror-${pageErrors.length + 1}`, role, phase: phaseRef.value,
    pagePathAtError: pagePath(page), message: scrubText(error.message), observedAt: new Date().toISOString(),
  }));
  return cdp;
}
function correlateConsole() {
  return consoleErrors.map(error => {
    const status = Number(error.message.match(/\b(403|404|503)\b/)?.[1] ?? 0);
    const time = Date.parse(error.observedAt);
    const candidates = status ? httpErrors.filter(row => row.role === error.role && row.phase === error.phase
      && row.pagePathAtInitiation === error.pagePathAtConsole && row.status === status
      && Math.abs(Date.parse(row.responseObservedAt) - time) <= 5000) : [];
    return { ...error, responseCorrelation: status ? {
      status, candidateEventIds: candidates.map(row => row.eventId),
      confidence: candidates.length === 1 ? "single same-role/phase/page and +/-5s candidate" : candidates.length ? "ambiguous: multiple nearby responses" : "unmatched: no nearby response event",
      candidates: candidates.map(row => ({ eventId: row.eventId, method: row.method, url: row.url, reason: row.reason })),
    } : { confidence: "console text contains no 403/404/503 status" } };
  });
}

async function insertHistoricalCampaign() {
  const sourceBytes = await readFile(sourcePath), historical = JSON.parse(sourceBytes);
  if (historical.campaign?.id !== 5 || historical.campaign?.status !== "completed"
      || historical.launches?.length !== 1 || historical.recipients?.length !== 13 || historical.sends?.length !== 13) {
    throw new Error("Historical campaign fixture failed its row/status precondition");
  }
  const dbName = fixture.query("SELECT current_database()");
  if (!/^visual_refresh_fixture_\d+_\d+$/.test(dbName)) throw new Error(`Refusing campaign writes to ${dbName}`);
  const dbUrl = new URL(process.env.DATABASE_URL); dbUrl.pathname = `/${dbName}`;
  if (dbUrl.pathname.slice(1) !== dbName || !/^visual_refresh_fixture_/.test(dbName)) throw new Error("Fixture database guard failed");
  const quote = value => `'${String(value).replaceAll("'", "''")}'`;
  const ts = value => value == null ? "NULL" : `${quote(value.replace("T", " "))}::timestamp`;
  const tz = value => value == null ? "NULL" : `${quote(value)}::timestamptz`;
  const leadMap = new Map([...new Set(historical.recipients.map(r => r.lead_id))].map((id, index) => [id, index + 3]));
  const sql = [];
  for (const [sourceId, id] of leadMap) {
    const n = id - 2, ord = String(n).padStart(2, "0");
    sql.push(`INSERT INTO leads(id,first_name,last_name,email,phone,company_name,application_type,status,assigned_rep_id,lead_source,created_at,updated_at)
      VALUES (${id},'Historical','Fixture Recipient ${ord}',${quote(`historical-recipient-${ord}@example.invalid`)},
      '+1202555${String(100+n).slice(-4)}',${quote(`Synthetic Campaign Recipient ${ord}`)},'equipment','contacted',3,'manual',now(),now());`);
  }
  const c = historical.campaign, launch = historical.launches[0];
  sql.push(`INSERT INTO campaigns(id,name,channel,status,email_template_id,audience_rules,scheduled_at,launched_at,completed_at,owner_id,created_by,version,created_at,updated_at,tracking_since,reply_to_email,flyer_delivery_mode)
    VALUES (5,${quote(c.name)},${quote(c.channel)},${quote(c.status)},1,'{}'::jsonb,${tz(c.scheduled_at)},${tz(c.launched_at)},${tz(c.completed_at)},1,1,${c.version},${tz(c.created_at)},${tz(c.updated_at)},NULL,'fixture-replies@example.invalid',${quote(c.flyer_delivery_mode)});`);
  sql.push(`INSERT INTO campaign_launches(id,campaign_id,idempotency_key,requested_by,mode,status,eligible_count,excluded_count,sent_count,failed_count,scheduled_at,started_at,completed_at,created_at)
    VALUES (5,5,'historical-fixture-launch-5',1,${quote(launch.mode)},${quote(launch.status)},${launch.eligible_count},${launch.excluded_count},${launch.sent_count},${launch.failed_count},${tz(launch.scheduled_at)},${tz(launch.started_at)},${tz(launch.completed_at)},${tz(launch.created_at)});`);
  for (const send of historical.sends) {
    const leadId = leadMap.get(send.lead_id), ord = String(leadId - 2).padStart(2, "0");
    sql.push(`INSERT INTO email_sends(id,lead_id,user_id,template_id,subject,to_email,from_email,status,sendgrid_message_id,sent_at,opened_at,clicked_at,created_at,updated_at,campaign_id,campaign_launch_id,delivery_kind)
      VALUES (${send.id},${leadId},1,1,${quote("Vendors — Heavy Equipment (synthetic historical fixture)")},${quote(`historical-recipient-${ord}@example.invalid`)},'fixture-sender@example.invalid',
      ${quote(send.status)},NULL,${ts(send.sent_at)},${ts(send.opened_at)},${ts(send.clicked_at)},${ts(send.created_at)},${ts(send.updated_at)},5,5,${quote(send.delivery_kind)});`);
  }
  for (const recipient of historical.recipients) {
    sql.push(`INSERT INTO campaign_recipients(id,launch_id,campaign_id,lead_id,channel,status,exclusion_reason,available_at,email_send_id,sent_at,created_at)
      VALUES (${recipient.id},5,5,${leadMap.get(recipient.lead_id)},${quote(recipient.channel)},${quote(recipient.status)},NULL,
      ${tz(recipient.available_at)},${recipient.email_send_id},NULL,${tz(recipient.created_at)});`);
  }
  for (const [table, value] of [["leads",15],["campaigns",5],["campaign_launches",5],["campaign_recipients",26],["email_sends",45]]) {
    sql.push(`SELECT setval(pg_get_serial_sequence('${table}','id'),${value},true);`);
  }
  const write = spawnSync("psql", [`--dbname=${dbUrl}`, "--no-psqlrc", "--set=ON_ERROR_STOP=on", "--single-transaction", "--command", sql.join("\n")], { encoding: "utf8" });
  if (write.status !== 0) throw new Error(`Fixture-only historical campaign insert failed: ${scrubText(write.stderr)}`);
  campaignProvenance = {
    source: ".local/certification-853f4e4/historical-campaign.json",
    sha256: createHash("sha256").update(sourceBytes).digest("hex"),
    fixtureDatabase: dbName, campaignId: 5, campaignStatus: c.status,
    rowsInserted: { leads: leadMap.size, campaignLaunches: 1, recipients: historical.recipients.length, emailSends: historical.sends.length },
    preservation: "synthetic lead identities/emails and fixture users/template; historical relationships/status/timestamps retained; recipient sent_at NULL; email send sent_at retained; tracking_since NULL",
  };
}

async function run() {
  await mkdir(output, { recursive: true });
  const flushPartial = async () => {
    await writeFile(join(output, "prior-candidate-http-errors-partial.json"), JSON.stringify(httpErrors, null, 2));
    await writeFile(join(output, "prior-candidate-console-errors-partial.json"), JSON.stringify(correlateConsole(), null, 2));
    await writeFile(join(output, "prior-candidate-visits-partial.json"), JSON.stringify(visits, null, 2));
  };
  const index = await readFile(join(webRoot, "index.html"));
  const build = {
    target: "853f4e49378b10daf3d59d81769c81fe812ca0ea",
    localSnapshot: "4165874ad76bdfbba46a115d7c3b404ec1752b6d",
    publicIndexSha256: createHash("sha256").update(index).digest("hex"),
    buildMode: "build:false; frozen candidate public directory",
  };
  fixture = await startSandbox({ build: false, webRoot, port: 4320 });
  fixtureDbName = fixture.query("SELECT current_database()");
  build.fixtureDatabase = fixtureDbName;
  const viewport = { width: 390, height: 900 };
  for (const role of roles) {
    console.log(`diagnostic role ${role}: starting`);
    const context = await browser.newContext({ viewport, colorScheme: "light", reducedMotion: "reduce", serviceWorkers: "block" });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const phaseRef = { value: "login" };
    await attachTrace(page, role, phaseRef);
    await fixture.login(page, role);
    for (const [name, path] of pages) {
      phaseRef.value = `page:${name}`;
      console.log(`diagnostic ${role} ${name}`);
      const navigation = await page.goto(fixture.url + path, { waitUntil: "domcontentloaded", timeout: 15000 });
      const marker = name === "apply"
        ? page.getByRole("heading", { name: "What type of financing are you looking for?" })
        : name === "lead-detail"
          ? page.locator("h1").filter({ hasText: /Fixture Equipment LLC|Synthetic Contact/ }).first()
          : page.getByRole("heading", { name: name === "dashboard" ? "Dashboard" : name === "leads" ? "Leads" : name === "pipeline" ? "Deals" : "Settings", exact: true });
      let markerVisible = true, markerFailure = null;
      try { await marker.waitFor({ timeout: 6000 }); } catch (error) { markerVisible = false; markerFailure = scrubText(error.message); }
      await page.waitForLoadState("networkidle", { timeout: 1200 }).catch(() => {});
      await page.waitForTimeout(250);
      visits.push({ role, phase: phaseRef.value, requestedPath: path, finalPath: pagePath(page),
        navigationStatus: navigation?.status() ?? null, markerVisible, markerFailure,
        heading: await page.locator("h1").first().innerText().catch(() => null) });
      await Promise.race([Promise.allSettled([...pendingBodies]), new Promise(resolve => setTimeout(resolve, 1200))]);
      await flushPartial();
    }
    await context.close();
  }
  await insertHistoricalCampaign();
  const campaignContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", reducedMotion: "reduce", serviceWorkers: "block" });
  const campaignPage = await campaignContext.newPage(); campaignPage.setDefaultTimeout(15000);
  const campaignPhase = { value: "login" };
  await attachTrace(campaignPage, "admin", campaignPhase);
  await fixture.login(campaignPage, "admin");
  campaignPhase.value = "campaign-results";
  const resultsPromise = campaignPage.waitForResponse(response => response.url().includes("/api/campaigns/5/results"));
  const metricsPromise = campaignPage.waitForResponse(response => response.url().includes("/api/campaigns/5/metrics"));
  await campaignPage.goto(fixture.url + "/campaigns/5", { waitUntil: "domcontentloaded", timeout: 20000 });
  await campaignPage.getByText("Vendors — Heavy Equipment", { exact: true }).first().waitFor({ timeout: 8000 });
  await campaignPage.getByRole("tab", { name: "Results", exact: true }).click();
  const [results, metrics] = await Promise.all([resultsPromise, metricsPromise]);
  await campaignPage.getByText("Campaign Results", { exact: true }).waitFor({ timeout: 8000 });
  const report = {
    build, viewport, pagesPerRole: pages.length, visits,
    campaignResults: {
      path: "/campaigns/5", resultsStatus: results.status(), metricsStatus: metrics.status(),
      counts: (await results.json()).counts, metrics: await metrics.json(),
      sentKpi: await campaignPage.getByTestId("kpi-sent").innerText(),
      unknownMetricExamples: ["Not tracked"],
    },
  };
  await campaignContext.close();
  await Promise.allSettled([...pendingBodies]);
  const correlated = correlateConsole();
  report.httpErrorCount = httpErrors.length;
  report.consoleErrorCount = consoleErrors.length;
  report.pageErrorCount = pageErrors.length;
  report.httpStatuses = Object.fromEntries([403,404,503].map(status => [status, httpErrors.filter(e => e.status === status).length]));
  report.campaignProvenance = campaignProvenance;
  report.cleanupExpectation = "startSandbox.close removes isolated API, schema-only fixture DB, storage temp directory, and synthetic Clerk users";
  await writeFile(join(output, "prior-candidate-diagnostic-summary.json"), JSON.stringify(report, null, 2));
  await writeFile(join(output, "prior-candidate-http-errors.json"), JSON.stringify(httpErrors, null, 2));
  await writeFile(join(output, "prior-candidate-console-errors.json"), JSON.stringify(correlated, null, 2));
  await writeFile(join(output, "prior-candidate-page-errors.json"), JSON.stringify(pageErrors, null, 2));
}

try {
  await run();
} catch (error) {
  await writeFile(join(output, "prior-candidate-diagnostic-failure.txt"), `${scrubText(error?.stack ?? String(error))}\n`);
  await writeFile(join(output, "prior-candidate-http-errors-partial.json"), JSON.stringify(httpErrors, null, 2));
  await writeFile(join(output, "prior-candidate-console-errors-partial.json"), JSON.stringify(correlateConsole(), null, 2));
  await writeFile(join(output, "prior-candidate-visits-partial.json"), JSON.stringify(visits, null, 2));
  throw error;
} finally {
  await browser.close();
  try { await fixture?.close(); } catch (error) {
    await writeFile(join(output, "cleanup-warning.txt"), `${scrubText(error?.stack ?? String(error))}\n`, { flag: "a" });
  }
  if (fixtureDbName && /^visual_refresh_fixture_\d+_\d+$/.test(fixtureDbName)) {
    const drop = spawnSync("dropdb", ["--if-exists", "--force", `--maintenance-db=${process.env.DATABASE_URL}`, fixtureDbName], { encoding: "utf8" });
    if (drop.status !== 0) await writeFile(join(output, "cleanup-warning.txt"), `${scrubText(drop.stderr)}\n`, { flag: "a" });
  }
}
