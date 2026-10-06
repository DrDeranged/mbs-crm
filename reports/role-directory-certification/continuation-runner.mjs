// Focused continuation for the interrupted role-directory certification.
// This is deliberately separate from the frozen original runner and writes
// only beneath reports/role-directory-certification/continuation/runs/.
import { chromium } from "@playwright/test";
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { join, resolve, sep } from "node:path";
import { startSandbox } from "../../scripts/visual-refresh/sandbox.mjs";
import { waitForPage } from "../../scripts/visual-refresh/readiness.mjs";

const root = resolve(import.meta.dirname, "../..");
const reportRoot = join(root, "reports/role-directory-certification");
const oldRun = join(reportRoot, "run");
const continuationRoot = join(reportRoot, "continuation");
const outputRoot = join(continuationRoot, "runs");
const authPath = join(reportRoot, "launch-authorization.json");
const policyPath = join(reportRoot, "policy.json");
const oldAuthorizationPath = join(oldRun, "authorization-used.json");
const campaignFixturePath = join(root, ".local/certification-853f4e4/historical-campaign.json");
const frozenRunnerPath = join(reportRoot, "role-directory-certification.mjs");
const sandboxPath = join(root, "scripts/visual-refresh/sandbox.mjs");
const readinessPath = join(root, "scripts/visual-refresh/readiness.mjs");
const webSourcePath = join(root, "artifacts/mbs-crm/src");
const apiSourcePath = join(root, "artifacts/api-server/src");
const apiDistPath = join(root, "artifacts/api-server/dist");
const baselinePath = join(root, ".local/certification-2af927c/baselines/target-2af927c");
const require = createRequire(join(root, "artifacts/api-server/package.json"));
const { clerkClient } = require("@clerk/express");
const createdUsers = new Set();
const originalCreateUser = clerkClient.users.createUser.bind(clerkClient.users);
const originalDeleteUser = clerkClient.users.deleteUser.bind(clerkClient.users);
clerkClient.users.createUser = async (...args) => {
  const user = await originalCreateUser(...args);
  createdUsers.add(user.id);
  return user;
};
clerkClient.users.deleteUser = async (id) => {
  try { return await originalDeleteUser(id); }
  catch (error) {
    if (error?.status === 404 || /not found|already deleted/i.test(String(error?.message))) return;
    throw error;
  }
};

const roles = ["admin", "manager", "rep"];
const structuralPages = ["dashboard", "leads", "lead-detail", "pipeline", "apply", "settings"];
const structuralWidths = [390, 768];
const badStatuses = new Set([403, 404, 503]);
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
const safeText = (value) => String(value ?? "").replace(/[\r\n\t]+/g, " ").slice(0, 800);
function check(ok, message) { if (!ok) throw new Error(message); }
function shaFile(file) { return createHash("sha256").update(readFileSync(file)).digest("hex"); }
function shaTree(directory) {
  const hash = createHash("sha256");
  function visit(folder, rel = "") {
    for (const entry of require("node:fs").readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(rel, entry.name);
      if (entry.isDirectory()) visit(join(folder, entry.name), path);
      else if (entry.isFile()) {
        hash.update(path); hash.update("\0"); hash.update(readFileSync(join(folder, entry.name))); hash.update("\0");
      }
    }
  }
  visit(directory);
  return hash.digest("hex");
}
function safeUrl(raw) {
  const url = new URL(raw || "http://fixture.invalid/");
  const businessQueryKeys = new Set([
    "page", "limit", "sortBy", "sortOrder", "search", "q", "status",
    "isActive", "role", "assignedRepId", "assignedTo", "leadId", "campaignId",
    "archived", "granularity", "startDate", "endDate",
  ]);
  for (const key of [...url.searchParams.keys()]) {
    if (!businessQueryKeys.has(key)) url.searchParams.set(key, "[REDACTED]");
  }
  url.pathname = url.pathname
    .replace(/(\/api\/deals\/)\d+/g, "$1[REDACTED_ID]")
    .replace(/(\/api\/leads\/)\d+/g, "$1[REDACTED_ID]")
    .replace(/(\/deals\/)\d+/g, "$1[REDACTED_ID]")
    .replace(/(\/leads\/)\d+/g, "$1[REDACTED_ID]");
  return { origin: url.origin, path: url.pathname, search: url.search };
}
function atomicJson(folder, name, value) {
  const target = join(folder, name), temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, target);
}
function append(folder, name, value) {
  appendFileSync(join(folder, name), `${JSON.stringify(value)}\n`);
}
function readNdjson(path) {
  try { return readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)); }
  catch { return []; }
}

function originalRunAudit() {
  const proof = JSON.parse(readFileSync(join(continuationRoot, "retained-structure-proof.json"), "utf8"));
  const sqlProof = JSON.parse(readFileSync(join(oldRun, "campaign-sql-preflight.json"), "utf8"));
  const progress = JSON.parse(readFileSync(join(oldRun, "run-progress.json"), "utf8"));
  const statusRows = readNdjson(join(oldRun, "http-status-events.ndjson")).filter((row) => row.phaseGroup === "candidate");
  const consoleRows = readNdjson(join(oldRun, "console-events.ndjson")).filter((row) => row.phaseGroup === "candidate");
  const pageErrors = readNdjson(join(oldRun, "page-errors.ndjson")).filter((row) => row.phaseGroup === "candidate");
  const requestFailures = readNdjson(join(oldRun, "request-failures.ndjson")).filter((row) => row.phaseGroup === "candidate");
  const journeyRows = readNdjson(join(oldRun, "journey-events.ndjson"));
  const rolePolicy = readNdjson(join(oldRun, "role-policy-events.ndjson"));
  const pwrByRole = Object.fromEntries(roles.map((role) => [role, {
    responses: statusRows.filter((row) => row.role === role).length,
    badStatuses: statusRows.filter((row) => row.role === role && badStatuses.has(row.status))
      .map((row) => ({ phase: row.phase, method: row.method, path: row.url?.path, status: row.status })),
    consoleErrors: consoleRows.filter((row) => row.role === role).length,
    pageErrors: pageErrors.filter((row) => row.role === role).length,
    requestFailures: requestFailures.filter((row) => row.role === role).length,
  }]));
  const superseded = {
    phase: "candidate:manager-retention:deal-edit",
    pwr403: statusRows.filter((row) => row.role === "manager" && row.phase === "candidate:manager-retention:deal-edit" && row.status === 403).length,
    consoleErrors: consoleRows.filter((row) => row.role === "manager" && row.phase === "candidate:manager-retention:deal-edit").length,
  };
  const repUserReads = readNdjson(join(oldRun, "rep-user-list-requests.ndjson")).length
    + readNdjson(join(oldRun, "network-events.ndjson")).filter((row) =>
      row.phaseGroup === "candidate" && row.role === "rep" && row.url?.path === "/api/users").length;
  check(proof.status === "RETAINED_PENDING_API_PIN_REVALIDATION" && proof.frontendPinComparison?.allMatch === true,
    "Retained structural proof is absent or frontend pins no longer match.");
  check(proof.structuralComparison?.pass === true && proof.structuralComparison?.cases === 36,
    "The original 36-case structural comparison is not valid.");
  check(proof.changedEndpointTraceAudit?.playwrightRequestsOrResponsesInStructuralPhases === 0
    && proof.changedEndpointTraceAudit?.cdpEventsInStructuralPhases === 0,
    "Changed submissions endpoint was observed during a structural capture.");
  check(sqlProof.status === "PASS" && sqlProof.transaction === "BEGIN; complete generated SQL; ROLLBACK"
    && sqlProof.generatedStatements === 46 && sqlProof.sourceSha256 === shaFile(campaignFixturePath),
  "Original campaign SQL rollback preflight proof is absent or no longer matches the fixture.");
  return {
    originalRunStatus: progress.status === "starting" ? "INTERRUPTED_NO_TERMINAL_RECORD" : progress.status,
    originalProgressPhase: progress.phase,
    originalTerminalSummaryPresent: false,
    originalRetentionJourneyEvents: journeyRows.length,
    originalRetentionJourneySteps: journeyRows.map((row) => row.step),
    originalRawCandidateByRole: pwrByRole,
    supersededManagerFailurePhase: superseded,
    repDirectoryListRequests: repUserReads,
    priorCampaignSqlPreflight: { status: sqlProof.status, generatedStatements: sqlProof.generatedStatements, transaction: sqlProof.transaction },
    retainedStructureProof: proof,
    rolePolicyRoutes: rolePolicy.length,
    rolePolicyAllZeroControls: rolePolicy.length === 11 && rolePolicy.every((row) => Array.isArray(row.controls) && row.controls.length === 0),
  };
}

function validatePins() {
  const lock = JSON.parse(readFileSync(authPath, "utf8"));
  check(lock.continuationRunnerSha256 === shaFile(import.meta.filename),
    "Continuation runner differs from Main's frozen hash.");
  const old = JSON.parse(readFileSync(oldAuthorizationPath, "utf8"));
  check(lock.sourceFinalized === true && lock.elevenGatePreflightExit === 0
    && lock.immutablePinsFrozen === true && lock.launchAuthorized === true,
  "Main must provide a new authorized lock with final source, 11-gate exit 0, and frozen pins.");
  check(/^[0-9a-f]{40}$/.test(lock.targetRevision) && /^[0-9a-f]{40}$/.test(lock.localSnapshot),
    "Main authorization is missing finalized revision/snapshot pins.");
  for (const name of ["candidateWebSourceTreeSha256", "candidateWebTreeSha256", "candidateIndexSha256",
    "baselineWebTreeSha256", "approvalPolicySha256", "runnerSha256", "sandboxHelperSha256",
    "readinessHelperSha256", "historicalCampaignFixtureSha256"]) {
    check(lock[name] === old[name], `Unchanged certified pin ${name} differs from the interrupted run.`);
  }
  check(lock.candidateWebRoot === old.candidateWebRoot, "Candidate frozen web root changed.");
  check(lock.baselineRevision === old.baselineRevision, "Approved baseline revision changed.");
  check(shaTree(webSourcePath) === old.candidateWebSourceTreeSha256, "Frontend source changed after the original captures.");
  const webRoot = resolve(root, lock.candidateWebRoot);
  check(webRoot.startsWith(root + sep), "Candidate web root escaped the workspace.");
  check(shaTree(webRoot) === old.candidateWebTreeSha256
    && shaFile(join(webRoot, "index.html")) === old.candidateIndexSha256,
  "Frozen web build changed after the original captures.");
  check(shaTree(baselinePath) === old.baselineWebTreeSha256, "Approved baseline tree changed.");
  check(shaFile(policyPath) === old.approvalPolicySha256, "Approval policy changed.");
  check(shaFile(frozenRunnerPath) === old.runnerSha256, "Frozen original runner changed.");
  check(shaFile(sandboxPath) === old.sandboxHelperSha256 && shaFile(readinessPath) === old.readinessHelperSha256,
    "Frozen sandbox/readiness helpers changed.");
  check(shaFile(campaignFixturePath) === old.historicalCampaignFixtureSha256, "Historical campaign fixture changed.");
  check(/^[0-9a-f]{64}$/.test(lock.candidateApiSourceTreeSha256)
    && shaTree(apiSourcePath) === lock.candidateApiSourceTreeSha256,
  "Main API source pin is missing or does not match current API source.");
  check(/^[0-9a-f]{64}$/.test(lock.candidateApiDistSha256)
    && shaTree(apiDistPath) === lock.candidateApiDistSha256,
  "Main API dist pin is missing or does not match current API dist.");
  check(Number.isInteger(lock.port) && lock.port >= 4300 && lock.port <= 4499,
    "Main authorization must assign an isolated fixture port.");
  check(lock.preflightEvidence?.exitCode === 0 && /^[0-9a-f]{64}$/.test(lock.preflightEvidence?.sha256 ?? "")
    && resolve(root, lock.preflightEvidence.path).startsWith(root + sep)
    && shaFile(resolve(root, lock.preflightEvidence.path)) === lock.preflightEvidence.sha256,
  "New 11-gate preflight evidence is absent or does not match Main's pin.");
  return lock;
}

function psql(databaseUrl, sql, options = {}) {
  const args = [`--dbname=${databaseUrl}`, "--no-psqlrc", "--set=ON_ERROR_STOP=on", "--command", sql];
  const result = spawnSync("psql", args, { encoding: "utf8", timeout: options.timeout ?? 15000 });
  check(result.status === 0, `Synthetic fixture SQL failed: ${safeText(result.stderr || result.error?.message)}`);
  return result.stdout.trim();
}

async function seedCampaign(fixture, folder, runId) {
  const bytes = readFileSync(campaignFixturePath), historical = JSON.parse(bytes);
  check(historical.campaign?.id === 5 && historical.campaign.status === "completed"
    && historical.launches?.length === 1 && historical.recipients?.length === 13 && historical.sends?.length === 13,
  "Historical Campaign 5 fixture row counts changed.");
  const dbName = fixture.query("SELECT current_database()");
  check(/^visual_refresh_fixture_\d+_\d+$/.test(dbName), "Campaign seed requires a fresh isolated fixture database.");
  const dbUrl = new URL(process.env.DATABASE_URL); dbUrl.pathname = `/${dbName}`;
  const leadsBySource = new Map([...new Set(historical.recipients.map((row) => row.lead_id))]
    .map((id, index) => [id, index + 3]));
  const sql = [];
  const ts = (value) => value == null ? "NULL" : `${q(value.replace("T", " "))}::timestamp`;
  const tz = (value) => value == null ? "NULL" : `${q(value)}::timestamptz`;
  for (const [sourceId, id] of leadsBySource) {
    const ordinal = String(id - 2).padStart(2, "0");
    sql.push(`INSERT INTO leads(id,first_name,last_name,email,phone,company_name,application_type,status,assigned_rep_id,lead_source,created_at,updated_at)
      VALUES (${id},'Historical','Fixture Recipient ${ordinal}',${q(`historical-recipient-${ordinal}@example.invalid`)},
      ${q(`+1202555${String(100 + id - 2).padStart(4, "0")}`)},${q(`Synthetic Campaign Recipient ${ordinal}`)},'equipment','contacted',3,'manual',now(),now());`);
  }
  const c = historical.campaign, launch = historical.launches[0];
  sql.push(`INSERT INTO campaigns(id,name,channel,status,email_template_id,audience_rules,scheduled_at,launched_at,completed_at,owner_id,created_by,version,created_at,updated_at,tracking_since,reply_to_email,flyer_delivery_mode)
    VALUES (5,${q(c.name)},${q(c.channel)},${q(c.status)},1,'{}'::jsonb,${tz(c.scheduled_at)},${tz(c.launched_at)},${tz(c.completed_at)},1,1,${c.version},${tz(c.created_at)},${tz(c.updated_at)},NULL,'fixture-replies@example.invalid',${q(c.flyer_delivery_mode)});`);
  sql.push(`INSERT INTO campaign_launches(id,campaign_id,idempotency_key,requested_by,mode,status,eligible_count,excluded_count,sent_count,failed_count,scheduled_at,started_at,completed_at,created_at)
    VALUES (5,5,'historical-fixture-launch-5',1,${q(launch.mode)},${q(launch.status)},${launch.eligible_count},${launch.excluded_count},${launch.sent_count},${launch.failed_count},${tz(launch.scheduled_at)},${tz(launch.started_at)},${tz(launch.completed_at)},${tz(launch.created_at)});`);
  for (const send of historical.sends) {
    const id = leadsBySource.get(send.lead_id), ordinal = String(id - 2).padStart(2, "0");
    sql.push(`INSERT INTO email_sends(id,lead_id,user_id,template_id,subject,to_email,from_email,status,sendgrid_message_id,sent_at,opened_at,clicked_at,created_at,updated_at,campaign_id,campaign_launch_id,delivery_kind)
      VALUES (${send.id},${id},1,1,${q("Vendors — Heavy Equipment (synthetic historical fixture)")},${q(`historical-recipient-${ordinal}@example.invalid`)},'fixture-sender@example.invalid',
      ${q(send.status)},NULL,${ts(send.sent_at)},${ts(send.opened_at)},${ts(send.clicked_at)},${ts(send.created_at)},${ts(send.updated_at)},5,5,${q(send.delivery_kind)});`);
  }
  for (const recipient of historical.recipients) {
    sql.push(`INSERT INTO campaign_recipients(id,launch_id,campaign_id,lead_id,channel,status,exclusion_reason,available_at,email_send_id,sent_at,created_at)
      VALUES (${recipient.id},5,5,${leadsBySource.get(recipient.lead_id)},${q(recipient.channel)},${q(recipient.status)},${recipient.exclusion_reason == null ? "NULL" : q(recipient.exclusion_reason)},
      ${tz(recipient.available_at)},${recipient.email_send_id},NULL,${tz(recipient.created_at)});`);
  }
  for (const [table, value] of [["leads", 15], ["campaigns", 5], ["campaign_launches", 5], ["campaign_recipients", 26], ["email_sends", 45]]) {
    sql.push(`SELECT setval(pg_get_serial_sequence('${table}','id'),${value},true);`);
  }
  const preflight = psql(dbUrl, `BEGIN;\n${sql.join("\n")}\nROLLBACK;`);
  atomicJson(folder, "campaign-sql-preflight.json", {
    status: "PASS", fixtureDatabase: dbName, generatedStatements: sql.length,
    transaction: "BEGIN; complete generated SQL; ROLLBACK", beforeBrowser: true,
    sourceSha256: createHash("sha256").update(bytes).digest("hex"), runId,
  });
  const inserted = psql(dbUrl, sql.join("\n"));
  const verify = JSON.parse(fixture.query("SELECT row_to_json(q) FROM (SELECT c.id,c.status,c.owner_id,c.created_by,l.requested_by,l.sent_count,(SELECT count(*) FROM campaign_recipients r WHERE r.campaign_id=c.id AND r.status='sent') AS recipient_sent,(SELECT count(*) FROM email_sends e WHERE e.campaign_id=c.id AND e.status IN ('delivered','opened','clicked')) AS email_sent,(SELECT count(*) FROM campaign_recipients r WHERE r.campaign_id=c.id AND r.sent_at IS NULL) AS recipient_sent_at_null,(SELECT count(*) FROM email_sends e WHERE e.campaign_id=c.id AND e.sent_at IS NOT NULL) AS email_sent_at_retained FROM campaigns c JOIN campaign_launches l ON l.campaign_id=c.id WHERE c.id=5) q"));
  check(verify.id === 5 && verify.status === "completed" && Number(verify.sent_count) === 13
    && Number(verify.recipient_sent) === 13 && Number(verify.owner_id) === 1
    && Number(verify.created_by) === 1 && Number(verify.requested_by) === 1
    && Number(verify.email_sent) === 13 && Number(verify.recipient_sent_at_null) === 13
    && Number(verify.email_sent_at_retained) === 13, `Campaign fixture verification failed: ${JSON.stringify(verify)}`);
  atomicJson(folder, "campaign-fixture-verification.json", {
    fixtureDatabase: dbName, campaignId: 5, launches: 1, recipients: 13, sends: 13,
    appropriateHistoricalOwnership: { ownerFixtureUserId: 1, creatorFixtureUserId: 1, launchRequesterFixtureUserId: 1 },
    verification: verify, sourceSha256: createHash("sha256").update(bytes).digest("hex"),
    productionDataRehearsalCertified: false, insertedSqlStdoutBytes: inserted.length,
  });
  return { historical, dbName, sourceHash: createHash("sha256").update(bytes).digest("hex") };
}

let outputFolder, runId, progress, stepCount = 0;
function updateProgress(patch = {}) {
  progress = { ...progress, ...patch, updatedAt: new Date().toISOString() };
  atomicJson(outputFolder, "continuation-progress.json", progress);
}
function recordStep(section, step, data = {}) {
  const row = { section, step, status: "passed", at: new Date().toISOString(), ...data };
  append(outputFolder, "journey-events.ndjson", row);
  stepCount++;
  updateProgress({ completedSteps: stepCount, lastStep: row });
}

function installTrace(page, role, phaseRef, section, traceId) {
  const ids = new WeakMap();
  const cdpMethods = new Map();
  const phaseGroup = "continuation";
  const pagePath = () => safeUrl(page.url()).path;
  const pwrPath = join(outputFolder, "network-events.ndjson");
  const statusPath = join(outputFolder, "http-status-events.ndjson");
  page.on("request", (request) => {
    const requestId = `${traceId}-pw-${randomUUID()}`; ids.set(request, requestId);
    append(outputFolder, "network-events.ndjson", {
      source: "Playwright", eventType: "request", runId, traceId, phaseGroup, section,
      role, phase: phaseRef.value, requestId, method: request.method(), url: safeUrl(request.url()),
      pagePathAtInitiation: pagePath(), resourceType: request.resourceType(), observedAt: new Date().toISOString(),
    });
  });
  page.on("response", (response) => {
    const row = {
      source: "Playwright", eventType: "response", runId, traceId, phaseGroup, section, role,
      phase: phaseRef.value, requestId: ids.get(response.request()), method: response.request().method(),
      url: safeUrl(response.url()), pagePathAtInitiation: pagePath(), status: response.status(),
      observedAt: new Date().toISOString(),
    };
    append(outputFolder, "network-events.ndjson", row);
    if (badStatuses.has(row.status)) append(outputFolder, "http-status-events.ndjson", row);
  });
  page.on("requestfailed", (request) => append(outputFolder, "request-failures.ndjson", {
    source: "Playwright", runId, traceId, phaseGroup, section, role, phase: phaseRef.value,
    requestId: ids.get(request), method: request.method(), url: safeUrl(request.url()),
    failure: safeText(request.failure()?.errorText), pagePathAtInitiation: pagePath(), observedAt: new Date().toISOString(),
  }));
  page.on("console", (message) => {
    if (message.type() === "error") append(outputFolder, "console-events.ndjson", {
      source: "Playwright", runId, traceId, phaseGroup, section, role, phase: phaseRef.value,
      message: safeText(message.text()), location: safeUrl(message.location().url || page.url()), observedAt: new Date().toISOString(),
    });
  });
  page.on("pageerror", (error) => append(outputFolder, "page-errors.ndjson", {
    source: "Playwright", runId, traceId, phaseGroup, section, role, phase: phaseRef.value,
    message: safeText(error.message), stack: safeText(error.stack), observedAt: new Date().toISOString(),
  }));
  return page.context().newCDPSession(page).then(async (cdp) => {
    await cdp.send("Network.enable");
    cdp.on("Network.requestWillBeSent", (event) => {
      cdpMethods.set(event.requestId, event.request.method);
      append(outputFolder, "cdp-network-events.ndjson", {
        source: "CDP", eventType: "request", runId, traceId, phaseGroup, section, role,
        phase: phaseRef.value, stableCdpRequestId: `${traceId}-cdp-${event.requestId}`,
        method: event.request.method, url: safeUrl(event.request.url), pagePathAtInitiation: pagePath(), observedAt: new Date().toISOString(),
      });
    });
    cdp.on("Network.responseReceived", (event) => {
      const row = {
        source: "CDP", eventType: "response", runId, traceId, phaseGroup, section, role,
        phase: phaseRef.value, stableCdpRequestId: `${traceId}-cdp-${event.requestId}`,
        method: cdpMethods.get(event.requestId) ?? "unknown", url: safeUrl(event.response.url),
        pagePathAtInitiation: pagePath(), status: event.response.status, observedAt: new Date().toISOString(),
      };
      append(outputFolder, "cdp-network-events.ndjson", row);
      if (badStatuses.has(row.status)) append(outputFolder, "cdp-http-status-events.ndjson", row);
    });
    return cdp;
  });
}

async function signInPending(page, userId, fixture) {
  const { token } = await clerkClient.signInTokens.createSignInToken({ userId, expiresInSeconds: 120 });
  await page.goto(`${fixture.url}/sign-in`);
  await page.waitForFunction(() => window.Clerk?.loaded, { timeout: 30000 });
  await page.evaluate(async (ticket) => {
    const result = await window.Clerk.client.signIn.create({ strategy: "ticket", ticket });
    if (result.status !== "complete") throw new Error("Pending synthetic login incomplete.");
    await window.Clerk.setActive({ session: result.createdSessionId });
  }, token);
  await page.waitForTimeout(300);
}

function insertRoleProbeRows(fixture, pendingClerkId) {
  const db = fixture.query("SELECT current_database()");
  const url = new URL(process.env.DATABASE_URL); url.pathname = `/${db}`;
  psql(url, `INSERT INTO deals(id,lead_id,deal_name,stage,amount,approx_gm,assigned_to,created_at,updated_at)
      VALUES (3,2,'Synthetic Unassigned Access Probe','waiting_on_app',50000,1000,NULL,now(),now());
    SELECT setval(pg_get_serial_sequence('deals','id'),3,true);
    INSERT INTO users(id,clerk_id,name,email,role,is_active,slug)
      VALUES (4,${q(pendingClerkId)},'Visual Pending','fixture-pending@example.invalid','pending',true,'fixture-pending');
    SELECT setval(pg_get_serial_sequence('users','id'),4,true);`);
  check(fixture.query("SELECT count(*) FROM deals WHERE id=3 AND assigned_to IS NULL") === "1",
    "Unassigned deal probe was not isolated in fixture.");
  check(fixture.query("SELECT count(*) FROM users WHERE id=4 AND role='pending'") === "1",
    "Pending role probe was not isolated in fixture.");
}

async function fetchSubmissions(page, dealId) {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/deals/${id}/submissions`, { method: "GET" });
    let body = null; try { body = await response.json(); } catch {}
    return { status: response.status, body };
  }, dealId);
}

async function dealReadJourney(role, fixture, browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", reducedMotion: "reduce", serviceWorkers: "block" });
  try {
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const phaseRef = { value: `candidate:continuation:${role}:deal-read` };
    const trace = await installTrace(page, role, phaseRef, "deal-read-retention", randomUUID());
    await fixture.login(page, role);
    const readWait = page.waitForResponse((r) => r.url().includes("/api/deals/1/submissions"));
    await page.goto(`${fixture.url}/deals/1`); await waitForPage(page, "deal-detail");
    const read = await readWait;
    check(read.request().method() === "GET" && read.status() === 200, `${role} assigned deal submissions read must be GET 200, got ${read.request().method()} ${read.status()}.`);
    const payload = await read.json();
    recordStep("deal-read-retention", `${role}-assigned-deal-read-200`, { role, method: "GET", status: 200, submissionCount: Array.isArray(payload) ? payload.length : null });
    if (role === "manager" || role === "admin") {
      phaseRef.value = `candidate:continuation:${role}:representative-filter`;
      await page.goto(`${fixture.url}/leads`); await waitForPage(page, "leads");
      const repFilter = page.getByRole("button", { name: "Filter by representative", exact: true });
      await repFilter.waitFor(); await repFilter.click();
      await page.getByRole("option").filter({ hasText: "Visual Fixture" }).first().waitFor();
      const repOptions = await page.getByRole("option").allTextContents();
      check(repOptions.some((option) => option.includes("Visual Fixture")), `${role} representative filter option missing.`);
      await page.getByRole("option").filter({ hasText: "Visual Fixture" }).first().click();
      recordStep("retention", `${role}-representative-filter-retained`, { role, options: repOptions });

      phaseRef.value = `candidate:continuation:${role}:new-deal-picker`;
      await page.goto(`${fixture.url}/deals/new`); await waitForPage(page, "new-deal");
      const assignedLabel = page.locator("label").filter({ hasText: /^Assigned rep$/ }).first();
      await assignedLabel.waitFor();
      const newPicker = page.getByRole("button", { name: "Unassigned", exact: true });
      await newPicker.waitFor(); check(await newPicker.isEnabled(), `${role} new-deal assignee picker is disabled.`);
      await newPicker.click(); await page.getByRole("option").filter({ hasText: "Visual Fixture" }).first().waitFor();
      const newOptions = await page.getByRole("option").allTextContents();
      check(newOptions.some((option) => option.includes("Visual Fixture")), `${role} new-deal picker lost the synthetic rep option.`);
      await page.getByRole("option", { name: "Unassigned", exact: true }).click();
      recordStep("retention", `${role}-assignee-picker-retained`, { role, options: newOptions, noSave: true });

      phaseRef.value = `candidate:continuation:${role}:deal-edit-picker`;
      await page.goto(`${fixture.url}/deals/1`); await waitForPage(page, "deal-detail");
      const button = page.getByRole("button", { name: "Edit Details", exact: true });
      await button.waitFor(); await button.click();
      const assigned = page.locator("label").filter({ hasText: /^Assigned rep$/ }).first(); await assigned.waitFor();
      const picker = assigned.locator("xpath=..").getByRole("button").first(); await picker.waitFor();
      check(await picker.isEnabled(), `${role} edit-deal assignee picker is disabled.`);
      await picker.click(); await page.getByRole("option").filter({ hasText: "Visual Fixture" }).first().waitFor();
      const options = await page.getByRole("option").allTextContents();
      check(options.some((option) => option.includes("Visual Fixture")), `${role} edit picker lost the synthetic rep option.`);
      await page.getByRole("option").filter({ hasText: "Visual Fixture" }).first().click();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      recordStep("retention", `${role}-edit-deal-picker-retained`, { role, noSave: true, fixtureOptionPresent: true });

      phaseRef.value = `candidate:continuation:${role}:credit-compliance`;
      await page.goto(`${fixture.url}/credit/compliance`); await waitForPage(page, "credit-compliance");
      if (role === "admin") {
        const creditFilter = page.getByRole("button", { name: "Filter by representative", exact: true });
        await creditFilter.waitFor(); await creditFilter.click();
        await page.getByRole("option").filter({ hasText: "Visual Fixture" }).first().waitFor();
        const creditOptions = await page.getByRole("option").allTextContents();
        check(creditOptions.some((option) => option.includes("Visual Fixture")), "Admin credit-compliance representative option missing.");
        await page.getByRole("option", { name: "All Reps", exact: true }).click();
        recordStep("retention", "admin-credit-filter-retained", { role, options: creditOptions });
      } else {
        await page.getByRole("heading", { name: "Admin Access Required", exact: true }).waitFor();
        check(await page.getByRole("button", { name: "Filter by representative", exact: true }).count() === 0,
          "Manager unexpectedly received an admin-only credit-compliance filter.");
        recordStep("retention", "manager-credit-compliance-admin-gate", { role });
      }
    }
    if (role === "rep") {
      phaseRef.value = "candidate:continuation:rep:unassigned-denial";
      const denied = await fetchSubmissions(page, 3);
      check(denied.status === 403 && denied.body?.error === "Forbidden",
        `Unassigned rep deal read must be denied with 403 Forbidden, got ${denied.status}.`);
      recordStep("deal-read-retention", "rep-unassigned-deal-denied", { role, method: "GET", status: denied.status, expectedDenial: true });
    }
    await trace.detach().catch(() => {});
  } finally { await context.close(); }
}

async function pendingDeniedJourney(pendingId, browser, fixture) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", reducedMotion: "reduce", serviceWorkers: "block" });
  try {
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const phaseRef = { value: "candidate:continuation:pending:deal-read-denial" };
    const trace = await installTrace(page, "pending", phaseRef, "pending-denial", randomUUID());
    await signInPending(page, pendingId, fixture);
    const result = await fetchSubmissions(page, 1);
    check(result.status === 403 && result.body?.code === "ACCOUNT_PENDING",
      `Pending user must be denied with ACCOUNT_PENDING, got ${result.status}/${result.body?.code}.`);
    recordStep("pending-denial", "pending-deal-read-denied", { role: "pending", method: "GET", status: 403, code: "ACCOUNT_PENDING", expectedDenial: true });
    await trace.detach().catch(() => {});
  } finally { await context.close(); }
}

async function leadsJourney(fixture, browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", reducedMotion: "reduce", serviceWorkers: "block" });
  try {
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const phaseRef = { value: "candidate:continuation:leads:login" };
    const trace = await installTrace(page, "admin", phaseRef, "leads-journey", randomUUID());
    await fixture.login(page, "admin");
    phaseRef.value = "candidate:continuation:leads:search";
    await page.goto(`${fixture.url}/leads`); await waitForPage(page, "leads");
    const search = page.getByPlaceholder("Search by name, email, company…", { exact: true });
    await search.fill("Synthetic Contact");
    await page.waitForFunction(() => { const r = [...document.querySelectorAll('[data-testid="table-leads-fit"] tbody tr')]; return r.length === 1 && r[0].textContent.includes("Synthetic Contact"); });
    recordStep("leads", "lead-search-name");
    await search.fill("Fixture Services LLC");
    await page.waitForFunction(() => { const r = [...document.querySelectorAll('[data-testid="table-leads-fit"] tbody tr')]; return r.length === 1 && r[0].textContent.includes("Fixture Services LLC"); });
    recordStep("leads", "lead-search-company");
    await search.fill("");
    const rows = page.locator('[data-testid="table-leads-fit"] tbody tr');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="table-leads-fit"] tbody tr').length === 2);
    const combos = page.getByRole("combobox");
    await combos.nth(0).click(); await page.getByRole("option", { name: "Contacted", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="table-leads-fit"] tbody tr').length === 1);
    recordStep("leads", "lead-status-filter");
    await combos.nth(0).click(); await page.getByRole("option", { name: "All Statuses", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="table-leads-fit"] tbody tr').length === 2);
    recordStep("leads", "lead-status-filter-reset");
    await combos.nth(1).click(); await page.getByRole("option", { name: "Equipment", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="table-leads-fit"] tbody tr').length === 1);
    recordStep("leads", "lead-type-filter");
    await combos.nth(1).click(); await page.getByRole("option", { name: "All Types", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="table-leads-fit"] tbody tr').length === 2);
    const repFilter = page.getByRole("button", { name: "Filter by representative", exact: true });
    await repFilter.click(); await page.getByRole("option").filter({ hasText: "Visual Fixture" }).first().waitFor();
    const repOptions = await page.getByRole("option").allTextContents();
    check(repOptions.some((option) => option.includes("Visual Fixture")), "Admin rep filter option missing.");
    await page.getByRole("option").filter({ hasText: "Visual Fixture" }).first().click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="table-leads-fit"] tbody tr').length === 2);
    recordStep("leads", "lead-representative-filter", { options: repOptions });
    const oldestRequest = page.waitForRequest((request) => { try { return new URL(request.url()).searchParams.get("sortOrder") === "asc"; } catch { return false; } });
    await combos.last().click(); await page.getByRole("option", { name: "Oldest First", exact: true }).click();
    const sortRequest = await oldestRequest;
    check(new URL(sortRequest.url()).searchParams.get("sortOrder") === "asc", "Oldest First did not request ascending order.");
    recordStep("leads", "lead-oldest-sort");
    await page.goto(`${fixture.url}/leads`); await waitForPage(page, "leads");
    const row = page.locator('[data-testid="table-leads-fit"] tbody tr').filter({ hasText: "Synthetic Contact" });
    const blank = await row.evaluate((tr) => {
      for (const td of tr.cells) for (const [x, y] of [[td.getBoundingClientRect().left + 3, td.getBoundingClientRect().top + 3], [td.getBoundingClientRect().right - 3, td.getBoundingClientRect().bottom - 3]]) {
        if (document.elementFromPoint(x, y) === td) return { x, y };
      }
      return null;
    });
    check(blank, "Could not identify blank lead-row background.");
    const before = page.url(); await page.mouse.click(blank.x, blank.y); check(page.url() === before, "Blank row background navigated.");
    recordStep("leads", "lead-blank-row-noop");
    const phone = row.locator('a[href^="tel:"]'); check(await phone.count() > 0, "Lead table phone link missing.");
    const phoneHref = await phone.first().getAttribute("href");
    await page.evaluate(() => { window.__telClicks = []; document.addEventListener("click", (event) => { const link = event.target.closest?.('a[href^="tel:"]'); if (link) { event.preventDefault(); window.__telClicks.push(link.href); } }, true); });
    const beforePhone = page.url(); await phone.first().click();
    check(page.url() === beforePhone && (await page.evaluate(() => window.__telClicks)).length === 1, "Phone action failed interception.");
    recordStep("leads", "lead-phone-action", { href: phoneHref });
    const email = row.locator('[data-contact-link="email"]'); await email.click(); await page.waitForURL(/\/leads\/1/);
    await page.getByRole("tab", { name: /^Comms/ }).waitFor();
    recordStep("leads", "lead-email-opens-comms");
    const detailPhone = page.locator('a[href^="tel:"]'); check(await detailPhone.count() > 0, "Lead detail phone action missing.");
    const beforeDetail = page.url(); await detailPhone.first().click(); check(page.url() === beforeDetail, "Lead detail phone action navigated.");
    recordStep("leads", "lead-detail-phone-action");
    await page.goto(`${fixture.url}/leads`); await page.getByRole("link", { name: /Synthetic Contact/ }).first().click(); await page.waitForURL(/\/leads\/1/);
    await waitForPage(page, "lead-detail"); recordStep("leads", "lead-name-link-opens-detail");
    await page.goto(`${fixture.url}/leads`); await waitForPage(page, "leads");
    const companyRow = page.locator('[data-testid="table-leads-fit"] tbody tr').filter({ hasText: "Synthetic Contact" });
    const companyLink = companyRow.getByRole("link").nth(1), companyHref = await companyLink.getAttribute("href");
    check(companyHref === "/leads/1", `Lead company link target changed: ${companyHref}`);
    await companyLink.click(); await page.waitForURL(/\/leads\/1/); await waitForPage(page, "lead-detail");
    recordStep("leads", "lead-company-link-opens-detail", { href: companyHref });
    check(stepCount >= 13, "The thirteen required Leads interactions were not recorded.");
    phaseRef.value = "candidate:continuation:leads:screenshots";
    for (const theme of ["light", "dark"]) {
      if (theme === "dark") { await page.goto(`${fixture.url}/settings`); await waitForPage(page, "settings"); await page.getByLabel("Appearance theme").selectOption("dark"); }
      for (const width of [390, 768, 1280, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${fixture.url}/leads`); await waitForPage(page, "leads");
        if (theme === "dark") check(await page.locator("html").getAttribute("data-appearance") === "dark", "Dark Leads theme did not persist.");
        const geometry = await page.evaluate(() => ({
          viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth,
          tableWidth: document.querySelector('[data-testid="table-leads-fit"] table')?.getBoundingClientRect().width ?? null,
        }));
        const name = `leads-${width}-${theme}.png`;
        await page.screenshot({ path: join(outputFolder, "screenshots", name) });
        recordStep("leads-screenshots", `leads-screenshot-${width}-${theme}`, { filename: name, geometry });
      }
    }
    const files = require("node:fs").readdirSync(join(outputFolder, "screenshots")).filter((name) => name.endsWith(".png"));
    check(files.length === 8, `Expected exactly eight Leads screenshots, found ${files.length}.`);
    await trace.detach().catch(() => {});
  } finally { await context.close(); }
}

async function campaignResults(fixture, browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", reducedMotion: "reduce", serviceWorkers: "block" });
  try {
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const phaseRef = { value: "candidate:continuation:admin:campaign-results" };
    const trace = await installTrace(page, "admin", phaseRef, "campaign-13", randomUUID());
    await fixture.login(page, "admin");
    const resultsPromise = page.waitForResponse((response) => response.url().includes("/api/campaigns/5/results"));
    const metricsPromise = page.waitForResponse((response) => response.url().includes("/api/campaigns/5/metrics"));
    await page.goto(`${fixture.url}/campaigns/5`);
    await page.getByText("Vendors — Heavy Equipment", { exact: true }).first().waitFor();
    await page.getByRole("tab", { name: "Results", exact: true }).click();
    const [resultsResponse, metricsResponse] = await Promise.all([resultsPromise, metricsPromise]);
    check(resultsResponse.status() === 200 && metricsResponse.status() === 200,
      `Campaign endpoints expected 200/200, got ${resultsResponse.status()}/${metricsResponse.status()}.`);
    const results = await resultsResponse.json(), metrics = await metricsResponse.json();
    check(results.counts.sent === 13 && results.launches?.length === 1, `Results count differs: ${JSON.stringify(results.counts)}.`);
    check(metrics.sent === 13 && metrics.trackingSince == null, `Metrics count/disclosure differs: ${JSON.stringify(metrics)}.`);
    const legacy = page.getByText("Sent", { exact: true }).first().locator("..");
    const kpi = page.getByTestId("kpi-sent");
    await page.getByText("Campaign Results", { exact: true }).waitFor(); await kpi.waitFor();
    check((await legacy.innerText()).includes("13") && (await kpi.innerText()).includes("13"), "Legacy/new Sent KPI must both show 13.");
    check((await page.getByTestId("panel-campaign-kpis").innerText()).includes("Historical tracking not available"),
      "Historical tracking disclosure missing.");
    check((await page.getByTestId("kpi-uniqueClicks").innerText()).includes("Not tracked")
      && (await page.getByTestId("kpi-replies").innerText()).includes("Not tracked"), "Unknown metrics must say Not tracked.");
    recordStep("campaign-13", "admin-results-metrics-13", { resultsStatus: 200, metricsStatus: 200, sent: 13, oneLaunch: true, trackingSince: null });
    await trace.detach().catch(() => {});
  } finally { await context.close(); }
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes("--continue")) throw new Error("Use --continue --managed-task-id=<new-main-task-id>; --check-ready-only is a non-browser gate.");
  const taskArg = args.find((arg) => arg.startsWith("--managed-task-id="))?.split("=")[1];
  check(/^[A-Za-z0-9][A-Za-z0-9._-]{3,79}$/.test(taskArg ?? ""), "A Main-managed task ID is required.");
  runId = taskArg;
  const lock = validatePins();
  check(taskArg === lock.continuationManagedTaskId, "Main-managed task ID is not authorized.");
  const original = originalRunAudit();
  outputFolder = join(outputRoot, runId);
  check(!require("node:fs").existsSync(outputFolder), `Continuation output already exists: ${outputFolder}`);
  mkdirSync(join(outputFolder, "screenshots"), { recursive: true });
  progress = {
    runId, status: "starting", taskKind: "focused-continuation",
    originalRun: original.originalRunStatus, targetRevision: lock.targetRevision,
    candidateApiSourceTreeSha256: lock.candidateApiSourceTreeSha256,
    candidateApiDistSha256: lock.candidateApiDistSha256,
    expectedSections: ["admin-manager-rep deal reads/retention", "pending denial", "Leads 13 interactions", "Leads 8 screenshots", "admin Campaign 13"],
    completedSteps: 0, startedAt: new Date().toISOString(),
  };
  atomicJson(outputFolder, "original-run-audit.json", original);
  atomicJson(outputFolder, "continuation-progress.json", progress);
  const fixture = await startSandbox({ build: false, webRoot: resolve(root, lock.candidateWebRoot), port: lock.port });
  let browser, pendingUser, fixtureDbName;
  try {
    const campaign = await seedCampaign(fixture, outputFolder, runId);
    fixtureDbName = campaign.dbName;
    const pendingEmail = `visual-pending-${Date.now()}@example.com`;
    pendingUser = await clerkClient.users.createUser({
      firstName: "Visual", lastName: "Pending", emailAddress: [pendingEmail], skipPasswordRequirement: true,
    });
    insertRoleProbeRows(fixture, pendingUser.id);
    atomicJson(outputFolder, "fixture-source-proof.json", {
      sourceKind: "schema-only fixture", fixtureDatabase: campaign.dbName,
      productionDataRehearsalCertified: false, campaignId: 5, sends: 13,
      roleProbes: { assignedDealId: 1, unassignedDealId: 3, pendingUserId: 4 },
    });
    browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", headless: true });
    updateProgress({ status: "running", phase: "deal-read-retention" });
    await dealReadJourney("admin", fixture, browser);
    await dealReadJourney("manager", fixture, browser);
    await dealReadJourney("rep", fixture, browser);
    await pendingDeniedJourney(pendingUser.id, browser, fixture);
    updateProgress({ phase: "leads-13-plus-eight-shots" });
    await leadsJourney(fixture, browser);
    updateProgress({ phase: "admin-campaign-13" });
    await campaignResults(fixture, browser);
    const network = readNdjson(join(outputFolder, "network-events.ndjson"));
    const continuationResponses = network.filter((row) => row.source === "Playwright" && row.eventType === "response");
    const expectedDenials = continuationResponses.filter((row) =>
      row.status === 403 && row.url?.path === "/api/deals/[REDACTED_ID]/submissions"
      && ["candidate:continuation:rep:unassigned-denial", "candidate:continuation:pending:deal-read-denial"].includes(row.phase));
    const unexpected = continuationResponses.filter((row) => badStatuses.has(row.status) && !expectedDenials.includes(row));
    const nonGetSubmissionRequests = network.filter((row) => row.source === "Playwright" && row.eventType === "request"
      && row.url?.path === "/api/deals/[REDACTED_ID]/submissions" && row.method !== "GET");
    const consoleRows = readNdjson(join(outputFolder, "console-events.ndjson"));
    const pageErrors = readNdjson(join(outputFolder, "page-errors.ndjson"));
    const cdpRows = readNdjson(join(outputFolder, "cdp-http-status-events.ndjson"));
    const journeys = readNdjson(join(outputFolder, "journey-events.ndjson"));
    const leadsSteps = journeys.filter((row) => row.section === "leads");
    const screenshotSteps = journeys.filter((row) => row.section === "leads-screenshots");
    const managerFresh = journeys.some((row) => row.step === "manager-assigned-deal-read-200")
      && journeys.some((row) => row.step === "manager-edit-deal-picker-retained")
      && journeys.some((row) => row.step === "manager-assignee-picker-retained")
      && journeys.some((row) => row.step === "manager-representative-filter-retained")
      && journeys.some((row) => row.step === "manager-credit-compliance-admin-gate");
    const adminFresh = journeys.some((row) => row.step === "admin-assigned-deal-read-200")
      && journeys.some((row) => row.step === "admin-edit-deal-picker-retained")
      && journeys.some((row) => row.step === "admin-assignee-picker-retained")
      && journeys.some((row) => row.step === "admin-representative-filter-retained")
      && journeys.some((row) => row.step === "admin-credit-filter-retained");
    const repFresh = journeys.some((row) => row.step === "rep-assigned-deal-read-200")
      && journeys.some((row) => row.step === "rep-unassigned-deal-denied");
    const expectedConsole = consoleRows.filter((row) =>
      ["candidate:continuation:rep:unassigned-denial", "candidate:continuation:pending:deal-read-denial"].includes(row.phase)
      && /403|Forbidden|ACCOUNT_PENDING|awaiting approval/i.test(row.message));
    const unexpectedConsole = consoleRows.filter((row) => !expectedConsole.includes(row));
    const originalUnexpectedBad = roles.flatMap((role) => original.originalRawCandidateByRole[role].badStatuses
      .filter((row) => !(role === "manager" && row.phase === original.supersededManagerFailurePhase.phase)));
    const originalUnexpectedConsole = roles.reduce((sum, role) => sum
      + Math.max(0, original.originalRawCandidateByRole[role].consoleErrors
        - (role === "manager" ? original.supersededManagerFailurePhase.consoleErrors : 0)), 0);
    const cleanScopeByRole = Object.fromEntries(roles.map((role) => {
      const oldBad = original.originalRawCandidateByRole[role].badStatuses
        .filter((row) => !(role === "manager" && row.phase === original.supersededManagerFailurePhase.phase));
      const freshBad = unexpected.filter((row) => row.role === role);
      const oldConsole = Math.max(0, original.originalRawCandidateByRole[role].consoleErrors
        - (role === "manager" ? original.supersededManagerFailurePhase.consoleErrors : 0));
      const freshConsole = unexpectedConsole.filter((row) => row.role === role).length;
      const expected403 = expectedDenials.filter((row) => row.role === role).length;
      return [role, {
        retainedOriginalBadResponses: oldBad.length,
        freshUnexpectedBadResponses: freshBad.length,
        retainedOriginalConsoleErrors: oldConsole,
        freshUnexpectedConsoleErrors: freshConsole,
        expectedPolicyDenials403: expected403,
        clean: oldBad.length === 0 && freshBad.length === 0 && oldConsole === 0 && freshConsole === 0,
      }];
    }));
    const fullClean = unexpected.length === 0 && unexpectedConsole.length === 0 && pageErrors.length === 0
      && originalUnexpectedBad.length === 0 && originalUnexpectedConsole === 0
      && original.rolePolicyRoutes === 11 && original.rolePolicyAllZeroControls && original.repDirectoryListRequests === 0
      && leadsSteps.length === 13 && screenshotSteps.length === 8 && managerFresh && adminFresh && repFresh
      && expectedDenials.length === 2 && nonGetSubmissionRequests.length === 0
      && journeys.some((row) => row.step === "pending-deal-read-denied")
      && journeys.some((row) => row.step === "admin-results-metrics-13");
    const result = {
      status: fullClean ? "CONTINUATION_SECTIONS_COMPLETE" : "CONTINUATION_SECTIONS_FAILED",
      originalMainRunStatus: original.originalRunStatus,
      originalMainRunExitCode: "unknown; no terminal exit record; never synthesized",
      retainedStructurePass: original.retainedStructureProof.structuralComparison.pass,
      newTargetRevision: lock.targetRevision,
      newApiPins: { source: lock.candidateApiSourceTreeSha256, dist: lock.candidateApiDistSha256 },
      originalRawManager403AndConsoleErrors: original.supersededManagerFailurePhase,
      managerPhaseSupersession: {
        oldPhase: original.supersededManagerFailurePhase.phase,
        replacementSteps: journeys.filter((row) => row.role === "manager").map((row) => row.step),
        replacedOnlyIfFreshManagerFullRetentionPass: managerFresh,
        originalRecordsPreserved: true,
      },
      continuationRawPwrResponsesByRole: Object.fromEntries([...new Set(continuationResponses.map((row) => row.role))]
        .map((role) => [role, continuationResponses.filter((row) => row.role === role).map((row) => ({ phase: row.phase, path: row.url?.path, status: row.status }))])),
      expected403Denials: expectedDenials.map((row) => ({ role: row.role, phase: row.phase, path: row.url?.path, status: row.status })),
      unexpectedCandidateBadStatuses: unexpected.map((row) => ({ role: row.role, phase: row.phase, path: row.url?.path, status: row.status })),
      nonGetSubmissionsRequests: nonGetSubmissionRequests.length,
      cdpBadStatusEvents: cdpRows.map((row) => ({ role: row.role, phase: row.phase, path: row.url?.path, status: row.status })),
      rawConsoleErrorCount: consoleRows.length, expectedDenialConsoleErrors: expectedConsole.length,
      unexpectedConsoleErrorCount: unexpectedConsole.length, pageErrorCount: pageErrors.length,
      originalRawCandidateDefectsPreserved: original.originalRawCandidateByRole,
      originalCleanScopeExclusion: {
        onlyPhase: original.supersededManagerFailurePhase.phase,
        oldManager403Records: original.supersededManagerFailurePhase.pwr403,
        oldManagerConsoleErrors: original.supersededManagerFailurePhase.consoleErrors,
        freshManagerReplacementPassed: managerFresh,
      },
      combinedCleanScopeByRole: cleanScopeByRole,
      leadsInteractions: leadsSteps.length, leadsScreenshots: screenshotSteps.length,
      campaign: journeys.find((row) => row.step === "admin-results-metrics-13") ?? null,
      fullCertificationExitCode: "not asserted here; original main task remains interrupted",
      continuationExitCode: fullClean ? 0 : 1,
      completedAt: new Date().toISOString(),
    };
    atomicJson(outputFolder, "continuation-summary.json", result);
    const imgs = ["light", "dark"].flatMap((theme) => [390, 768, 1280, 1440].map((width) => `screenshots/leads-${width}-${theme}.png`));
    writeFileSync(join(outputFolder, "gallery.html"), `<!doctype html><meta charset="utf-8"><title>Continuation evidence gallery</title><h1>Leads continuation screenshots</h1><p>Schema-only fixture. Original run remains separately recorded as interrupted; this gallery does not certify production data.</p><main>${imgs.map((file) => `<figure><img src="${file}" alt="${file}" loading="lazy"><figcaption>${file}</figcaption></figure>`).join("")}</main><style>body{font:16px system-ui;margin:2rem}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem}img{max-width:100%;height:auto;border:1px solid #aaa}figure{margin:0}</style>`);
    updateProgress({ status: fullClean ? "completed" : "failed", phase: "finished", continuationExitCode: result.continuationExitCode });
    if (!fullClean) process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (pendingUser) await clerkClient.users.deleteUser(pendingUser.id).catch(() => {});
    await fixture.close();
    const absentUsers = [];
    for (const id of createdUsers) {
      let absent = false;
      try { await clerkClient.users.getUser(id); }
      catch (error) { absent = error?.status === 404 || /not found|already deleted/i.test(String(error?.message)); }
      absentUsers.push({ id, absent });
    }
    const catalog = spawnSync("psql", [`--dbname=${process.env.DATABASE_URL}`, "--no-psqlrc", "--tuples-only", "--no-align",
      "--set=connect_timeout=3", "--command", `SELECT datname FROM pg_database WHERE datname='${fixtureDbName}'`],
    { encoding: "utf8", timeout: 5000 });
    const databaseAbsent = catalog.status === 0 && catalog.stdout.trim() === "";
    atomicJson(outputFolder, "cleanup-verification.json", {
      sourceKind: "schema-only fixture", fixtureDatabase: fixtureDbName, fixtureDatabaseAbsent: databaseAbsent,
      fixtureClosedBySandbox: true, createdSyntheticUsers: createdUsers.size, deletedAndAbsentUsers: absentUsers.filter((row) => row.absent).length,
      individualUserAbsenceChecks: absentUsers, verifiedAt: new Date().toISOString(),
    });
    if (!databaseAbsent || absentUsers.some((row) => !row.absent)) process.exitCode = 1;
  }
}

async function readyOnly() {
  const lock = validatePins();
  const audit = originalRunAudit();
  console.log(JSON.stringify({
    ready: true, browserLaunched: false, targetRevision: lock.targetRevision,
    candidateApiSourceTreeSha256: lock.candidateApiSourceTreeSha256,
    candidateApiDistSha256: lock.candidateApiDistSha256,
    originalRunStatus: audit.originalRunStatus,
    originalManager403Count: audit.supersededManagerFailurePhase.pwr403,
    originalManagerConsoleErrorCount: audit.supersededManagerFailurePhase.consoleErrors,
    retainedStructurePass: audit.retainedStructureProof.structuralComparison.pass,
    retentionsRecorded: audit.originalRetentionJourneyEvents,
  }, null, 2));
}

if (process.argv.includes("--check-ready-only")) readyOnly().catch((error) => { console.error(error); process.exitCode = 1; });
else main().catch((error) => {
  if (outputFolder) {
    atomicJson(outputFolder, "failure.json", { status: "FAILED", message: safeText(error.stack ?? error), at: new Date().toISOString() });
    updateProgress({ status: "failed", failure: safeText(error.message) });
  }
  console.error(error);
  process.exitCode = 1;
});
