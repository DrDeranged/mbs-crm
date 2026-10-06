// Focused remainder only: Leads 13 + 8 captures and Campaign 13. This runner
// consumes, but never repeats, the retained structure and successful task3 role evidence.
import { chromium } from "@playwright/test";
import { appendFileSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { join, resolve, sep } from "node:path";
import { startSandbox } from "../../scripts/visual-refresh/sandbox.mjs";
import { waitForPage } from "../../scripts/visual-refresh/readiness.mjs";

const root = resolve(import.meta.dirname, "../..");
const reportRoot = join(root, "reports/role-directory-certification");
const continuationRoot = join(reportRoot, "continuation");
const outputRoot = join(continuationRoot, "runs");
const priorRun = join(continuationRoot, "runs/3_fdWq7W");
const oldRun = join(reportRoot, "run");
const authorizationPath = join(reportRoot, "launch-authorization.json");
const priorAuthorizationPath = join(oldRun, "authorization-used.json");
const structureProofPath = join(continuationRoot, "retained-structure-proof.json");
const campaignFixturePath = join(root, ".local/certification-853f4e4/historical-campaign.json");
const policyPath = join(reportRoot, "policy.json");
const originalRunnerPath = join(reportRoot, "role-directory-certification.mjs");
const fullRunnerPath = join(reportRoot, "continuation-runner.mjs");
const sandboxPath = join(root, "scripts/visual-refresh/sandbox.mjs");
const readinessPath = join(root, "scripts/visual-refresh/readiness.mjs");
const webSourcePath = join(root, "artifacts/mbs-crm/src");
const apiSourcePath = join(root, "artifacts/api-server/src");
const apiDistPath = join(root, "artifacts/api-server/dist");
const baselinePath = join(root, ".local/certification-2af927c/baselines/target-2af927c");
const require = createRequire(join(root, "artifacts/api-server/package.json"));
const { clerkClient } = require("@clerk/express");

const BAD = new Set([403, 404, 503]);
const SAFE_BUSINESS_QUERY = new Set([
  "page", "limit", "sortBy", "sortOrder", "search", "q", "status", "applicationType",
  "isActive", "role", "assignedRepId", "assignedTo", "leadId", "campaignId", "archived",
  "granularity", "startDate", "endDate",
]);
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
const text = (value, max = 800) => String(value ?? "").replace(/[\r\n\t]+/g, " ").slice(0, max);
const shaFile = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const check = (ok, message) => { if (!ok) throw new Error(message); };
let outputFolder, runId, progress, browser, fixture, fixtureDbName;
let currentPhase = "readiness", diagnostic = null, sectionCounts = {};
const created = new Set();

const originalCreateUser = clerkClient.users.createUser.bind(clerkClient.users);
const originalDeleteUser = clerkClient.users.deleteUser.bind(clerkClient.users);
clerkClient.users.createUser = async (...args) => {
  const user = await originalCreateUser(...args);
  created.add(user.id);
  return user;
};
clerkClient.users.deleteUser = async (id) => {
  try { return await originalDeleteUser(id); }
  catch (error) {
    if (error?.status === 404 || /not found|already deleted/i.test(String(error?.message))) return;
    throw error;
  }
};

function shaTree(directory) {
  const hash = createHash("sha256");
  function visit(folder, rel = "") {
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(rel, entry.name);
      if (entry.isDirectory()) visit(join(folder, entry.name), path);
      else if (entry.isFile()) { hash.update(path); hash.update("\0"); hash.update(readFileSync(join(folder, entry.name))); hash.update("\0"); }
    }
  }
  visit(directory);
  return hash.digest("hex");
}
function safeUrl(raw) {
  const url = new URL(raw || "http://fixture.invalid/");
  for (const key of [...url.searchParams.keys()]) if (!SAFE_BUSINESS_QUERY.has(key)) url.searchParams.set(key, "[REDACTED]");
  url.pathname = url.pathname
    .replace(/(\/api\/deals\/)\d+/g, "$1[REDACTED_ID]")
    .replace(/(\/api\/leads\/)\d+/g, "$1[REDACTED_ID]")
    .replace(/(\/deals\/)\d+/g, "$1[REDACTED_ID]")
    .replace(/(\/leads\/)\d+/g, "$1[REDACTED_ID]");
  return { origin: url.origin, path: url.pathname, search: url.search };
}
function atomicJson(folder, name, value) {
  const target = join(folder, name), temp = `${target}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temp, target);
}
function append(folder, name, row) { appendFileSync(join(folder, name), `${JSON.stringify(row)}\n`); }
function readNdjson(path) {
  try { return readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)); }
  catch { return []; }
}
function updateProgress(patch = {}) {
  progress = { ...progress, ...patch, updatedAt: new Date().toISOString() };
  atomicJson(outputFolder, "remaining-progress.json", progress);
}
function checkpoint(section, status, detail = {}) {
  const record = { section, status, detail, at: new Date().toISOString() };
  append(outputFolder, "section-checkpoints.ndjson", record);
  sectionCounts[section] = { status, ...detail, at: record.at };
  atomicJson(outputFolder, "section-checkpoints.json", sectionCounts);
  updateProgress({ phase: section, sectionStatus: status, sections: sectionCounts });
}
function step(section, name, detail = {}) {
  const record = { section, step: name, status: "passed", ...detail, at: new Date().toISOString() };
  append(outputFolder, "journey-events.ndjson", record);
  updateProgress({ completedSteps: (progress.completedSteps ?? 0) + 1, lastStep: record });
}

function task3Evidence() {
  const journey = readNdjson(join(priorRun, "journey-events.ndjson"));
  const network = readNdjson(join(priorRun, "network-events.ndjson"));
  const statuses = readNdjson(join(priorRun, "http-status-events.ndjson"));
  const cdpStatuses = readNdjson(join(priorRun, "cdp-http-status-events.ndjson"));
  const consoles = readNdjson(join(priorRun, "console-events.ndjson"));
  const pageErrors = readNdjson(join(priorRun, "page-errors.ndjson"));
  const requestFailures = readNdjson(join(priorRun, "request-failures.ndjson"));
  const progress3 = JSON.parse(readFileSync(join(priorRun, "continuation-progress.json"), "utf8"));
  const exit3 = JSON.parse(readFileSync(join(continuationRoot, "managed-exit.json"), "utf8"));
  const cleanup3 = JSON.parse(readFileSync(join(priorRun, "cleanup-verification.json"), "utf8"));
  const required = [
    "admin-assigned-deal-read-200", "admin-representative-filter-retained", "admin-assignee-picker-retained",
    "admin-edit-deal-picker-retained", "admin-credit-filter-retained", "manager-assigned-deal-read-200",
    "manager-representative-filter-retained", "manager-assignee-picker-retained", "manager-edit-deal-picker-retained",
    "manager-credit-compliance-admin-gate", "rep-assigned-deal-read-200", "rep-unassigned-deal-denied", "pending-deal-read-denied",
  ];
  check(exit3.taskId === "3_fdWq7W" && exit3.exitCode === 1, "Task3 exit record differs; do not repeat role checks.");
  check(progress3.status === "failed" && progress3.lastStep?.step === "lead-search-company",
    "Task3 failure checkpoint differs from the reviewed runner-count defect.");
  check(required.every((name) => journey.some((row) => row.step === name)),
    "Task3 is missing one or more completed role/security journey assertions.");
  for (const [name, expected] of [
    ["admin-assigned-deal-read-200", 200], ["manager-assigned-deal-read-200", 200],
    ["rep-assigned-deal-read-200", 200], ["rep-unassigned-deal-denied", 403], ["pending-deal-read-denied", 403],
  ]) check(journey.find((row) => row.step === name)?.status === expected, `Task3 outcome for ${name} is not ${expected}.`);
  const exactProbe = (row, role, phase) => row.role === role && row.phase === phase
    && row.status === 403 && row.url?.path === "/api/deals/[REDACTED_ID]/submissions";
  const probes = [
    { role: "rep", phase: "candidate:continuation:rep:unassigned-denial" },
    { role: "pending", phase: "candidate:continuation:pending:deal-read-denial" },
  ];
  check(statuses.length === 2 && probes.every((probe) => statuses.filter((row) => exactProbe(row, probe.role, probe.phase)).length === 1),
    "Task3 raw security-probe statuses differ from the two authorized 403 probes.");
  check(cdpStatuses.length === 2 && probes.every((probe) => cdpStatuses.filter((row) => exactProbe(row, probe.role, probe.phase)).length === 1),
    "Task3 raw CDP status evidence differs from the two authorized 403 probes.");
  check(consoles.length === 2 && probes.every((probe) => consoles.filter((row) =>
    row.role === probe.role && row.phase === probe.phase && /403|Forbidden/i.test(row.message)).length === 1),
  "Task3 expected security-probe console evidence differs.");
  check(pageErrors.length === 0 && requestFailures.length === 0, "Task3 has page errors or request failures.");
  const usersList = network.filter((row) => row.role === "rep" && row.eventType === "request"
    && /^\/api\/(users|reps|representatives)(\/|$)/.test(row.url?.path ?? ""));
  check(usersList.length === 0, "Task3 rep attempted a user/representative directory request.");
  const managerFresh = journey.some((row) => row.step === "manager-assigned-deal-read-200" && row.status === 200)
    && journey.some((row) => row.step === "manager-edit-deal-picker-retained")
    && journey.some((row) => row.step === "manager-assignee-picker-retained")
    && journey.some((row) => row.step === "manager-representative-filter-retained")
    && journey.some((row) => row.step === "manager-credit-compliance-admin-gate");
  const adminFresh = journey.some((row) => row.step === "admin-assigned-deal-read-200" && row.status === 200)
    && journey.some((row) => row.step === "admin-edit-deal-picker-retained")
    && journey.some((row) => row.step === "admin-assignee-picker-retained")
    && journey.some((row) => row.step === "admin-representative-filter-retained")
    && journey.some((row) => row.step === "admin-credit-filter-retained");
  check(managerFresh && adminFresh, "Task3 manager/admin replacement retention checks are incomplete.");
  check(cleanup3.fixtureDatabaseAbsent && cleanup3.deletedAndAbsentUsers === 4,
    "Task3 fixture cleanup has not been verified.");
  const statusCounts = {};
  for (const role of ["admin", "manager", "rep", "pending"]) {
    const responses = network.filter((row) => row.role === role && row.eventType === "response");
    statusCounts[role] = Object.fromEntries([...new Set(responses.map((row) => row.status))]
      .sort((a, b) => a - b).map((code) => [code, responses.filter((row) => row.status === code).length]));
  }
  const originalFailures = readNdjson(join(oldRun, "http-status-events.ndjson"))
    .filter((row) => row.phaseGroup === "candidate" && row.role === "manager"
      && row.phase === "candidate:manager-retention:deal-edit" && row.status === 403);
  const originalConsole = readNdjson(join(oldRun, "console-events.ndjson"))
    .filter((row) => row.phaseGroup === "candidate" && row.role === "manager"
      && row.phase === "candidate:manager-retention:deal-edit");
  check(originalFailures.length === 2 && originalConsole.length === 2,
    "Original manager 403/console provenance was changed or is missing.");
  const structure = JSON.parse(readFileSync(structureProofPath, "utf8"));
  check(structure.structuralComparison?.pass === true && structure.structuralComparison?.cases === 36
    && structure.frontendPinComparison?.allMatch === true
    && structure.changedEndpointTraceAudit?.playwrightRequestsOrResponsesInStructuralPhases === 0
    && structure.changedEndpointTraceAudit?.cdpEventsInStructuralPhases === 0,
  "The retained 36-case structure proof is not valid.");
  const policyRows = readNdjson(join(oldRun, "role-policy-events.ndjson"));
  check(policyRows.length === 11 && policyRows.every((row) => Array.isArray(row.controls) && row.controls.length === 0),
    "The retained 11-route role-policy evidence is not valid.");
  return {
    taskId: exit3.taskId, targetRevision: exit3.targetRevision, exitCode: exit3.exitCode,
    failedAt: progress3.lastStep?.step, failure: JSON.parse(readFileSync(join(priorRun, "failure.json"), "utf8")).message,
    requiredRoleJourneyChecks: required, freshRoleChecksPassed: true,
    rawRoleResponseCounts: statusCounts,
    expectedSecurityProbe403s: statuses.map((row) => ({ role: row.role, phase: row.phase, path: row.url?.path, status: row.status })),
    expectedSecurityProbeConsoleErrors: consoles.map((row) => ({ role: row.role, phase: row.phase, message: row.message })),
    authorizedUiRawBadStatusCount: 0, authorizedUiConsoleErrors: 0, pageErrors: 0, requestFailures: 0,
    repDirectoryRequests: usersList.length, managerReplacementPassed: managerFresh,
    adminRetentionPassed: adminFresh, originalManager403s: originalFailures.length,
    originalManagerConsoleErrors: originalConsole.length, originalFailureRecordsPreserved: true,
    retainedStructure: { cases: structure.structuralComparison.cases, pass: true, webPinsMatch: true, changedRouteCapturePwr: 0, changedRouteCaptureCdp: 0 },
    retainedRolePolicyRoutes: policyRows.length, retainedRolePolicyControls: 0,
    fixtureCleanup: { databaseAbsent: cleanup3.fixtureDatabaseAbsent, syntheticUsersAbsent: cleanup3.deletedAndAbsentUsers },
  };
}

function validateInputs(requireSelfPin = false) {
  const lock = JSON.parse(readFileSync(authorizationPath, "utf8"));
  const prior = JSON.parse(readFileSync(priorAuthorizationPath, "utf8"));
  check(lock.sourceFinalized === true && lock.elevenGatePreflightExit === 0
    && lock.immutablePinsFrozen === true && lock.launchAuthorized === true,
  "Main's current source/API/11-gate lock is not fully authorized.");
  check(/^[0-9a-f]{40}$/.test(lock.targetRevision) && /^[0-9a-f]{40}$/.test(lock.localSnapshot),
    "Main lock is missing final source revision or local snapshot.");
  const unchanged = [
    "candidateWebSourceTreeSha256", "candidateWebTreeSha256", "candidateIndexSha256",
    "baselineWebTreeSha256", "approvalPolicySha256", "runnerSha256", "sandboxHelperSha256",
    "readinessHelperSha256", "historicalCampaignFixtureSha256",
  ];
  for (const name of unchanged) check(lock[name] === prior[name], `Unchanged certification pin ${name} differs.`);
  check(lock.candidateWebRoot === prior.candidateWebRoot && lock.baselineRevision === prior.baselineRevision,
    "Candidate web root or approved baseline revision changed.");
  check(shaTree(webSourcePath) === prior.candidateWebSourceTreeSha256, "Frontend source pin changed.");
  const webRoot = resolve(root, lock.candidateWebRoot);
  check(webRoot.startsWith(root + sep) && shaTree(webRoot) === prior.candidateWebTreeSha256
    && shaFile(join(webRoot, "index.html")) === prior.candidateIndexSha256, "Frozen web build/index pin changed.");
  check(shaTree(baselinePath) === prior.baselineWebTreeSha256 && shaFile(policyPath) === prior.approvalPolicySha256,
    "Baseline or certification policy pin changed.");
  check(shaFile(originalRunnerPath) === prior.runnerSha256, "Frozen original runner changed.");
  check(shaFile(sandboxPath) === prior.sandboxHelperSha256 && shaFile(readinessPath) === prior.readinessHelperSha256,
    "Sandbox or readiness helper pin changed.");
  check(shaFile(campaignFixturePath) === prior.historicalCampaignFixtureSha256, "Historical campaign fixture pin changed.");
  check(lock.continuationRunnerSha256 === shaFile(fullRunnerPath), "Frozen full-continuation runner pin changed.");
  check(/^[0-9a-f]{64}$/.test(lock.candidateApiSourceTreeSha256) && shaTree(apiSourcePath) === lock.candidateApiSourceTreeSha256,
    "Current API source differs from Main's locked API pin.");
  check(/^[0-9a-f]{64}$/.test(lock.candidateApiDistSha256) && shaTree(apiDistPath) === lock.candidateApiDistSha256,
    "Current API dist differs from Main's locked API pin.");
  check(Number.isInteger(lock.port) && lock.port >= 4300 && lock.port <= 4499, "Main has not assigned an isolated fixture port.");
  const evidencePath = resolve(root, lock.preflightEvidence?.path ?? "");
  check(lock.preflightEvidence?.exitCode === 0 && evidencePath.startsWith(root + sep)
    && shaFile(evidencePath) === lock.preflightEvidence.sha256, "Current Main 11-gate evidence hash is invalid.");
  const previousSql = JSON.parse(readFileSync(join(oldRun, "campaign-sql-preflight.json"), "utf8"));
  check(previousSql.status === "PASS" && previousSql.generatedStatements === 46
    && previousSql.sourceSha256 === shaFile(campaignFixturePath), "Historical campaign rollback-preflight proof is invalid.");
  const roles = task3Evidence();
  if (requireSelfPin) {
    check(lock.remainingRunnerSha256 === shaFile(import.meta.filename),
      "Main's remainingRunnerSha256 does not match this prepared file.");
    check(typeof lock.managedTaskId === "string" && lock.managedTaskId.length >= 4,
      "Main authorization does not contain the remaining runner managedTaskId.");
  }
  return { lock, roles, prior };
}

function sql(databaseUrl, source) {
  const result = spawnSync("psql", [`--dbname=${databaseUrl}`, "--no-psqlrc", "--set=ON_ERROR_STOP=on", "--command", source],
    { encoding: "utf8", timeout: 15000 });
  check(result.status === 0, `Synthetic remaining-fixture SQL failed: ${text(result.stderr || result.error?.message)}`);
  return result.stdout.trim();
}
async function seedCampaignOnly(fixture) {
  const historical = JSON.parse(readFileSync(campaignFixturePath, "utf8"));
  check(historical.campaign?.id === 5 && historical.campaign.status === "completed"
    && historical.launches?.length === 1 && historical.recipients?.length === 13 && historical.sends?.length === 13,
  "Historical Campaign 5 fixture row counts changed.");
  const dbName = fixture.query("SELECT current_database()");
  check(/^visual_refresh_fixture_\d+_\d+$/.test(dbName), "Campaign seed must use a fresh schema-only fixture DB.");
  fixtureDbName = dbName;
  const dbUrl = new URL(process.env.DATABASE_URL); dbUrl.pathname = `/${dbName}`;
  const leadsBySource = new Map([...new Set(historical.recipients.map((row) => row.lead_id))]
    .map((id, index) => [id, index + 3]));
  const statements = [];
  const ts = (value) => value == null ? "NULL" : `${q(value.replace("T", " "))}::timestamp`;
  const tz = (value) => value == null ? "NULL" : `${q(value)}::timestamptz`;
  for (const [sourceId, id] of leadsBySource) {
    const ordinal = String(id - 2).padStart(2, "0");
    statements.push(`INSERT INTO leads(id,first_name,last_name,email,phone,company_name,application_type,status,assigned_rep_id,lead_source,created_at,updated_at)
      VALUES (${id},'Historical','Fixture Recipient ${ordinal}',${q(`historical-recipient-${ordinal}@example.invalid`)},
      ${q(`+1202555${String(100 + id - 2).padStart(4, "0")}`)},${q(`Synthetic Campaign Recipient ${ordinal}`)},'equipment','contacted',3,'manual',now(),now());`);
  }
  const c = historical.campaign, launch = historical.launches[0];
  statements.push(`INSERT INTO campaigns(id,name,channel,status,email_template_id,audience_rules,scheduled_at,launched_at,completed_at,owner_id,created_by,version,created_at,updated_at,tracking_since,reply_to_email,flyer_delivery_mode)
    VALUES (5,${q(c.name)},${q(c.channel)},${q(c.status)},1,'{}'::jsonb,${tz(c.scheduled_at)},${tz(c.launched_at)},${tz(c.completed_at)},1,1,${c.version},${tz(c.created_at)},${tz(c.updated_at)},NULL,'fixture-replies@example.invalid',${q(c.flyer_delivery_mode)});`);
  statements.push(`INSERT INTO campaign_launches(id,campaign_id,idempotency_key,requested_by,mode,status,eligible_count,excluded_count,sent_count,failed_count,scheduled_at,started_at,completed_at,created_at)
    VALUES (5,5,'historical-fixture-launch-5',1,${q(launch.mode)},${q(launch.status)},${launch.eligible_count},${launch.excluded_count},${launch.sent_count},${launch.failed_count},${tz(launch.scheduled_at)},${tz(launch.started_at)},${tz(launch.completed_at)},${tz(launch.created_at)});`);
  for (const send of historical.sends) {
    const id = leadsBySource.get(send.lead_id), ordinal = String(id - 2).padStart(2, "0");
    statements.push(`INSERT INTO email_sends(id,lead_id,user_id,template_id,subject,to_email,from_email,status,sendgrid_message_id,sent_at,opened_at,clicked_at,created_at,updated_at,campaign_id,campaign_launch_id,delivery_kind)
      VALUES (${send.id},${id},1,1,${q("Vendors — Heavy Equipment (synthetic historical fixture)")},${q(`historical-recipient-${ordinal}@example.invalid`)},'fixture-sender@example.invalid',
      ${q(send.status)},NULL,${ts(send.sent_at)},${ts(send.opened_at)},${ts(send.clicked_at)},${ts(send.created_at)},${ts(send.updated_at)},5,5,${q(send.delivery_kind)});`);
  }
  for (const recipient of historical.recipients) {
    statements.push(`INSERT INTO campaign_recipients(id,launch_id,campaign_id,lead_id,channel,status,exclusion_reason,available_at,email_send_id,sent_at,created_at)
      VALUES (${recipient.id},5,5,${leadsBySource.get(recipient.lead_id)},${q(recipient.channel)},${q(recipient.status)},${recipient.exclusion_reason == null ? "NULL" : q(recipient.exclusion_reason)},
      ${tz(recipient.available_at)},${recipient.email_send_id},NULL,${tz(recipient.created_at)});`);
  }
  for (const [table, id] of [["leads", 15], ["campaigns", 5], ["campaign_launches", 5], ["campaign_recipients", 26], ["email_sends", 45]]) {
    statements.push(`SELECT setval(pg_get_serial_sequence('${table}','id'),${id},true);`);
  }
  // Use the already approved historical fixture seed; do not rerun the 11-gate or SQL rollback preflight.
  sql(dbUrl, statements.join("\n"));
  const verify = JSON.parse(fixture.query("SELECT row_to_json(q) FROM (SELECT c.id,c.status,c.owner_id,c.created_by,l.requested_by,l.sent_count,(SELECT count(*) FROM campaign_recipients r WHERE r.campaign_id=c.id AND r.status='sent') AS recipient_sent,(SELECT count(*) FROM email_sends e WHERE e.campaign_id=c.id AND e.status IN ('delivered','opened','clicked')) AS email_sent,(SELECT count(*) FROM campaign_recipients r WHERE r.campaign_id=c.id AND r.sent_at IS NULL) AS recipient_sent_at_null,(SELECT count(*) FROM email_sends e WHERE e.campaign_id=c.id AND e.sent_at IS NOT NULL) AS email_sent_at_retained FROM campaigns c JOIN campaign_launches l ON l.campaign_id=c.id WHERE c.id=5) q"));
  check(verify.id === 5 && verify.status === "completed" && Number(verify.sent_count) === 13
    && Number(verify.recipient_sent) === 13 && Number(verify.email_sent) === 13
    && Number(verify.recipient_sent_at_null) === 13 && Number(verify.email_sent_at_retained) === 13,
  `Campaign fixture content differs: ${JSON.stringify(verify)}`);
  fixtureDbName = dbName;
  atomicJson(outputFolder, "fixture-source-proof.json", {
    sourceKind: "schema-only fixture", fixtureDatabase: dbName, campaignId: 5, sends: 13,
    historicalLeadRowsAdded: leadsBySource.size, totalExpectedLeads: 2 + leadsBySource.size,
    productionDataRehearsalCertified: false, campaignVerification: verify,
    note: "Historical campaign seed adds 13 older leads; UI reset assertions use the captured API total/page IDs.",
  });
  return { historical, dbName, verify, leadCount: 2 + leadsBySource.size };
}

function trace(page, phaseRef, section) {
  const traceId = randomUUID(), ids = new WeakMap(), cdpMethods = new Map();
  const pagePath = () => safeUrl(page.url()).path;
  const record = (source, eventType, request, response = null) => ({
    source, eventType, runId, traceId, phaseGroup: "remaining", section, role: "admin",
    phase: phaseRef.value, requestId: ids.get(request), method: request?.method?.() ?? "unknown",
    url: safeUrl(response?.url?.() ?? request?.url?.() ?? page.url()),
    pagePathAtInitiation: pagePath(), status: response?.status?.(), observedAt: new Date().toISOString(),
  });
  page.on("request", (request) => {
    const requestId = `${traceId}-pw-${randomUUID()}`; ids.set(request, requestId);
    const row = { ...record("Playwright", "request", request), requestId };
    append(outputFolder, "network-events.ndjson", row);
  });
  page.on("response", (response) => {
    const row = record("Playwright", "response", response.request(), response);
    append(outputFolder, "network-events.ndjson", row);
    if (BAD.has(row.status)) append(outputFolder, "http-status-events.ndjson", row);
  });
  page.on("requestfailed", (request) => append(outputFolder, "request-failures.ndjson", {
    ...record("Playwright", "requestfailed", request), failure: text(request.failure()?.errorText),
  }));
  page.on("console", (message) => {
    if (message.type() === "error") append(outputFolder, "console-events.ndjson", {
      source: "Playwright", runId, traceId, phaseGroup: "remaining", section, role: "admin",
      phase: phaseRef.value, message: text(message.text()), location: safeUrl(message.location().url || page.url()),
      observedAt: new Date().toISOString(),
    });
  });
  page.on("pageerror", (error) => append(outputFolder, "page-errors.ndjson", {
    source: "Playwright", runId, traceId, phaseGroup: "remaining", section, role: "admin",
    phase: phaseRef.value, message: text(error.message), stack: text(error.stack), observedAt: new Date().toISOString(),
  }));
  return page.context().newCDPSession(page).then(async (cdp) => {
    await cdp.send("Network.enable");
    cdp.on("Network.requestWillBeSent", (event) => {
      cdpMethods.set(event.requestId, event.request.method);
      append(outputFolder, "cdp-network-events.ndjson", {
        source: "CDP", eventType: "request", runId, traceId, phaseGroup: "remaining", section, role: "admin",
        phase: phaseRef.value, stableCdpRequestId: `${traceId}-cdp-${event.requestId}`,
        method: event.request.method, url: safeUrl(event.request.url), pagePathAtInitiation: pagePath(), observedAt: new Date().toISOString(),
      });
    });
    cdp.on("Network.responseReceived", (event) => {
      const row = {
        source: "CDP", eventType: "response", runId, traceId, phaseGroup: "remaining", section, role: "admin",
        phase: phaseRef.value, stableCdpRequestId: `${traceId}-cdp-${event.requestId}`,
        method: cdpMethods.get(event.requestId) ?? "unknown", url: safeUrl(event.response.url),
        pagePathAtInitiation: pagePath(), status: event.response.status, observedAt: new Date().toISOString(),
      };
      append(outputFolder, "cdp-network-events.ndjson", row);
      if (BAD.has(row.status)) append(outputFolder, "cdp-http-status-events.ndjson", row);
    });
    return { detach: () => cdp.detach() };
  });
}

function redactDomText(value) {
  return text(value).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL]")
    .replace(/\+?\d[\d().\s-]{7,}\d/g, "[PHONE]");
}
async function domRows(page) {
  return page.locator('[data-testid="table-leads-fit"] tbody tr').evaluateAll((trs) => trs.map((tr) => {
    const hrefs = [...tr.querySelectorAll("a[href]")].map((a) => a.getAttribute("href") || "");
    const ids = [...new Set(hrefs.map((href) => href.match(/^\/leads\/(\d+)$/)?.[1]).filter(Boolean))];
    return {
      rowId: ids[0] ?? tr.getAttribute("data-lead-id") ?? tr.getAttribute("data-id"),
      linkIds: ids, testId: tr.getAttribute("data-testid"), text: tr.innerText,
    };
  }));
}
function apiLeadSnapshot(body) {
  return {
    total: body?.total, page: body?.page, limit: body?.limit, totalPages: body?.totalPages,
    leads: (body?.leads ?? []).map((lead) => ({
      id: lead.id, firstName: lead.firstName, lastName: lead.lastName,
      companyName: lead.companyName, status: lead.status, applicationType: lead.applicationType,
      assignedRepId: lead.assignedRepId,
    })),
  };
}
async function waitDomMatchesBody(page, body, label) {
  const expectedIds = (body?.leads ?? []).map((lead) => String(lead.id));
  diagnostic = { section: "leads", assertion: label, apiBody: apiLeadSnapshot(body), domRows: await domRows(page), at: new Date().toISOString() };
  try {
    await page.waitForFunction((expected) => {
      const rows = [...document.querySelectorAll('[data-testid="table-leads-fit"] tbody tr')];
      const ids = rows.map((tr) => {
        const href = [...tr.querySelectorAll("a[href]")].map((a) => a.getAttribute("href") || "").find((h) => /^\/leads\/\d+$/.test(h));
        return href?.match(/^\/leads\/(\d+)$/)?.[1] ?? tr.getAttribute("data-lead-id") ?? tr.getAttribute("data-id");
      });
      return rows.length === expected.length && ids.every((id, index) => String(id) === String(expected[index]));
    }, expectedIds, { timeout: 12000 });
  } catch (error) {
    diagnostic.domRows = (await domRows(page)).map((row) => ({ ...row, text: redactDomText(row.text) }));
    diagnostic.error = text(error.message);
    throw new Error(`${label}: DOM row IDs did not match API snapshot ${JSON.stringify(diagnostic)}`);
  }
  const actual = await domRows(page);
  diagnostic.domRows = actual.map((row) => ({ ...row, text: redactDomText(row.text) }));
  check(actual.length === expectedIds.length && actual.every((row, i) => String(row.rowId) === expectedIds[i]),
    `${label}: API/DOM row ID mismatch ${JSON.stringify(diagnostic)}`);
  return diagnostic.domRows;
}
function queryMatches(url, expected = {}) {
  const u = new URL(url);
  if (u.pathname !== "/api/leads") return false;
  for (const [key, want] of Object.entries(expected)) if (u.searchParams.get(key) !== want) return false;
  return true;
}
const baseLeadQuery = (overrides = {}) => ({ search: null, status: null, applicationType: null, repId: null, sortOrder: "desc", ...overrides });
async function getLeadListAfter(page, expectedQuery, action, label, phaseRef) {
  currentPhase = `remaining:leads:${label}`;
  if (phaseRef) phaseRef.value = currentPhase;
  const responsePromise = page.waitForResponse((response) => response.request().method() === "GET"
    && queryMatches(response.url(), baseLeadQuery(expectedQuery)), { timeout: 15000 });
  await action();
  const response = await responsePromise;
  const body = await response.json();
  if (response.status() !== 200) {
    diagnostic = { section: "leads", assertion: label, responseStatus: response.status(), requestUrl: safeUrl(response.url()), responseBody: body };
    throw new Error(`${label}: /api/leads expected 200: ${JSON.stringify(diagnostic)}`);
  }
  const rows = await waitDomMatchesBody(page, body, label);
  const snapshot = {
    requestStatus: response.status(), requestUrl: safeUrl(response.url()),
    body: apiLeadSnapshot(body), domRowIds: rows.map((row) => row.rowId),
    domRows: rows, at: new Date().toISOString(),
  };
  diagnostic = { ...diagnostic, ...snapshot };
  return { response, body, rows, snapshot };
}
function assertSingleLead(result, id, label, predicates = {}) {
  const row = result.body?.leads?.find((lead) => Number(lead.id) === Number(id));
  check(result.body?.total === 1 && result.body?.leads?.length === 1 && Number(row?.id) === Number(id),
    `${label}: expected exactly lead ${id}; observed ${JSON.stringify(result.snapshot)}`);
  for (const [key, value] of Object.entries(predicates)) check(row[key] === value,
    `${label}: expected ${key}=${value}; observed ${JSON.stringify(result.snapshot)}`);
}
function leadDetailBodySnapshot(body) {
  return body ? {
    id: body.id, firstName: body.firstName, lastName: body.lastName,
    companyName: body.companyName, status: body.status, applicationType: body.applicationType,
    assignedRepId: body.assignedRepId, entityLabel: body.entityLabel,
  } : null;
}
async function openLeadDetail(page, id, clickAction, label) {
  const responsePromise = page.waitForResponse((response) => {
    try { return response.request().method() === "GET" && new URL(response.url()).pathname === `/api/leads/${id}`; }
    catch { return false; }
  }, { timeout: 15000 });
  await clickAction();
  await page.waitForURL(new RegExp(`/leads/${id}(?:$|\\?)`));
  const response = await responsePromise;
  const body = await response.json();
  const snapshot = { status: response.status(), url: safeUrl(response.url()), body: leadDetailBodySnapshot(body) };
  diagnostic = { section: "leads", assertion: label, apiBody: snapshot, domUrl: safeUrl(page.url()), at: new Date().toISOString() };
  check(response.status() === 200 && Number(body?.id) === Number(id),
    `${label}: expected lead detail GET 200 for id ${id}: ${JSON.stringify(diagnostic)}`);
  await waitForPage(page, "lead-detail");
  return snapshot;
}

async function leadsJourney(fx) {
  checkpoint("leads", "running", { interactionsExpected: 13, screenshotsExpected: 8 });
  currentPhase = "remaining:leads:open";
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", reducedMotion: "reduce", serviceWorkers: "block" });
  try {
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const phaseRef = { value: currentPhase };
    const tracing = await trace(page, phaseRef, "leads-journey");
    await fx.login(page, "admin");
    const initialPromise = page.waitForResponse((r) => r.request().method() === "GET" && queryMatches(r.url(), baseLeadQuery()), { timeout: 15000 });
    await page.goto(`${fx.url}/leads`); await waitForPage(page, "leads");
    const initialResponse = await initialPromise, initialBody = await initialResponse.json();
    check(initialResponse.status() === 200 && Array.isArray(initialBody.leads) && Number.isInteger(initialBody.total),
      `Initial lead list API response malformed: ${JSON.stringify(apiLeadSnapshot(initialBody))}`);
    const initialRows = await waitDomMatchesBody(page, initialBody, "initial-list");
    const initial = {
      status: initialResponse.status(), total: initialBody.total, page: initialBody.page, limit: initialBody.limit,
      apiIds: initialBody.leads.map((lead) => lead.id), domIds: initialRows.map((row) => Number(row.rowId)),
      apiBody: apiLeadSnapshot(initialBody),
    };
    diagnostic = { section: "leads", assertion: "initial-list", ...initial, domRows: initialRows };
    checkpoint("leads", "initial-list-captured", { initialTotal: initial.total, initialVisible: initial.apiIds.length, initialIds: initial.apiIds });

    const search = page.getByPlaceholder("Search by name, email, company…", { exact: true });
    let result = await getLeadListAfter(page, { search: "Synthetic Contact" }, () => search.fill("Synthetic Contact"), "lead-search-name", phaseRef);
    assertSingleLead(result, 1, "name search");
    step("leads", "lead-search-name", { api: result.snapshot });

    result = await getLeadListAfter(page, { search: "Fixture Services LLC" }, () => search.fill("Fixture Services LLC"), "lead-search-company", phaseRef);
    assertSingleLead(result, 2, "company search");
    step("leads", "lead-search-company", { api: result.snapshot });

    result = await getLeadListAfter(page, {}, () => search.fill(""), "lead-search-reset-initial-list", phaseRef);
    check(result.body.total === initial.total && result.body.page === initial.page && result.body.limit === initial.limit
      && JSON.stringify(result.body.leads.map((lead) => lead.id)) === JSON.stringify(initial.apiIds),
    `Clearing search must restore captured initial API total/page IDs, not a hardcoded count: ${JSON.stringify(result.snapshot)}; initial=${JSON.stringify(initial)}`);
    checkpoint("leads", "search-reset-matches-initial", { expectedTotal: initial.total, actualTotal: result.body.total, apiIds: result.body.leads.map((lead) => lead.id), domIds: result.rows.map((row) => row.rowId) });

    // Keep the target row searchable and visible while validating the single-result filters.
    result = await getLeadListAfter(page, { search: "Synthetic Contact" }, () => search.fill("Synthetic Contact"), "lead-target-before-filters", phaseRef);
    assertSingleLead(result, 1, "filter target search");
    const combos = page.getByRole("combobox");
    const statusPromiseAction = () => combos.nth(0).click().then(() => page.getByRole("option", { name: "Contacted", exact: true }).click());
    result = await getLeadListAfter(page, { search: "Synthetic Contact", status: "contacted" }, statusPromiseAction, "lead-status-filter", phaseRef);
    assertSingleLead(result, 1, "Contacted filter", { status: "contacted" });
    step("leads", "lead-status-filter", { api: result.snapshot });
    result = await getLeadListAfter(page, { search: "Synthetic Contact" }, () => combos.nth(0).click()
      .then(() => page.getByRole("option", { name: "All Statuses", exact: true }).click()), "lead-status-filter-reset", phaseRef);
    assertSingleLead(result, 1, "status reset");
    step("leads", "lead-status-filter-reset", { api: result.snapshot });

    result = await getLeadListAfter(page, { search: "Synthetic Contact", applicationType: "equipment" }, () => combos.nth(1).click()
      .then(() => page.getByRole("option", { name: "Equipment", exact: true }).click()), "lead-type-filter", phaseRef);
    assertSingleLead(result, 1, "Equipment filter", { applicationType: "equipment" });
    step("leads", "lead-type-filter", { api: result.snapshot });
    result = await getLeadListAfter(page, { search: "Synthetic Contact" }, () => combos.nth(1).click()
      .then(() => page.getByRole("option", { name: "All Types", exact: true }).click()), "lead-type-filter-reset", phaseRef);
    assertSingleLead(result, 1, "type reset");

    currentPhase = "remaining:leads:representative-filter"; phaseRef.value = currentPhase;
    const repFilter = page.getByRole("button", { name: "Filter by representative", exact: true });
    await repFilter.click();
    const repOption = page.getByRole("option").filter({ hasText: "Visual Fixture" }).first();
    await repOption.waitFor();
    const repOptionText = await repOption.innerText();
    result = await getLeadListAfter(page, { search: "Synthetic Contact", repId: "3" }, () => repOption.click(), "lead-representative-filter", phaseRef);
    assertSingleLead(result, 1, "representative filter", { assignedRepId: 3 });
    step("leads", "lead-representative-filter", { selectedOption: text(repOptionText), expectedRepId: 3, api: result.snapshot });

    currentPhase = "remaining:leads:lead-oldest-sort"; phaseRef.value = currentPhase;
    const oldestPromise = page.waitForResponse((r) => r.request().method() === "GET"
      && queryMatches(r.url(), baseLeadQuery({ search: "Synthetic Contact", repId: "3", sortOrder: "asc" })), { timeout: 15000 });
    await combos.last().click(); await page.getByRole("option", { name: "Oldest First", exact: true }).click();
    const oldestResponse = await oldestPromise, oldestBody = await oldestResponse.json();
    check(oldestResponse.status() === 200, `Oldest First API response ${oldestResponse.status()}.`);
    const oldestRows = await waitDomMatchesBody(page, oldestBody, "lead-oldest-sort");
    result = { response: oldestResponse, body: oldestBody, rows: oldestRows, snapshot: { status: oldestResponse.status(), requestUrl: safeUrl(oldestResponse.url()), body: apiLeadSnapshot(oldestBody), domRowIds: oldestRows.map((row) => row.rowId), domRows: oldestRows } };
    assertSingleLead(result, 1, "oldest sort");
    step("leads", "lead-oldest-sort", { api: result.snapshot });

    // The target remains pinned by its live search. No paginated historical row is used for contact actions.
    const row = page.locator('[data-testid="table-leads-fit"] tbody tr').filter({ hasText: "Synthetic Contact" });
    check(await row.count() === 1, `Target row not visible for row actions: ${JSON.stringify(diagnostic)}`);
    const blank = await row.evaluate((tr) => {
      for (const td of tr.cells) for (const [x, y] of [
        [td.getBoundingClientRect().left + 3, td.getBoundingClientRect().top + 3],
        [td.getBoundingClientRect().right - 3, td.getBoundingClientRect().bottom - 3],
      ]) if (document.elementFromPoint(x, y) === td) return { x, y };
      return null;
    });
    check(blank, `Could not identify blank row background: ${JSON.stringify(diagnostic)}`);
    const beforeBlank = page.url(); await page.mouse.click(blank.x, blank.y);
    check(page.url() === beforeBlank, "Blank row background navigated.");
    step("leads", "lead-blank-row-noop", { api: diagnostic, domRowIds: (await domRows(page)).map((r) => r.rowId) });

    const phone = row.locator('a[href^="tel:"]');
    check(await phone.count() > 0, `Target phone link missing: ${JSON.stringify(diagnostic)}`);
    const phoneHref = await phone.first().getAttribute("href");
    await page.evaluate(() => { window.__telClicks = []; document.addEventListener("click", (event) => {
      const link = event.target.closest?.('a[href^="tel:"]');
      if (link) { event.preventDefault(); window.__telClicks.push(link.href); }
    }, true); });
    const beforePhone = page.url(); await phone.first().click();
    check(page.url() === beforePhone && (await page.evaluate(() => window.__telClicks)).length === 1, "Lead table phone action failed interception.");
    step("leads", "lead-phone-action", { href: "[REDACTED_PHONE_ACTION]", domRowIds: (await domRows(page)).map((r) => r.rowId) });

    const email = row.locator('[data-contact-link="email"]');
    check(await email.count() > 0, `Target email action missing: ${JSON.stringify(diagnostic)}`);
    const emailDetail = await openLeadDetail(page, 1, () => email.click(), "lead-email-opens-comms");
    await page.getByRole("tab", { name: /^Comms/ }).waitFor();
    step("leads", "lead-email-opens-comms", { targetLeadId: 1, url: safeUrl(page.url()), api: emailDetail });
    const detailPhone = page.locator('a[href^="tel:"]');
    check(await detailPhone.count() > 0, "Lead detail phone action missing.");
    const beforeDetailPhone = page.url(); await detailPhone.first().click();
    check(page.url() === beforeDetailPhone, "Lead detail phone action navigated.");
    step("leads", "lead-detail-phone-action", { targetLeadId: 1 });

    async function reopenTarget() {
      await page.goto(`${fx.url}/leads`); await waitForPage(page, "leads");
      const find = page.getByPlaceholder("Search by name, email, company…", { exact: true });
      const found = await getLeadListAfter(page, { search: "Synthetic Contact" }, () => find.fill("Synthetic Contact"), "reopen-target", phaseRef);
      assertSingleLead(found, 1, "reopened target");
      return page.locator('[data-testid="table-leads-fit"] tbody tr').filter({ hasText: "Synthetic Contact" });
    }
    let targetRow = await reopenTarget();
    const nameLink = targetRow.getByRole("link").filter({ hasText: "Synthetic Contact" }).first();
    const nameDetail = await openLeadDetail(page, 1, () => nameLink.click(), "lead-name-link-opens-detail");
    step("leads", "lead-name-link-opens-detail", { targetLeadId: 1, url: safeUrl(page.url()), api: nameDetail });

    targetRow = await reopenTarget();
    const companyLink = targetRow.getByRole("link").filter({ hasText: "Fixture Equipment LLC" }).first();
    check(await companyLink.count() === 1, `Company link missing on target lead row: ${JSON.stringify(diagnostic)}`);
    const companyHref = await companyLink.getAttribute("href");
    check(companyHref === "/leads/1", `Lead company link target changed: ${companyHref}`);
    const companyDetail = await openLeadDetail(page, 1, () => companyLink.click(), "lead-company-link-opens-detail");
    step("leads", "lead-company-link-opens-detail", { targetLeadId: 1, href: companyHref, api: companyDetail });

    const interactions = readNdjson(join(outputFolder, "journey-events.ndjson")).filter((row) => row.section === "leads").length;
    check(interactions === 13, `Expected 13 Leads interactions, found ${interactions}.`);
    checkpoint("leads", "13-interactions-passed", { interactions, initialTotal: initial.total });

    phaseRef.value = "remaining:leads:screenshots"; currentPhase = phaseRef.value;
    checkpoint("leads-screenshots", "running", { expected: 8 });
    for (const theme of ["light", "dark"]) {
      if (theme === "dark") {
        await page.goto(`${fx.url}/settings`); await waitForPage(page, "settings");
        await page.getByLabel("Appearance theme").selectOption("dark");
      }
      for (const width of [390, 768, 1280, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        const listPromise = page.waitForResponse((r) => r.request().method() === "GET" && queryMatches(r.url(), baseLeadQuery()), { timeout: 15000 });
        await page.goto(`${fx.url}/leads`); await waitForPage(page, "leads");
        if (theme === "dark") check(await page.locator("html").getAttribute("data-appearance") === "dark", "Dark theme did not persist.");
        const response = await listPromise;
        const body = response ? await response.json().catch(() => null) : null;
        const dom = await domRows(page);
        const geometry = await page.evaluate(() => ({
          viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth,
          tableWidth: document.querySelector('[data-testid="table-leads-fit"] table')?.getBoundingClientRect().width ?? null,
        }));
        const name = `leads-${width}-${theme}.png`;
        await page.screenshot({ path: join(outputFolder, "screenshots", name) });
        step("leads-screenshots", `leads-screenshot-${width}-${theme}`, {
          filename: name, geometry, apiStatus: response?.status() ?? null,
          apiBody: body ? apiLeadSnapshot(body) : null, domRowIds: dom.map((row) => row.rowId),
        });
      }
    }
    const files = readdirSync(join(outputFolder, "screenshots")).filter((name) => name.endsWith(".png"));
    check(files.length === 8, `Expected exactly eight Leads screenshots, got ${files.length}.`);
    checkpoint("leads-screenshots", "8-captures-passed", { screenshots: files });
    await tracing.detach().catch(() => {});
  } finally { await context.close(); }
}

async function campaignJourney(fx) {
  checkpoint("campaign-13", "running", { expected: "admin UI results and metrics" });
  currentPhase = "remaining:campaign-13";
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", reducedMotion: "reduce", serviceWorkers: "block" });
  try {
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const phaseRef = { value: currentPhase }, tracing = await trace(page, phaseRef, "campaign-13");
    await fx.login(page, "admin");
    const resultsWait = page.waitForResponse((r) => r.url().includes("/api/campaigns/5/results"));
    const metricsWait = page.waitForResponse((r) => r.url().includes("/api/campaigns/5/metrics"));
    await page.goto(`${fx.url}/campaigns/5`);
    await page.getByText("Vendors — Heavy Equipment", { exact: true }).first().waitFor();
    await page.getByRole("tab", { name: "Results", exact: true }).click();
    const [resultsResponse, metricsResponse] = await Promise.all([resultsWait, metricsWait]);
    const results = await resultsResponse.json(), metrics = await metricsResponse.json();
    const campaignApiSnapshot = {
      resultsStatus: resultsResponse.status(), metricsStatus: metricsResponse.status(),
      results: { counts: results?.counts, launches: (results?.launches ?? []).map((l) => ({ id: l.id, status: l.status, sentCount: l.sentCount })) },
      metrics: { sent: metrics?.sent, trackingSince: metrics?.trackingSince, uniqueClicks: metrics?.uniqueClicks, replies: metrics?.replies },
    };
    diagnostic = { section: "campaign-13", assertion: "API bodies", apiBody: campaignApiSnapshot, domText: redactDomText(await page.locator("body").innerText()) };
    check(resultsResponse.status() === 200 && metricsResponse.status() === 200,
      `Campaign 13 API expected 200/200: ${JSON.stringify(campaignApiSnapshot)}`);
    check(results.counts?.sent === 13 && results.launches?.length === 1,
      `Campaign results counts/launch count mismatch: ${JSON.stringify(campaignApiSnapshot)}`);
    check(metrics.sent === 13 && metrics.trackingSince == null,
      `Campaign metrics count/disclosure mismatch: ${JSON.stringify(campaignApiSnapshot)}`);
    const legacy = page.getByText("Sent", { exact: true }).first().locator("..");
    const kpi = page.getByTestId("kpi-sent");
    await page.getByText("Campaign Results", { exact: true }).waitFor(); await kpi.waitFor();
    const legacyText = redactDomText(await legacy.innerText()), kpiText = redactDomText(await kpi.innerText());
    const panels = redactDomText(await page.getByTestId("panel-campaign-kpis").innerText());
    check(legacyText.includes("13") && kpiText.includes("13"), `Campaign legacy/new Sent KPI mismatch: ${JSON.stringify({ legacyText, kpiText, campaignApiSnapshot })}`);
    check(panels.includes("Historical tracking not available"), `Historical tracking disclosure missing: ${panels}`);
    const clicks = redactDomText(await page.getByTestId("kpi-uniqueClicks").innerText());
    const replies = redactDomText(await page.getByTestId("kpi-replies").innerText());
    check(clicks.includes("Not tracked") && replies.includes("Not tracked"), "Unknown campaign metrics must say Not tracked.");
    step("campaign-13", "admin-results-metrics-13", {
      api: campaignApiSnapshot, dom: { legacySent: legacyText, sentKpi: kpiText, panel: panels, uniqueClicks: clicks, replies },
    });
    checkpoint("campaign-13", "passed", { sent: 13, resultsStatus: 200, metricsStatus: 200 });
    await tracing.detach().catch(() => {});
  } finally { await context.close(); }
}

function aggregateCurrentRun(priorRoleProof, fixtureProof) {
  const network = readNdjson(join(outputFolder, "network-events.ndjson"));
  const cdp = readNdjson(join(outputFolder, "cdp-network-events.ndjson"));
  const pwrResponses = network.filter((row) => row.source === "Playwright" && row.eventType === "response");
  const badPwr = pwrResponses.filter((row) => BAD.has(row.status));
  const badCdp = cdp.filter((row) => row.eventType === "response" && BAD.has(row.status));
  const consoleRows = readNdjson(join(outputFolder, "console-events.ndjson"));
  const pageErrors = readNdjson(join(outputFolder, "page-errors.ndjson"));
  const requestFailures = readNdjson(join(outputFolder, "request-failures.ndjson"));
  const journey = readNdjson(join(outputFolder, "journey-events.ndjson"));
  const leadSteps = journey.filter((row) => row.section === "leads");
  const shotSteps = journey.filter((row) => row.section === "leads-screenshots");
  const campaign = journey.find((row) => row.step === "admin-results-metrics-13") ?? null;
  const screenshots = readdirSync(join(outputFolder, "screenshots")).filter((name) => name.endsWith(".png"));
  const rawByStatus = Object.fromEntries([...new Set(pwrResponses.map((row) => row.status))].sort((a, b) => a - b)
    .map((status) => [status, pwrResponses.filter((row) => row.status === status).length]));
  const completed = leadSteps.length === 13 && shotSteps.length === 8 && screenshots.length === 8 && Boolean(campaign)
    && badPwr.length === 0 && badCdp.length === 0 && consoleRows.length === 0 && pageErrors.length === 0 && requestFailures.length === 0;
  return {
    status: completed ? "REMAINING_SCOPE_COMPLETE" : "REMAINING_SCOPE_INCOMPLETE",
    originalCertificationStatus: "INTERRUPTED_NO_TERMINAL_EXIT_RECORD",
    overallCertificationPass: false,
    historicalAndSchemaOnlyLimitations: {
      fixtureSourceKind: "schema-only fixture", productionDataRehearsalCertified: false,
      historicalCampaignSqlRollbackPreflightReused: true, publishOccurred: false,
    },
    sourceAndApiPins: {
      targetRevision: JSON.parse(readFileSync(authorizationPath, "utf8")).targetRevision,
      candidateApiSourceTreeSha256: JSON.parse(readFileSync(authorizationPath, "utf8")).candidateApiSourceTreeSha256,
      candidateApiDistSha256: JSON.parse(readFileSync(authorizationPath, "utf8")).candidateApiDistSha256,
      remainingRunnerSha256: shaFile(import.meta.filename),
    },
    retainedStructure: priorRoleProof.retainedStructure,
    roleAndSecurityChecksFromTask3: priorRoleProof,
    roleEvidenceClassification: {
      authorizedUiRawBadStatuses: 0,
      expected403Probes: priorRoleProof.expectedSecurityProbe403s,
      expected403ProbeConsoleErrors: priorRoleProof.expectedSecurityProbeConsoleErrors,
      tableWarning: "Report intentional denied security probes separately; do not label combined raw status/console totals clean.",
    },
    leads: {
      interactions: leadSteps.length, screenshots: screenshots.length,
      screenshotsExpected: 8, interactionSteps: leadSteps.map((row) => row.step),
      actualPwrResponseStatusCounts: rawByStatus,
    },
    campaign13: campaign,
    currentRun: {
      pwrResponseCount: pwrResponses.length, pwrResponseStatusCounts: rawByStatus,
      unexpectedPwrBadStatuses: badPwr, unexpectedCdpBadStatuses: badCdp,
      consoleErrors: consoleRows.length, pageErrors: pageErrors.length, requestFailures: requestFailures.length,
      fixture: fixtureProof, completed,
    },
    task3Provenance: {
      taskId: priorRoleProof.taskId, exitCode: 1, failureRetained: true,
      cause: "Leads runner expected exactly two rows after clearing search, but campaign fixture seed adds 13 historical leads; this is a harness assumption, not a product edit.",
      originalManager403sPreserved: true, newManagerReplacementPassed: priorRoleProof.managerReplacementPassed,
    },
    completedAt: new Date().toISOString(),
  };
}

function writeReport(summary) {
  atomicJson(outputFolder, "remaining-summary.json", summary);
  const imgs = ["light", "dark"].flatMap((theme) => [390, 768, 1280, 1440].map((width) => `screenshots/leads-${width}-${theme}.png`));
  const steps = readNdjson(join(outputFolder, "journey-events.ndjson"));
  const report = `<!doctype html><meta charset="utf-8"><title>Role-directory certification — remaining scope</title>
  <h1>Remaining-scope evidence</h1><p>Status: <strong>${summary.status}</strong>. This report does not convert the interrupted original certification into a full pass.</p>
  <h2>Retained evidence</h2><pre>${JSON.stringify({structure: summary.retainedStructure, roles: summary.roleAndSecurityChecksFromTask3, roleEvidenceClassification: summary.roleEvidenceClassification}, null, 2)}</pre>
  <h2>New scope</h2><pre>${JSON.stringify({leads: summary.leads, campaign13: summary.campaign13, currentRun: summary.currentRun, task3Provenance: summary.task3Provenance}, null, 2)}</pre>
  <h2>Journey checkpoints (${steps.length})</h2><ol>${steps.map((s) => `<li>${text(s.section)} — ${text(s.step)} — ${text(s.status)}</li>`).join("")}</ol>
  <h2>Eight Leads captures</h2><main>${imgs.map((file) => `<figure><img src="${file}" alt="${file}"><figcaption>${file}</figcaption></figure>`).join("")}</main>
  <style>body{font:15px system-ui;margin:2rem}pre{white-space:pre-wrap;background:#f4f4f4;padding:1rem}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem}img{max-width:100%;border:1px solid #aaa}figure{margin:0}</style>`;
  writeFileSync(join(outputFolder, "remaining-report.html"), report);
  writeFileSync(join(outputFolder, "gallery.html"), `<!doctype html><meta charset="utf-8"><title>Leads screenshot gallery</title><h1>Leads — light/dark responsive evidence</h1><main>${imgs.map((file) => `<figure><img src="${file}" alt="${file}"><figcaption>${file}</figcaption></figure>`).join("")}</main><style>body{font:16px system-ui;margin:2rem}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem}img{max-width:100%;height:auto;border:1px solid #aaa}figure{margin:0}</style>`);
}

async function execute() {
  const args = process.argv.slice(2);
  check(args.includes("--continue"), "Use --continue --managed-task-id=<Main-managed-task-id>.");
  const taskId = args.find((arg) => arg.startsWith("--managed-task-id="))?.slice("--managed-task-id=".length);
  check(/^[A-Za-z0-9][A-Za-z0-9._-]{3,79}$/.test(taskId ?? ""), "Main-managed task ID is required.");
  const { lock, roles } = validateInputs(true);
  check(taskId === lock.managedTaskId, "CLI task id does not match the lock's managedTaskId.");
  runId = taskId;
  outputFolder = join(outputRoot, runId);
  check(!require("node:fs").existsSync(outputFolder), `Output run already exists: ${outputFolder}`);
  mkdirSync(join(outputFolder, "screenshots"), { recursive: true });
  progress = { runId, status: "starting", targetRevision: lock.targetRevision, remainingRunnerSha256: shaFile(import.meta.filename),
    remainingSections: ["Leads 13 interactions", "Leads 8 screenshots", "admin Campaign 13"], completedSteps: 0, startedAt: new Date().toISOString() };
  atomicJson(outputFolder, "retained-role-evidence.json", roles);
  updateProgress();
  checkpoint("campaign-fixture", "starting", { dataSource: "schema-only" });
  fixture = await startSandbox({ build: false, webRoot: resolve(root, lock.candidateWebRoot), port: lock.port });
  let finalSummary = null, fixtureProof = null;
  try {
    fixtureProof = await seedCampaignOnly(fixture);
    checkpoint("campaign-fixture", "passed", { database: fixtureProof.dbName, historicalLeadRowsAdded: fixtureProof.leadCount - 2, campaignId: 5, sends: 13 });
    browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", headless: true });
    updateProgress({ status: "running", phase: "leads-13-interactions" });
    await leadsJourney(fixture);
    updateProgress({ phase: "campaign-13" });
    await campaignJourney(fixture);
    finalSummary = aggregateCurrentRun(roles, { sourceKind: "schema-only fixture", campaignId: 5, sends: 13,
      historicalLeadRowsAdded: fixtureProof.leadCount - 2, fixtureDatabase: fixtureProof.dbName, productionDataRehearsalCertified: false });
    writeReport(finalSummary);
    updateProgress({ status: finalSummary.status === "REMAINING_SCOPE_COMPLETE" ? "completed" : "failed",
      phase: "finished", remainingScopeComplete: finalSummary.currentRun.completed, completedAt: finalSummary.completedAt });
    if (!finalSummary.currentRun.completed) process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    let fixtureCloseError = null;
    if (fixture) await fixture.close().catch((error) => { fixtureCloseError = text(error.message); });
    const absent = [];
    for (const id of created) {
      try { await clerkClient.users.getUser(id); absent.push({ id, absent: false }); }
      catch (error) { absent.push({ id, absent: error?.status === 404 || /not found|already deleted/i.test(String(error?.message)) }); }
    }
    let dbAbsent = false;
    if (fixtureDbName) {
      const catalog = spawnSync("psql", [`--dbname=${process.env.DATABASE_URL}`, "--no-psqlrc", "--tuples-only", "--no-align",
        "--set=connect_timeout=3", "--command", `SELECT datname FROM pg_database WHERE datname=${q(fixtureDbName)}`],
      { encoding: "utf8", timeout: 5000 });
      dbAbsent = catalog.status === 0 && catalog.stdout.trim() === "";
    }
    if (outputFolder) {
      atomicJson(outputFolder, "cleanup-verification.json", {
        sourceKind: "schema-only fixture", fixtureDatabase: fixtureDbName ?? null, fixtureDatabaseAbsent: dbAbsent,
        createdSyntheticUsers: created.size, deletedAndAbsentUsers: absent.filter((row) => row.absent).length,
        individualUserAbsenceChecks: absent, fixtureCloseError, verifiedAt: new Date().toISOString(),
      });
      if (finalSummary) {
        finalSummary.fixtureCleanup = { fixtureDatabaseAbsent: dbAbsent, syntheticUsersAbsent: absent.filter((row) => row.absent).length };
        writeReport(finalSummary);
      }
    }
    if (!dbAbsent || absent.some((row) => !row.absent) || fixtureCloseError) process.exitCode = 1;
  }
}

function sourceReadyOnly() {
  const { lock, roles } = validateInputs(false);
  console.log(JSON.stringify({ ready: true, browserLaunched: false, pinMode: "source/API/read-only provenance",
    targetRevision: lock.targetRevision, candidateApiSourceTreeSha256: lock.candidateApiSourceTreeSha256,
    candidateApiDistSha256: lock.candidateApiDistSha256, remainingRunnerSha256: shaFile(import.meta.filename),
    remainingRunnerPinRequired: true, managedTaskIdRequired: true,
    retainedRoleChecksPassed: roles.freshRoleChecksPassed, retainedStructureCases: roles.retainedStructure.cases }, null, 2));
}
function readyOnly() {
  const { lock, roles } = validateInputs(true);
  console.log(JSON.stringify({ ready: true, browserLaunched: false, targetRevision: lock.targetRevision,
    remainingRunnerSha256: lock.remainingRunnerSha256, managedTaskId: lock.managedTaskId,
    retainedRoleChecksPassed: roles.freshRoleChecksPassed, retainedStructureCases: roles.retainedStructure.cases }, null, 2));
}

if (process.argv.includes("--check-source-ready-only")) {
  try { sourceReadyOnly(); } catch (error) { console.error(error); process.exitCode = 1; }
} else if (process.argv.includes("--check-ready-only")) {
  try { readyOnly(); } catch (error) { console.error(error); process.exitCode = 1; }
} else {
  execute().catch((error) => {
    if (outputFolder) {
      atomicJson(outputFolder, "failure.json", { status: "FAILED", phase: currentPhase, message: text(error.stack ?? error), diagnostic, at: new Date().toISOString() });
      updateProgress({ status: "failed", phase: currentPhase, failure: text(error.message), diagnostic });
    }
    console.error(error);
    process.exitCode = 1;
  });
}
