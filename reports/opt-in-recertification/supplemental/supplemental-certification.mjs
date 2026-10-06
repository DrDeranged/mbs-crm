import { chromium } from "@playwright/test";
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { startSandbox } from "../../../scripts/visual-refresh/sandbox.mjs";
import { waitForPage } from "../../../scripts/visual-refresh/readiness.mjs";

const root = resolve(import.meta.dirname, "../../..");
const require = createRequire(join(root, "artifacts/api-server/package.json"));
const { clerkClient } = require("@clerk/express");
const sourceDir = join(root, "reports/opt-in-recertification/final-cert-run");
const campaignOnly = process.argv.includes("--campaign-only");
const output = join(root, campaignOnly ? "reports/opt-in-recertification/supplemental/campaign-only-run"
  : "reports/opt-in-recertification/supplemental/run");
const screenshotsDir = join(output, "screenshots");
const webRoot = resolve(process.env.CERT_WEB_ROOT ?? "");
const target = process.env.CERT_TARGET_REVISION ?? "";
const snapshot = process.env.CERT_LOCAL_SNAPSHOT ?? "";
const expectedIndex = process.env.CERT_BUILD_INDEX_SHA256 ?? "";
const expectedApi = process.env.CERT_API_DIST_SHA256 ?? "";
const pages = [["dashboard", "/dashboard"], ["leads", "/leads"], ["lead-detail", "/leads/1"], ["pipeline", "/deals"], ["apply", "/apply"], ["settings", "/settings"]];
const roles = ["admin", "manager", "rep"];
const width = 390, height = 900, routePort = Number(process.env.CERT_CAMPAIGN_PORT ?? (campaignOnly ? 4340 : process.env.CERT_SUPPLEMENT_PORT ?? 4330));
const originalEvidenceNames = ["leads-certification.json", "structure-controls.json", "structure-differences.json", "approved-exceptions.json", "capture-progress.json"];
let browser, outputInitialized = false;
const createdClerkUsers = [];
const originalCreateUser = clerkClient.users.createUser.bind(clerkClient.users);
clerkClient.users.createUser = async (...args) => {
  const user = await originalCreateUser(...args);
  createdClerkUsers.push(user.id);
  return user;
};

let fixture, fixtureDbName, activeContext, sourceProof, fatal = null, persistenceFailure = null;
const state = { status: "starting", phase: campaignOnly ? "campaign-only-preflight" : "preflight", target, snapshot,
  expectedRouteVisits: campaignOnly ? 0 : 18, completedRouteVisits: [], journeys: [], screenshots: [], startedAt: new Date().toISOString() };
const routeVisits = [], journeys = [], httpTrace = [], consoleTrace = [], pageErrors = [], requestFailures = [], repUserListRequests = [], pendingTraceReads = new Set();
let persistQueue = Promise.resolve();

function check(ok, message) { if (!ok) throw new Error(message); }
function safeText(text) {
  return String(text ?? "").replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/\+?\d[\d ()-]{7,}\d/g, "[REDACTED_PHONE]").slice(0, 1000);
}
function safeUrl(raw) {
  try {
    const u = new URL(raw);
    const path = u.pathname.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
      .replace(/(\/(?:users|leads|deals|contacts|recipients)\/)[^/]+/gi, "$1[REDACTED_ID]")
      .replace(/\/(?:eyJ[A-Za-z0-9_-]{30,}|[A-Za-z0-9_-]{48,})(?=\/|$)/g, "/[REDACTED_TOKEN]");
    const keys = [...new Set([...u.searchParams.keys()])].sort();
    return { origin: u.origin, path, ...(keys.length ? { query: Object.fromEntries(keys.map(key => [key, "[REDACTED]"])) } : {}) };
  } catch { return { origin: "[non-url]", path: "[REDACTED]" }; }
}
function stableWrite(name, value) {
  persistQueue = persistQueue.then(async () => {
    const final = join(output, name), temp = `${final}.tmp-${process.pid}`;
    await writeFile(temp, JSON.stringify(value, null, 2));
    await rename(temp, final);
  }).catch(error => { persistenceFailure ??= error; });
  return persistQueue;
}
function durableEvent(name, value) {
  persistQueue = persistQueue.then(async () => {
    const file = join(output, name), handle = await open(file, "a");
    try { await handle.write(`${JSON.stringify(value)}\n`); await handle.sync(); }
    finally { await handle.close(); }
  }).catch(error => { persistenceFailure ??= error; });
  return persistQueue;
}
async function flush() { await persistQueue; if (persistenceFailure) throw persistenceFailure; }
async function phase(name, extra = {}) {
  state.phase = name; state.updatedAt = new Date().toISOString(); Object.assign(state, extra);
  await stableWrite("run-progress.json", state);
  await durableEvent("events.ndjson", { type: "phase", phase: name, at: state.updatedAt, ...extra });
}
async function routeProgress(item) {
  routeVisits.push(item);
  state.completedRouteVisits = [...routeVisits];
  state.phase = "candidate-http-capture";
  await durableEvent("events.ndjson", { type: "route-visit", ...item });
  await stableWrite("route-progress.json", { completed: routeVisits.length, required: 18, visits: routeVisits });
  await stableWrite("run-progress.json", state);
}
async function recordJourney(entry) {
  const row = { at: new Date().toISOString(), ...entry };
  journeys.push(row); state.journeys = [...journeys];
  await durableEvent("journey-events.ndjson", row);
  await stableWrite("journeys.json", journeys);
  await stableWrite("run-progress.json", state);
}
async function hashBytes(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
async function hashTree(directory) {
  const { readdir } = await import("node:fs/promises");
  const hash = createHash("sha256");
  async function walk(folder, relative = "") {
    for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      const rel = join(relative, entry.name);
      if (entry.isDirectory()) await walk(join(folder, entry.name), rel);
      else if (entry.isFile()) { hash.update(rel); hash.update("\0"); hash.update(await readFile(join(folder, entry.name))); hash.update("\0"); }
    }
  }
  await walk(directory); return hash.digest("hex");
}
function shaJson(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
async function verifyExpectedFixtureSources() {
  const files = {
    sandbox: "scripts/visual-refresh/sandbox.mjs",
    twilioToken: "artifacts/api-server/src/routes/twilio.ts",
    integrationHealth: "artifacts/api-server/src/lib/integrationHealth.ts",
    telephonySettingsRoute: "artifacts/api-server/src/routes/settings.ts",
    ownedNumbers: "artifacts/api-server/src/lib/telephonySettings.ts",
    application: "artifacts/api-server/src/routes/applications.ts",
  };
  const text = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, rel]) => [key, await readFile(join(root, rel), "utf8")])));
  check(text.sandbox.includes("!/^(TWILIO_"), "Sandbox no longer strips provider credentials");
  check(text.twilioToken.includes('const ACCOUNT_SID = process.env["TWILIO_ACCOUNT_SID"];')
    && text.twilioToken.includes('const reason = getTwilioFailureReason();')
    && text.twilioToken.includes('res.status(503).json({ error: "Twilio token unavailable", reason })')
    && text.integrationHealth.includes('if (!env["TWILIO_ACCOUNT_SID"]) return "missing:TWILIO_ACCOUNT_SID"'),
    "Twilio token 503 source branch changed");
  check(text.ownedNumbers.includes('process.env["TWILIO_ACCOUNT_SID"]') && text.ownedNumbers.includes('process.env["TWILIO_AUTH_TOKEN"]')
    && text.ownedNumbers.includes('throw new Error("Twilio owned-number lookup unavailable")')
    && text.telephonySettingsRoute.includes('router.get("/settings/telephony/owned-numbers"')
    && text.telephonySettingsRoute.includes('res.status(503).json({ error: "Twilio owned-number lookup unavailable" })'),
    "Owned-number 503 source branch changed");
  check(text.application.includes('router.get("/leads/:id/application"')
    && text.application.includes('res.status(404).json({ error: "No application on file" })'),
    "Application-absence 404 source branch changed");
  const filesSha256 = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, rel]) =>
    [key, await hashBytes(await readFile(join(root, rel)))])));
  return { files, filesSha256, sandboxStripsTwilioEnvironment: true, routeResponsesProven: true };
}
const expectedAdditions = [
  { tag: "INPUT", role: null, type: null, name: "Search referrer", href: null, disabled: false },
  { tag: "BUTTON", role: null, type: null, name: "Share referral link", href: null, disabled: false },
];
const retryControl = { tag: "BUTTON", role: null, type: "button", name: "Retry", href: null, disabled: false };
const additionCases = ["lead-detail-390-admin","lead-detail-768-admin","lead-detail-390-manager","lead-detail-768-manager","lead-detail-390-rep","lead-detail-768-rep"];
const retryCases = ["leads-390-rep","leads-768-rep","pipeline-390-rep","pipeline-768-rep"];
function countControl(items, control) { return items.filter(item => JSON.stringify(item) === JSON.stringify(control)).length; }
function normalized(items, control) { const out = [...items], i = out.findIndex(item => JSON.stringify(item) === JSON.stringify(control)); if (i >= 0) out.splice(i, 1); return out; }
async function validateExistingStructure() {
  const sourceBinding = JSON.parse(await readFile(join(root, "reports/opt-in-recertification/final-source-binding.json"), "utf8"));
  const result = JSON.parse(await readFile(join(sourceDir, "leads-certification.json"), "utf8"));
  const controls = JSON.parse(await readFile(join(sourceDir, "structure-controls.json"), "utf8"));
  const differences = JSON.parse(await readFile(join(sourceDir, "structure-differences.json"), "utf8"));
  const approval = JSON.parse(await readFile(join(sourceDir, "approved-exceptions.json"), "utf8"));
  const archivedControls = JSON.parse(await readFile(join(root, "reports/structural-certification-2026-10-03/after/role-controls.json"), "utf8"));
  const archivedExemptions = JSON.parse(await readFile(join(root, "reports/structural-certification-2026-10-03/after/exempt-controls.json"), "utf8"));
  check(target === "b3975aea8761ce5cdb43ec3206fe995ee012883a" && snapshot === "3d40d822dae9eeb103ba65923b4e445a7c8531a2",
    "Supplement requires the exact approved source/snapshot pins");
  check(/^[0-9a-f]{64}$/.test(expectedIndex) && /^[0-9a-f]{64}$/.test(expectedApi), "Missing exact immutable web/API hashes");
  check(sourceBinding.candidate === target && sourceBinding.sourceFilesMatched === 881, "Final source binding mismatch");
  check(result.target === target && result.localSnapshot === snapshot && result.candidateIndexSha256 === expectedIndex
    && result.candidateApiDistSha256 === expectedApi, "Saved structural report does not match requested immutable pins");
  check(await hashBytes(await readFile(join(webRoot, "index.html"))) === expectedIndex, "Current frozen web index no longer matches the saved pin");
  check(await hashTree(join(root, "artifacts/api-server/dist")) === expectedApi, "Current API dist no longer matches the saved pin");
  check(result.structurePass === true && result.strictRequired === 36 && result.comparisons?.length === 36,
    "Saved structural report is not a 36-case pass");
  check(result.errors?.length === 143, "Prior primitive console-error count changed; preserve it as limited raw evidence");
  check(Array.isArray(differences) && differences.length === 0, "Saved structure-differences.json is not empty");
  check(controls.baseline && controls.target && controls.baseline.controls && controls.target.controls,
    "Missing saved baseline/target structure controls");
  const baseKeys = Object.keys(controls.baseline.controls).sort();
  const targetKeys = Object.keys(controls.target.controls).sort();
  check(baseKeys.length === 36 && JSON.stringify(baseKeys) === JSON.stringify(targetKeys), "Saved structure key inventory is not 36 matching cases");
  check(JSON.stringify(Object.keys(controls.baseline.exemptions).sort()) === JSON.stringify(baseKeys)
    && JSON.stringify(Object.keys(controls.target.exemptions).sort()) === JSON.stringify(baseKeys), "Saved exemption key inventory changed");
  check(JSON.stringify(approval.manifest.additions.controls) === JSON.stringify(expectedAdditions)
    && JSON.stringify(approval.manifest.additions.cases) === JSON.stringify(additionCases)
    && approval.manifest.additions.expectedTotal === 12, "Saved approval manifest addition scope changed");
  check(approval.manifest.removals.length === 1 && JSON.stringify(approval.manifest.removals[0].control) === JSON.stringify(retryControl)
    && JSON.stringify(approval.manifest.removals[0].cases) === JSON.stringify(retryCases), "Saved approval manifest Retry-removal scope changed");
  const comparisons = new Map(result.comparisons.map(row => [row.key, row]));
  const computed = [];
  for (const key of baseKeys) {
    const baseline = controls.baseline.controls[key], candidate = controls.target.controls[key];
    check(Array.isArray(baseline) && Array.isArray(candidate) && Array.isArray(archivedControls[key]), `Missing controls for ${key}`);
    const addAllowed = additionCases.some(prefix => prefix === key);
    const additionsSeen = expectedAdditions.map(control => countControl(candidate, control));
    check(additionsSeen.every(count => count === (addAllowed ? 1 : 0)), `Approved Lead Detail additions mismatch at ${key}`);
    const candidateNormalized = expectedAdditions.reduce((items, control) => addAllowed ? normalized(items, control) : items, [...candidate]);
    const retryAllowed = retryCases.includes(key);
    const baselineRetryCount = countControl(baseline, retryControl);
    const archivedRetryCount = countControl(archivedControls[key], retryControl);
    const candidateRetryCount = countControl(candidate, retryControl);
    if (retryAllowed) check(baselineRetryCount === 1 && archivedRetryCount === 1 && candidateRetryCount === 0, `Retry-removal counts mismatch at ${key}`);
    const baselineNormalized = retryAllowed ? normalized(baseline, retryControl) : [...baseline];
    const archivedNormalized = retryAllowed ? normalized(archivedControls[key], retryControl) : [...archivedControls[key]];
    const exemptionsEqual = JSON.stringify(controls.baseline.exemptions[key]) === JSON.stringify(controls.target.exemptions[key]);
    const certifiedExemptionsEqual = JSON.stringify(archivedExemptions[key]) === JSON.stringify(controls.target.exemptions[key]);
    const row = { key, controlsEqual: JSON.stringify(baselineNormalized) === JSON.stringify(candidateNormalized),
      certifiedInventoryEqual: JSON.stringify(archivedNormalized) === JSON.stringify(candidateNormalized),
      exemptionsEqual, certifiedExemptionsEqual, approvedAdditionPass: true, approvedRemovalPass: !retryAllowed || (baselineRetryCount === 1 && archivedRetryCount === 1 && candidateRetryCount === 0) };
    check(Object.values(row).every(value => typeof value !== "boolean" || value === true), `Recomputed structure comparison failed at ${key}`);
    const saved = comparisons.get(key);
    check(saved && Object.entries(row).every(([name, value]) => saved[name] === value), `Saved comparison disagrees with raw controls at ${key}`);
    computed.push(row);
  }
  check(approval.additions.actualTotal === 12 && approval.removals.actualBaselineTotal === 4
    && approval.removals.actualArchivedTotal === 4 && approval.removals.actualCandidateTotal === 0
    && approval.removals.rows?.length === 4 && approval.removals.rows.every(row => row.pass), "Saved approved-exception totals disagree");
  const inputHashes = {};
  for (const name of originalEvidenceNames) inputHashes[name] = await hashBytes(await readFile(join(sourceDir, name)));
  return { target, snapshot, webIndexSha256: expectedIndex, apiDistSha256: expectedApi, sourceFilesMatched: sourceBinding.sourceFilesMatched,
    structurePass: true, comparisonCount: computed.length, additions: 12, retryBaseline: 4, retryArchived: 4, retryCandidate: 0,
    rawPrimitiveConsoleEvents: result.errors.length, importedOrReclassifiedPrimitiveErrors: false, originalEvidenceHashes: inputHashes };
}
function describeControl(el) {
  return { tag: el.tagName, role: el.getAttribute("role"), type: el.getAttribute("type"),
    name: el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.textContent?.trim().replace(/\s+/g, " "),
    href: el.getAttribute("href"), disabled: el.hasAttribute("disabled") };
}
async function inventory(page) {
  return page.evaluate(() => {
    const exempt = el => !!el.closest("[data-appearance-control],nav[aria-label='Record actions']");
    const els = [...document.querySelectorAll("button,a,input,select,textarea,[role=combobox],[contenteditable=true]")];
    return { controls: els.filter(el => !exempt(el)).map(el => ({ tag: el.tagName, role: el.getAttribute("role"), type: el.getAttribute("type"),
      name: el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.textContent?.trim().replace(/\s+/g, " "),
      href: el.getAttribute("href"), disabled: el.hasAttribute("disabled") })) };
  });
}
function parseReason(text) {
  const parsed = (() => { try { return JSON.parse(text); } catch { return null; } })();
  const allowed = ["error", "message", "reason", "code", "detail", "title", "status"];
  return parsed && typeof parsed === "object"
    ? Object.fromEntries(allowed.filter(key => typeof parsed[key] === "string" || typeof parsed[key] === "number").map(key => [key, safeText(parsed[key])]))
    : (/^\s*</.test(text) ? { bodyOmitted: "html" } : { text: safeText(text) });
}
function pushHttp(row, type) {
  httpTrace.push(row); void durableEvent("http-events.ndjson", { type, ...row });
}
async function attachTrace(page, role, phaseRef) {
  const metas = new WeakMap(), requests = new Map();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  cdp.on("Network.requestWillBeSent", event => {
    let pagePath = safeUrl(page.url()).path;
    if (event.type === "Document") pagePath = safeUrl(event.request.url).path;
    const url = safeUrl(event.request.url);
    const row = { eventId: `http-${httpTrace.length + 1}`, method: event.request.method, url, role, phase: phaseRef.value,
      pagePathAtInitiation: pagePath,
      initiator: { type: event.initiator?.type ?? null, url: event.initiator?.url ? safeUrl(event.initiator.url) : null,
        stack: (event.initiator?.stack?.callFrames ?? []).slice(0, 5).map(frame => ({ functionName: safeText(frame.functionName),
          url: safeUrl(frame.url), lineNumber: frame.lineNumber, columnNumber: frame.columnNumber })) },
      resourceType: event.type ?? null, initiatedAt: new Date().toISOString() };
    requests.set(event.requestId, row);
    if (role === "rep" && row.method === "GET" && url.path === "/api/users") {
      repUserListRequests.push(row); void durableEvent("rep-user-list-requests.ndjson", row);
    }
  });
  cdp.on("Network.responseReceived", event => {
    const requestRow = requests.get(event.requestId);
    if (!requestRow || ![403,404,503].includes(event.response.status)) return;
    pushHttp({ ...requestRow, status: event.response.status, statusText: safeText(event.response.statusText),
      observedAt: new Date().toISOString(), reason: null, playwrightResponseMerged: false }, "cdp-status");
  });
  page.on("request", request => metas.set(request, { method: request.method(), url: safeUrl(request.url()),
    role, phase: phaseRef.value, pagePathAtInitiation: request.resourceType() === "document" ? safeUrl(request.url()).path : safeUrl(page.url()).path }));
  page.on("response", response => {
    if (![403,404,503].includes(response.status())) return;
    const meta = metas.get(response.request()) ?? {}, url = safeUrl(response.url()), now = Date.now();
    const row = [...httpTrace].reverse().filter(item => item.role === role && item.phase === phaseRef.value
      && item.method === response.request().method() && item.status === response.status()
      && item.url?.origin === url.origin && item.url?.path === url.path && !item.playwrightResponseMerged
      && Math.abs(Date.parse(item.observedAt) - now) < 2000)
      .sort((a,b) => Math.abs(Date.parse(a.observedAt) - now) - Math.abs(Date.parse(b.observedAt) - now))[0];
    if (row) row.playwrightResponseMerged = true;
    const destination = row ?? { eventId: `http-${httpTrace.length + 1}`, ...meta, status: response.status(), url,
      observedAt: new Date().toISOString(), reason: null, playwrightResponseMerged: true };
    const task = response.text().then(text => {
      destination.reason = parseReason(text); destination.statusText = safeText(response.statusText());
      if (!row) pushHttp(destination, "playwright-response");
      else void durableEvent("http-events.ndjson", { type: "response-body-reason", eventId: row.eventId, reason: destination.reason });
    }).catch(error => {
      destination.reasonReadError = safeText(error?.message);
      if (!row) pushHttp(destination, "playwright-response-body-unavailable");
      else void durableEvent("http-events.ndjson", { type: "response-body-unavailable", eventId: row.eventId, error: destination.reasonReadError });
    });
    pendingTraceReads.add(task); task.finally(() => pendingTraceReads.delete(task));
  });
  page.on("console", message => {
    if (message.type() !== "error") return;
    const location = message.location();
    const row = { eventId: `console-${consoleTrace.length + 1}`, role, phase: phaseRef.value,
      pagePath: safeUrl(page.url()).path, message: safeText(message.text()), observedAt: new Date().toISOString(),
      location: { url: location.url ? safeUrl(location.url) : null, lineNumber: location.lineNumber, columnNumber: location.columnNumber } };
    consoleTrace.push(row); void durableEvent("console-events.ndjson", row);
  });
  page.on("pageerror", error => {
    const row = { eventId: `pageerror-${pageErrors.length + 1}`, role, phase: phaseRef.value, pagePath: safeUrl(page.url()).path,
      message: safeText(error.message), observedAt: new Date().toISOString() };
    pageErrors.push(row); void durableEvent("page-errors.ndjson", row);
  });
  page.on("requestfailed", request => {
    const row = { role, phase: phaseRef.value, method: request.method(), url: safeUrl(request.url()),
      pagePath: safeUrl(page.url()).path, failure: safeText(request.failure()?.errorText), observedAt: new Date().toISOString() };
    requestFailures.push(row); void durableEvent("request-failures.ndjson", row);
  });
  return cdp;
}
async function captureCandidateHttp() {
  const outcomes = await Promise.allSettled(roles.map(async role => {
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: "light", reducedMotion: "reduce", serviceWorkers: "block" });
    try {
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      const phaseRef = { value: "supplemental:target:login" }; const cdp = await attachTrace(page, role, phaseRef);
      await fixture.login(page, role);
      await durableEvent("events.ndjson", { type: "role-login", role, outcome: "completed", at: new Date().toISOString() });
      for (const [name, path] of pages) {
        phaseRef.value = `supplemental:target:${name}:390`;
        const startedAt = new Date().toISOString();
        await durableEvent("events.ndjson", { type: "route-start", role, page: name, width, path, at: startedAt });
        await page.setViewportSize({ width, height });
        await page.goto(fixture.url + path);
        await waitForPage(page, name);
        const controls = await inventory(page);
        await routeProgress({ phase: "supplemental:target", role, page: name, path, width, status: "completed",
          controls: controls.controls.length, observedAt: new Date().toISOString() });
      }
      await Promise.allSettled([...pendingTraceReads]);
      await cdp.detach().catch(() => {});
    } finally { await context.close(); }
  }));
  const rejected = outcomes.filter(item => item.status === "rejected");
  if (rejected.length) throw new Error(`Candidate HTTP route capture failed: ${rejected.map(item => safeText(item.reason?.stack ?? item.reason)).join("\n")}`);
  check(routeVisits.length === 18, `Expected 18 candidate route visits; got ${routeVisits.length}`);
}
function isServiceWorkerError(event) {
  return /service.?worker|navigator\.serviceWorker/i.test(event.message)
    || (/addEventListener/i.test(event.message) && /undefined/i.test(event.message) && /(?:sw|service.?worker|index-[^/]+\.js)/i.test(event.location?.url?.path ?? ""));
}
function classifyHttp() {
  return httpTrace.map((row, index) => {
    const hasReason = row.reason && Object.keys(row.reason).length > 0;
    const sibling = !hasReason && httpTrace.find(other => other !== row && other.role === row.role && other.phase === row.phase
      && other.method === row.method && other.status === row.status && other.pagePathAtInitiation === row.pagePathAtInitiation
      && other.url?.origin === row.url?.origin && other.url?.path === row.url?.path && other.reason && Object.keys(other.reason).length > 0);
    const ambiguity = sibling ? { note: "Duplicate same-role/page/phase response; this response body was unavailable.",
      supportingResponse: { eventId: sibling.eventId, status: sibling.status, reason: sibling.reason } } : null;
    const detailComplete = !!(row.method && row.url?.origin && row.url?.path && row.pagePathAtInitiation && row.role && row.phase && (hasReason || ambiguity));
    let classification = "defect: unexpected status/path/reason";
    if (row.status === 503 && row.method === "POST" && row.url?.path === "/api/twilio/token"
      && row.reason?.error === "Twilio token unavailable" && row.reason?.reason === "missing:TWILIO_ACCOUNT_SID") {
      classification = "expected isolated-fixture missing Twilio credentials";
    } else if (row.status === 503 && row.method === "GET" && row.url?.path === "/api/settings/telephony/owned-numbers"
      && row.reason?.error === "Twilio owned-number lookup unavailable") {
      classification = "expected isolated-fixture missing Twilio credentials";
    } else if (row.status === 404 && row.method === "GET" && /\/api\/leads\/[^/]+\/application$/.test(row.url?.path ?? "")
      && (row.reason?.error === "No application on file" || (ambiguity && sibling?.reason?.error === "No application on file"))) {
      classification = ambiguity ? "expected fixture application absence; explicit duplicate-body ambiguity" : "expected fixture application absence";
    }
    if (row.status === 403) classification = "defect: candidate authorization response";
    return { ...row, detailComplete, reasonOrExplicitAmbiguity: hasReason ? { reason: row.reason } : ambiguity,
      classification, candidateResponse: true, eventId: row.eventId ?? `http-${index + 1}` };
  });
}
function classifyConsole(httpClassification) {
  return consoleTrace.map(event => {
    const status = Number(event.message.match(/\b(403|404|503)\b/)?.[1] ?? 0);
    const url = event.location?.url;
    const matches = status && url ? httpClassification.filter(row => row.role === event.role && row.status === status
      && row.url?.origin === url.origin && row.url?.path === url.path
      && Math.abs(Date.parse(row.observedAt) - Date.parse(event.observedAt)) <= 2000
      && row.pagePathAtInitiation === event.pagePath) : [];
    const sw = isServiceWorkerError(event);
    const approved = status && matches.length > 0 && matches.every(row => row.classification.startsWith("expected "));
    const classification = sw ? "defect: candidate service-worker console error"
      : status ? (approved ? "expected response-error console message" : "defect: unclassified/unexpected HTTP console error")
        : "defect: candidate console error without classified HTTP response";
    return { ...event, matchedResponseIds: matches.map(row => row.eventId),
      matchConfidence: matches.length === 1 ? "unique exact URL/status/role/page/time"
        : matches.length ? "ambiguous multiple exact URL/status/role/page/time" : "unmatched",
      serviceWorkerException: sw, classification, candidateError: true };
  });
}
async function selectOption(page, combo, option) {
  await combo.click();
  const seen = await page.getByRole("option").allTextContents();
  check(seen.some(text => text.trim() === option), `Accessible option "${option}" absent; saw ${JSON.stringify(seen)}`);
  await page.getByRole("option", { name: option, exact: true }).click();
}
async function leadsJourney(page) {
  await phase("leads-functional-journey");
  await page.setViewportSize({ width: 1440, height }); await page.goto(fixture.url + "/leads");
  await page.getByRole("heading", { name: "Leads", exact: true }).waitFor();
  const tableRows = page.locator('[data-testid="table-leads-fit"] tbody tr');
  await tableRows.first().waitFor();
  const search = page.getByPlaceholder("Search by name, email, company…", { exact: true });
  await search.fill("Synthetic Contact");
  await page.waitForFunction(() => { const rows = [...document.querySelectorAll('[data-testid="table-leads-fit"] tbody tr')]; return rows.length === 1 && rows[0].textContent.includes("Synthetic Contact"); });
  check(await tableRows.count() === 1, "Search by Synthetic Contact did not narrow to one row");
  await recordJourney({ step: "search-by-name", outcome: "Synthetic Contact -> one row" });
  await search.fill("Fixture Services LLC");
  await page.waitForFunction(() => { const rows = [...document.querySelectorAll('[data-testid="table-leads-fit"] tbody tr')]; return rows.length === 1 && rows[0].textContent.includes("Fixture Services LLC"); });
  check(await tableRows.count() === 1, "Company search did not narrow to one row");
  await recordJourney({ step: "search-by-company", outcome: "Fixture Services LLC -> matching applicant row" });
  await search.fill("");
  const combos = page.getByRole("combobox");
  await selectOption(page, combos.nth(0), "Contacted");
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="table-leads-fit"] tbody tr').length === 1);
  check(await tableRows.count() === 1, "Contacted status filter failed");
  await recordJourney({ step: "status-filter", outcome: "Contacted -> one matching synthetic lead" });
  await selectOption(page, combos.nth(0), "All Statuses");
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="table-leads-fit"] tbody tr').length === 2);
  await selectOption(page, page.getByRole("combobox").nth(1), "Equipment");
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="table-leads-fit"] tbody tr').length === 1);
  check(await tableRows.count() === 1, "Equipment type filter failed");
  await recordJourney({ step: "type-filter", outcome: "Equipment -> matching lead" });
  await selectOption(page, page.getByRole("combobox").nth(1), "All Types");
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="table-leads-fit"] tbody tr').length === 2);
  await page.getByRole("button", { name: "Filter by representative" }).click();
  const repOptions = await page.getByRole("option").allTextContents();
  check(repOptions.some(text => text.includes("Visual Fixture")), "Fixture rep option is missing");
  await page.getByRole("option", { name: /Visual Fixture/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="table-leads-fit"] tbody tr').length === 2);
  check(await tableRows.count() === 2, "Representative filter did not return the two assigned synthetic leads");
  await recordJourney({ step: "representative-filter", outcome: "Visual Fixture -> two assigned synthetic leads" });
  const sortRequest = page.waitForRequest(request => { try { return new URL(request.url()).searchParams.get("sortOrder") === "asc"; } catch { return false; } });
  await selectOption(page, page.getByRole("combobox").last(), "Oldest First");
  const request = await sortRequest;
  await page.getByRole("combobox").last().getByText("Oldest First").waitFor();
  check(new URL(request.url()).searchParams.get("sortOrder") === "asc", "Oldest First did not request sortOrder=asc");
  await recordJourney({ step: "sort-oldest-first", outcome: "Selected; API requested sortOrder=asc" });

  await page.goto(fixture.url + "/leads"); await page.getByRole("heading", { name: "Leads", exact: true }).waitFor();
  const row = page.locator('[data-testid="table-leads-fit"] tbody tr').filter({ hasText: "Synthetic Contact" });
  const point = await row.evaluate(tr => {
    for (const td of tr.cells) { const r = td.getBoundingClientRect(); for (const [x,y] of [[r.left+3,r.top+3],[r.right-3,r.top+3],[r.left+3,r.bottom-3],[r.right-3,r.bottom-3]]) if (document.elementFromPoint(x,y) === td) return {x,y}; }
    return null;
  });
  check(point, "No genuinely blank noninteractive table-cell point found");
  const beforeBlank = page.url();
  const navigated = page.waitForURL(/\/leads\/1(?:\?.*)?$/, { timeout: 1200 }).then(() => true).catch(() => false);
  await page.mouse.click(point.x, point.y);
  check(!(await navigated) && page.url() === beforeBlank, "Blank row background navigated away from Leads");
  await recordJourney({ step: "blank-row-background", outcome: "remained on /leads; row-background navigation is not expected", point });
  const phone = row.locator('a[href^="tel:"]'), phoneHref = await phone.getAttribute("href");
  await page.evaluate(() => { window.__telClicks=[]; document.addEventListener("click", e=>{const a=e.target.closest?.('a[href^="tel:"]'); if(a){e.preventDefault();window.__telClicks.push(a.href)}},true); });
  const beforePhone = page.url(); await phone.click();
  check(page.url() === beforePhone && (await page.evaluate(() => window.__telClicks)).length === 1, "List phone action navigated or did not fire");
  await recordJourney({ step: "list-phone-link", outcome: "default prevented; stayed on Leads", href: "tel:[synthetic]" });
  const email = row.locator('[data-contact-link="email"]'), emailHref = await email.getAttribute("href");
  await email.click(); await page.waitForURL(/\/leads\/1(?:\?.*)?$/);
  const comms = page.getByRole("tab", { name: /^Comms/ }); await comms.waitFor();
  check(await comms.getAttribute("data-state") === "active", "Email link did not activate lead Comms tab");
  await recordJourney({ step: "list-email-link", outcome: "opened lead detail and activated Comms", href: "mailto:[synthetic]" });
  const detailPhone = page.locator('a[href^="tel:"]');
  check(await detailPhone.count() >= 1, "Lead detail phone link missing");
  const beforeDetailPhone = page.url(); await detailPhone.first().click();
  check(page.url() === beforeDetailPhone, "Lead detail phone link navigated away");
  await recordJourney({ step: "detail-phone-link", outcome: "default prevented; stayed on lead detail" });
  await page.goto(fixture.url + "/leads");
  await page.getByRole("link", { name: /Synthetic Contact/ }).first().click(); await page.waitForURL(/\/leads\/1(?:\?.*)?$/);
  await waitForPage(page, "lead-detail");
  const heading = await page.locator("h1").first().innerText();
  check(new URL(page.url()).pathname === "/leads/1" && /Fixture Equipment LLC|Synthetic Contact/.test(heading), "Lead name link did not open expected detail");
  await recordJourney({ step: "lead-name-link", outcome: "opened /leads/1", heading });
  await page.goto(fixture.url + "/leads");
  const companyRow = page.locator('[data-testid="table-leads-fit"] tbody tr').filter({ hasText: "Synthetic Contact" });
  const companyLink = companyRow.getByRole("link").nth(1);
  check(await companyLink.getAttribute("href") === "/leads/1", "Company link no longer targets /leads/1");
  await companyLink.click(); await page.waitForURL(/\/leads\/1(?:\?.*)?$/); await waitForPage(page, "lead-detail");
  check(new URL(page.url()).pathname === "/leads/1", "Company link did not open expected detail");
  await recordJourney({ step: "company-link", outcome: "opened /leads/1 detail" });

  for (const theme of ["light", "dark"]) {
    if (theme === "dark") {
      await page.setViewportSize({ width: 390, height }); await page.goto(fixture.url + "/settings"); await waitForPage(page, "settings");
      await page.getByLabel("Appearance theme").selectOption("dark");
      await recordJourney({ step: "theme-switch", outcome: "selected dark appearance" });
    }
    for (const viewportWidth of [390,768,1280,1440]) {
      await page.setViewportSize({ width: viewportWidth, height }); await page.goto(fixture.url + "/leads");
      await page.getByRole("heading", { name: "Leads", exact: true }).waitFor(); await waitForPage(page, "leads");
      if (theme === "dark") check(await page.locator("html").getAttribute("data-appearance") === "dark", "Dark appearance did not persist");
      const geometry = await page.evaluate(() => {
        const box = el => el?.getBoundingClientRect().toJSON(), table = document.querySelector('[data-testid="table-leads-fit"] table'), region = document.querySelector(".leads-fit-region");
        return { viewport: { width: innerWidth, height: innerHeight }, document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
          table: table && { rect: box(table), clientWidth: table.clientWidth, scrollWidth: table.scrollWidth },
          fitRegion: region && { rect: box(region), clientWidth: region.clientWidth, scrollWidth: region.scrollWidth, clientHeight: region.clientHeight, scrollHeight: region.scrollHeight },
          rows: [...(table?.querySelectorAll("tbody tr") ?? [])].map(box) };
      });
      const name = `leads-${viewportWidth}-${theme}.png`, relative = `screenshots/${name}`;
      await page.screenshot({ path: join(screenshotsDir, name) });
      state.screenshots = [...state.screenshots, relative]; await stableWrite("run-progress.json", state);
      await recordJourney({ step: "leads-screenshot", outcome: `${viewportWidth}x${height} ${theme}`, screenshot: relative, geometry });
    }
  }
  check(state.screenshots.length === 8, `Expected eight Leads screenshots; got ${state.screenshots.length}`);
}
async function restoreHistoricalCampaign({ validateOnly = false } = {}) {
  const sourcePath = join(root, ".local/certification-853f4e4/historical-campaign.json");
  const sourceBytes = await readFile(sourcePath), historical = JSON.parse(sourceBytes);
  check(historical.campaign?.id === 5 && historical.campaign?.status === "completed"
    && historical.launches?.length === 1 && historical.recipients?.length === 13 && historical.sends?.length === 13,
    "Historical campaign snapshot shape/counts changed");
  const dbName = fixture.query("SELECT current_database()");
  check(/^visual_refresh_fixture_\d+_\d+$/.test(dbName), "Refusing campaign writes outside the isolated fixture DB");
  const dbUrl = new URL(process.env.DATABASE_URL); dbUrl.pathname = `/${dbName}`;
  check(dbUrl.pathname.slice(1) === dbName, "Fixture-only database URL guard failed");
  const q = value => `'${String(value).replaceAll("'", "''")}'`;
  const ts = value => value == null ? "NULL" : `${q(value.replace("T", " "))}::timestamp`;
  const tz = value => value == null ? "NULL" : `${q(value)}::timestamptz`;
  const leadsBySource = new Map([...new Set(historical.recipients.map(row => row.lead_id))].map((sourceId, index) => [sourceId,index+3]));
  const sql = [];
  for (const [,id] of leadsBySource) {
    const n = id-2, ordinal = String(n).padStart(2,"0");
    sql.push(`INSERT INTO leads(id,first_name,last_name,email,phone,company_name,application_type,status,assigned_rep_id,lead_source,created_at,updated_at)
      VALUES (${id},'Historical','Fixture Recipient ${ordinal}',${q(`historical-recipient-${ordinal}@example.invalid`)},${q(`+1202555${String(100+n).padStart(4, "0")}`)},
      ${q(`Synthetic Campaign Recipient ${ordinal}`)},'equipment','contacted',3,'manual',now(),now());`);
  }
  const c = historical.campaign, launch = historical.launches[0];
  sql.push(`INSERT INTO campaigns(id,name,channel,status,email_template_id,audience_rules,scheduled_at,launched_at,completed_at,owner_id,created_by,version,created_at,updated_at,tracking_since,reply_to_email,flyer_delivery_mode)
    VALUES (5,${q(c.name)},${q(c.channel)},${q(c.status)},1,'{}'::jsonb,${tz(c.scheduled_at)},${tz(c.launched_at)},${tz(c.completed_at)},1,1,${c.version},${tz(c.created_at)},${tz(c.updated_at)},NULL,'fixture-replies@example.invalid',${q(c.flyer_delivery_mode)});`);
  sql.push(`INSERT INTO campaign_launches(id,campaign_id,idempotency_key,requested_by,mode,status,eligible_count,excluded_count,sent_count,failed_count,scheduled_at,started_at,completed_at,created_at)
    VALUES (5,5,'historical-fixture-launch-5',1,${q(launch.mode)},${q(launch.status)},${launch.eligible_count},${launch.excluded_count},${launch.sent_count},${launch.failed_count},${tz(launch.scheduled_at)},${tz(launch.started_at)},${tz(launch.completed_at)},${tz(launch.created_at)});`);
  for (const send of historical.sends) {
    const id = leadsBySource.get(send.lead_id), ordinal = String(id-2).padStart(2,"0");
    sql.push(`INSERT INTO email_sends(id,lead_id,user_id,template_id,subject,to_email,from_email,status,sendgrid_message_id,sent_at,opened_at,clicked_at,created_at,updated_at,campaign_id,campaign_launch_id,delivery_kind)
      VALUES (${send.id},${id},1,1,${q("Vendors — Heavy Equipment (synthetic historical fixture)")},${q(`historical-recipient-${ordinal}@example.invalid`)},'fixture-sender@example.invalid',
      ${q(send.status)},NULL,${ts(send.sent_at)},${ts(send.opened_at)},${ts(send.clicked_at)},${ts(send.created_at)},${ts(send.updated_at)},5,5,${q(send.delivery_kind)});`);
  }
  for (const recipient of historical.recipients) {
    sql.push(`INSERT INTO campaign_recipients(id,launch_id,campaign_id,lead_id,channel,status,exclusion_reason,available_at,email_send_id,sent_at,created_at)
      VALUES (${recipient.id},5,5,${leadsBySource.get(recipient.lead_id)},${q(recipient.channel)},${q(recipient.status)},${recipient.exclusion_reason == null ? "NULL" : q(recipient.exclusion_reason)},
      ${tz(recipient.available_at)},${recipient.email_send_id},NULL,${tz(recipient.created_at)});`);
  }
  for (const [table, seq] of [["leads",15],["campaigns",5],["campaign_launches",5],["campaign_recipients",26],["email_sends",45]]) sql.push(`SELECT setval(pg_get_serial_sequence('${table}','id'),${seq},true);`);
  if (validateOnly) {
    await phase("campaign-sql-transaction-preflight", { campaignFixture: "parse/constraint validation in guarded fixture transaction; rollback before browser" });
    const checked = spawnSync("psql", [`--dbname=${dbUrl}`, "--no-psqlrc", "--set=ON_ERROR_STOP=on", "--command", `BEGIN;\n${sql.join("\n")}\nROLLBACK;`], { encoding: "utf8" });
    check(checked.status === 0, `Historical campaign SQL transaction preflight failed: ${safeText(checked.stderr?.slice(-1000))}`);
    const result = { status: "PASS: generated campaign SQL executed in the isolated fixture and rolled back before browser launch",
      fixtureDatabase: dbName, campaignId: c.id, generatedStatements: sql.length, expectedRecipients: historical.recipients.length,
      expectedSends: historical.sends.length, rollback: "explicit ROLLBACK" };
    await stableWrite("campaign-sql-preflight.json", result);
    return { historical, fixtureEvidence: result };
  }
  await phase("campaign-fixture-insert", { campaignFixture: "writing only to guarded disposable schema-only clone" });
  const inserted = spawnSync("psql", [`--dbname=${dbUrl}`, "--no-psqlrc", "--set=ON_ERROR_STOP=on", "--single-transaction", "--command", sql.join("\n")], { encoding: "utf8" });
  check(inserted.status === 0, `Historical campaign fixture insert failed: ${safeText(inserted.stderr?.slice(-1000))}`);
  const preserved = JSON.parse(fixture.query("SELECT json_build_object('id',c.id,'name',c.name,'status',c.status,'no_tracking',c.tracking_since IS NULL,'launch_id',l.id,'launch_sent_count',l.sent_count,'recipients_sent',(SELECT count(*) FROM campaign_recipients r WHERE r.campaign_id=c.id AND r.status='sent'),'sent_emails',(SELECT count(*) FROM email_sends e WHERE e.campaign_id=c.id AND e.status IN ('delivered','opened','clicked')),'recipient_sent_at_null',(SELECT count(*) FROM campaign_recipients r WHERE r.campaign_id=c.id AND r.sent_at IS NULL),'email_sent_at_retained',(SELECT count(*) FROM email_sends e WHERE e.campaign_id=c.id AND e.sent_at IS NOT NULL))::text FROM campaigns c JOIN campaign_launches l ON l.campaign_id=c.id WHERE c.id=5"));
  check(preserved.id === 5 && preserved.no_tracking && Number(preserved.launch_sent_count) === 13
    && Number(preserved.recipients_sent) === 13 && Number(preserved.sent_emails) === 13
    && Number(preserved.recipient_sent_at_null) === 13 && Number(preserved.email_sent_at_retained) === 13,
    `Fixture campaign rows do not preserve exact historical Sent=13 state: ${JSON.stringify(preserved)}`);
  const fixtureEvidence = { campaign: { id: c.id, status: c.status, channel: c.channel }, launch: { id: launch.id, status: launch.status, sent_count: launch.sent_count },
    sourceSha256: await hashBytes(sourceBytes), syntheticRecipients: historical.recipients.length, syntheticSends: historical.sends.length, fixtureVerification: preserved,
    fixtureDatabase: dbName, productionDataRehearsalCertified: false };
  await stableWrite("campaign-fixture-verification.json", fixtureEvidence);
  return { historical, fixtureEvidence };
}
async function campaignJourney(page, restored = null) {
  await phase("campaign-results-journey");
  const { historical, fixtureEvidence } = restored ?? await restoreHistoricalCampaign();
  await recordJourney({ step: "campaign-fixture-restored", outcome: "isolated historical campaign fixture is verified", campaignId: historical.campaign.id });
  const resultsPromise = page.waitForResponse(response => response.url().includes("/api/campaigns/5/results"));
  const metricsPromise = page.waitForResponse(response => response.url().includes("/api/campaigns/5/metrics"));
  await page.goto(fixture.url + "/campaigns/5");
  await page.getByText("Vendors — Heavy Equipment", { exact: true }).first().waitFor();
  await recordJourney({ step: "campaign-details-rendered", outcome: "campaign title rendered", campaignId: historical.campaign.id });
  await page.getByRole("tab", { name: "Results", exact: true }).click();
  await recordJourney({ step: "campaign-results-tab-selected", outcome: "Results tab selected", campaignId: historical.campaign.id });
  const [resultsResponse, metricsResponse] = await Promise.all([resultsPromise,metricsPromise]);
  check(resultsResponse.status() === 200 && metricsResponse.status() === 200, `Campaign API statuses: ${resultsResponse.status()}/${metricsResponse.status()}`);
  const results = await resultsResponse.json(), metrics = await metricsResponse.json();
  await stableWrite("campaign-api-results.json", { resultsStatus: resultsResponse.status(), resultsCounts: results.counts,
    launches: results.launches?.length, metricsStatus: metricsResponse.status(), metrics: { sent: metrics.sent, trackingSince: metrics.trackingSince,
      uniqueFlyerClicks: metrics.uniqueFlyerClicks, replies: metrics.replies, fundedDollars: metrics.fundedDollars } });
  check(results.counts.sent === 13 && results.launches.length === 1, `Legacy campaign Results count mismatch: ${JSON.stringify(results.counts)}`);
  check(metrics.sent === 13 && metrics.trackingSince == null, `Campaign KPI metrics mismatch: ${JSON.stringify({sent:metrics.sent,trackingSince:metrics.trackingSince})}`);
  await page.getByText("Campaign Results", { exact: true }).waitFor();
  const sent = page.getByText("Sent", { exact: true }).first().locator("..");
  const sentKpi = page.getByTestId("kpi-sent");
  await sentKpi.waitFor();
  check((await sent.innerText()).includes("13") && (await sentKpi.innerText()).includes("13"), "Legacy/New Sent KPIs did not both show 13");
  check((await page.getByTestId("panel-campaign-kpis").innerText()).includes("Historical tracking not available"), "Historical tracking disclaimer absent");
  check((await page.getByTestId("kpi-uniqueClicks").innerText()).includes("Not tracked")
    && (await page.getByTestId("kpi-replies").innerText()).includes("Not tracked"), "Unknown historical metrics not shown as Not tracked");
  const screenshot = "screenshots/campaign-5-results.png";
  await page.screenshot({ path: join(output, screenshot), fullPage: true });
  const evidence = { status: "completed", url: safeUrl(page.url()), campaignTitle: "Vendors — Heavy Equipment",
    resultsApi: { status: resultsResponse.status(), counts: results.counts, launches: results.launches.length },
    metricsApi: { status: metricsResponse.status(), sent: metrics.sent, trackingSince: metrics.trackingSince },
    legacyResultsSent: await sent.innerText(), kpiSent: await sentKpi.innerText(),
    trackingDisclosure: "Historical tracking not available", unknownMetrics: ["Not tracked", "Not tracked"],
    screenshot, fixtureEvidence, sourceRows: { launches: historical.launches.length, sends: historical.sends.length, recipients: historical.recipients.length },
    noLaunchAction: true, noDeliveryAction: true, productionDataRehearsalCertified: false };
  await stableWrite("campaign-results-verification.json", evidence);
  await recordJourney({ step: "campaign-results-sent-count", outcome: "legacy and new Results show Sent=13; unknown tracking disclosed", evidence });
}
function classifyServiceWorker(event) {
  return /service.?worker|navigator\.serviceWorker/i.test(event.message)
    || (/addEventListener/i.test(event.message) && /undefined/i.test(event.message) && /(?:sw|service.?worker|index-[^/]+\.js)/i.test(event.location?.url?.path ?? ""));
}
function correlateConsole(httpClassification) {
  return consoleTrace.map(event => {
    const status = Number(event.message.match(/\b(403|404|503)\b/)?.[1] ?? 0), url = event.location?.url;
    const matches = status && url ? httpClassification.filter(row => row.role === event.role && row.status === status && row.url?.origin === url.origin
      && row.url?.path === url.path && row.pagePathAtInitiation === event.pagePath && Math.abs(Date.parse(row.observedAt)-Date.parse(event.observedAt)) <= 2000) : [];
    const sw = classifyServiceWorker(event), approved = status && matches.length && matches.every(row => row.classification.startsWith("expected "));
    return { ...event, matchedResponseIds: matches.map(row=>row.eventId),
      matchConfidence: matches.length === 1 ? "unique exact URL/status/role/page/time" : matches.length ? "ambiguous multiple exact matches" : "unmatched",
      serviceWorkerException: sw,
      classification: sw ? "defect: candidate service-worker console error" : status ? (approved ? "expected response-error console message" : "defect: unmatched/unexpected HTTP console error") : "defect: candidate console error without HTTP status",
      candidateError: true };
  });
}
async function verifyCleanup() {
  const checks = [];
  for (const id of createdClerkUsers) {
    let absent = false;
    try { await clerkClient.users.getUser(id); }
    catch (error) { absent = error?.status === 404; if (!absent) throw error; }
    checks.push({ syntheticUserDeleted: absent });
  }
  const dbLiteral = fixtureDbName ? `'${fixtureDbName.replaceAll("'", "''")}'` : null;
  const fixtureExists = fixtureDbName ? spawnSync("psql", ["--dbname=" + process.env.DATABASE_URL, "--no-psqlrc", "-Atqc",
    `SELECT count(*) FROM pg_database WHERE datname=${dbLiteral}`], { encoding: "utf8" }) : null;
  const dbAbsent = !fixtureDbName || (fixtureExists?.status === 0 && fixtureExists.stdout.trim() === "0");
  const result = { verifiedAt: new Date().toISOString(), createdSyntheticUsers: createdClerkUsers.length,
    deletedAndAbsentUsers: checks.filter(item=>item.syntheticUserDeleted).length, fixtureDatabase: fixtureDbName ?? null, fixtureDatabaseAbsent: dbAbsent };
  await stableWrite("cleanup-verification.json", result);
  return result;
}
if (process.argv.includes("--preflight-only")) {
  const evidence = await validateExistingStructure();
  const proof = await verifyExpectedFixtureSources();
  const saved = JSON.parse(await readFile(join(sourceDir, "leads-certification.json"), "utf8"));
  check(JSON.stringify(proof.filesSha256) === JSON.stringify(saved.sourceProof.filesSha256), "Source proof hashes differ from the saved structural run");
  const historical = JSON.parse(await readFile(join(root, ".local/certification-853f4e4/historical-campaign.json"), "utf8"));
  check(historical.campaign?.id === 5 && historical.campaign?.status === "completed"
    && historical.launches?.length === 1 && historical.recipients?.length === 13 && historical.sends?.length === 13,
    "Anonymized historical campaign fixture no longer has the approved 1/13/13 row counts");
  console.log(JSON.stringify({ status: "PASS: supplemental preflight only; no browser, fixture DB, or Clerk sign-in",
    structure: evidence, sourceProof: proof, historicalCampaignFixture: { campaignId: historical.campaign.id,
      launches: historical.launches.length, recipients: historical.recipients.length, sends: historical.sends.length } }, null, 2));
} else if (campaignOnly) {
  let inputEvidence = null, journeyContext = null, journeyCdp = null, campaignRuntime = null, campaignFatal = null;
  try {
    await mkdir(join(root, "reports/opt-in-recertification/supplemental"), { recursive: true });
    try { await readFile(join(output, "run-progress.json")); throw new Error("Campaign-only output exists; refusing to overwrite prior evidence"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    await mkdir(output, { recursive: false }); outputInitialized = true; await mkdir(screenshotsDir);
    await stableWrite("run-progress.json", state);
    await durableEvent("events.ndjson", { type: "campaign-only-start", at: state.startedAt, target, snapshot, routePort });
    inputEvidence = await validateExistingStructure();
    await stableWrite("structure-input-validation.json", inputEvidence);
    sourceProof = await verifyExpectedFixtureSources();
    const originalReport = JSON.parse(await readFile(join(sourceDir, "leads-certification.json"), "utf8"));
    check(JSON.stringify(sourceProof.filesSha256) === JSON.stringify(originalReport.sourceProof.filesSha256), "Campaign-only source proof differs from attempt-6 pins");
    await stableWrite("source-branch-validation.json", sourceProof);
    await phase("start-isolated-schema-only-campaign-fixture", { build: false, routePort, routeVisits: 0 });
    fixture = await startSandbox({ build: false, webRoot, port: routePort });
    fixtureDbName = fixture.query("SELECT current_database()");
    await phase("campaign-fixture-ready", { fixtureDatabase: fixtureDbName, fixtureUrl: fixture.url, syntheticClerkUserIds: [...createdClerkUsers] });
    // Parse, execute all INSERTs/constraints inside the isolated DB, and roll back before a browser exists.
    await restoreHistoricalCampaign({ validateOnly: true });
    // Seed again only after the complete transaction/rollback preflight passes.
    const restored = await restoreHistoricalCampaign();
    browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", headless: true });
    journeyContext = await browser.newContext({ viewport: { width: 1440, height }, colorScheme: "light", reducedMotion: "reduce", serviceWorkers: "block" });
    const page = await journeyContext.newPage(); page.setDefaultTimeout(15000);
    const campaignPhase = { value: "campaign-only:login" };
    journeyCdp = await attachTrace(page, "admin", campaignPhase);
    await fixture.login(page, "admin");
    await recordJourney({ step: "campaign-only-admin-login", outcome: "completed" });
    campaignPhase.value = "campaign-only:results";
    await campaignJourney(page, restored);
    await journeyCdp.detach().catch(() => {}); journeyCdp = null;
    await journeyContext.close(); journeyContext = null;
    await Promise.allSettled([...pendingTraceReads]); await flush();
    const httpClassification = classifyHttp(), consoleClassification = correlateConsole(httpClassification);
    const unexpectedHttp = httpClassification.filter(row => row.classification.startsWith("defect:"));
    const incompleteHttp = httpClassification.filter(row => !row.detailComplete);
    const unexpectedConsole = consoleClassification.filter(row => row.classification.startsWith("defect:"));
    const swErrors = consoleClassification.filter(row => row.serviceWorkerException);
    campaignRuntime = { generatedSqlTransactionPassedAndRolledBack: true,
      campaignResultsSent13: journeys.some(row => row.step === "campaign-results-sent-count"),
      campaignApiStatusesAndCountsVerified: !!JSON.parse(await readFile(join(output, "campaign-api-results.json"), "utf8")),
      allCampaignHttpErrorsClassified: incompleteHttp.length === 0 && unexpectedHttp.length === 0,
      campaignConsoleErrorsClassified: unexpectedConsole.length === 0, serviceWorkerConsoleErrorsZero: swErrors.length === 0,
      pageExceptionsZero: pageErrors.length === 0 };
    await stableWrite("http-response-errors.json", httpClassification);
    await stableWrite("console-response-correlations.json", consoleClassification);
    await stableWrite("runtime-error-classification.json", { sourceProof, assertions: campaignRuntime, incompleteHttp,
      unexpectedHttp, unexpectedConsole, swErrors, pageErrors, httpResponses: httpClassification,
      consoleEvents: consoleClassification, requestFailures, scope: "campaign-only continuation; does not rerun route capture or Leads journeys" });
    check(Object.values(campaignRuntime).every(Boolean), `Campaign-only assertion failed: ${JSON.stringify(campaignRuntime)}`);
    await phase("campaign-only-complete", { campaignRuntime });
  } catch (error) {
    campaignFatal = error; state.status = "incomplete-or-failed"; state.failure = safeText(error?.stack ?? error); state.updatedAt = new Date().toISOString();
    if (outputInitialized) {
      try { await durableEvent("events.ndjson", { type: "campaign-only-failure", message: state.failure, at: state.updatedAt }); await stableWrite("run-progress.json", state); }
      catch {}
    }
  } finally {
    try { if (journeyCdp) await journeyCdp.detach().catch(() => {}); } catch {}
    try { if (journeyContext) await journeyContext.close(); } catch {}
    try { if (browser) await browser.close(); } catch (error) { campaignFatal ??= error; }
    if (fixture) {
      try { await fixture.close(); } catch (error) {
        campaignFatal ??= error;
        for (const id of createdClerkUsers) { try { await clerkClient.users.deleteUser(id); } catch {} }
        if (fixtureDbName && /^visual_refresh_fixture_\d+_\d+$/.test(fixtureDbName))
          spawnSync("dropdb", ["--if-exists", "--force", `--maintenance-db=${process.env.DATABASE_URL}`, fixtureDbName], { encoding: "utf8" });
      }
    }
    if (outputInitialized) {
      try {
        const cleanup = await verifyCleanup(); await stableWrite("cleanup-verification.json", cleanup);
        if (!cleanup.fixtureDatabaseAbsent || cleanup.deletedAndAbsentUsers !== cleanup.createdSyntheticUsers) campaignFatal ??= new Error("Campaign-only fixture cleanup verification failed");
      } catch (error) { campaignFatal ??= error; }
      try {
        const afterHashes = {};
        for (const name of originalEvidenceNames) afterHashes[name] = await hashBytes(await readFile(join(sourceDir, name)));
        const unchanged = !!inputEvidence && JSON.stringify(afterHashes) === JSON.stringify(inputEvidence.originalEvidenceHashes);
        await stableWrite("original-evidence-integrity.json", { before: inputEvidence?.originalEvidenceHashes ?? null, after: afterHashes, unchanged });
        if (inputEvidence && !unchanged) campaignFatal ??= new Error("Campaign-only run modified attempt-6 structure evidence");
      } catch (error) { campaignFatal ??= error; }
    }
  }
  try { await flush(); } catch (error) { campaignFatal ??= error; }
  const prior = await readFile(join(root, "reports/opt-in-recertification/supplemental/run/combined-summary.json"), "utf8").then(JSON.parse).catch(() => null);
  const priorExitCode = await readFile(join(root, "reports/opt-in-recertification/supplemental/run/main-persistent-exit.txt"), "utf8")
    .then(text => Number(text.trim())).catch(() => null);
  const campaignSummary = { status: campaignFatal ? "CAMPAIGN_ONLY_INCOMPLETE_OR_FAILED" : "CAMPAIGN_ONLY_PASS_SEPARATE_EXECUTION",
    target, snapshot, webIndexSha256: expectedIndex, apiDistSha256: expectedApi, structureEvidence: "attempt 6, separately preserved, 36/36 pass",
    priorSupplementalExecution: { status: prior?.status ?? "missing", exitCode: priorExitCode, candidateHttpVisits: prior?.supplementalEvidence?.candidateHttpVisits ?? 0,
      leadsJourneys: prior?.supplementalEvidence?.journeys ?? 0, leadsScreenshots: prior?.supplementalEvidence?.screenshots?.length ?? 0 },
    campaignOnlyAssertions: campaignRuntime, campaignScreenshot: campaignRuntime?.campaignResultsSent13 ? "screenshots/campaign-5-results.png" : null,
    noSingleRunExitClaim: true, productionDataRehearsalCertified: false, failure: campaignFatal ? safeText(campaignFatal?.stack ?? campaignFatal) : null };
  if (outputInitialized) {
    await stableWrite("campaign-only-summary.json", campaignSummary);
    await stableWrite("run-progress.json", { ...state, status: campaignFatal ? "incomplete-or-failed" : "completed", finalSummary: campaignSummary });
    await flush();
  }
  if (campaignFatal) { console.error(safeText(campaignFatal?.stack ?? campaignFatal)); process.exitCode = 1; }
  else console.log(JSON.stringify(campaignSummary, null, 2));
} else {
let inputEvidence, runtimeAssertions, combinedSummary, journeyContext, journeyPage, journeyCdp;
try {
  await mkdir(join(root, "reports/opt-in-recertification/supplemental"), { recursive: true });
  try { await readFile(join(output, "run-progress.json")); throw new Error("Supplement output exists; refusing to overwrite prior evidence"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  await mkdir(output, { recursive: false });
  outputInitialized = true;
  await mkdir(screenshotsDir);
  await stableWrite("run-progress.json", state);
  await durableEvent("events.ndjson", { type: "runner-start", at: state.startedAt, target, snapshot, routePort });
  await phase("validate-saved-structure");
  inputEvidence = await validateExistingStructure();
  await stableWrite("structure-input-validation.json", inputEvidence);
  sourceProof = await verifyExpectedFixtureSources();
  const originalReport = JSON.parse(await readFile(join(sourceDir, "leads-certification.json"), "utf8"));
  check(JSON.stringify(sourceProof.filesSha256) === JSON.stringify(originalReport.sourceProof.filesSha256), "Fixture source proof differs from saved structural report");
  await stableWrite("source-branch-validation.json", sourceProof);
  browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", headless: true });
  await phase("start-isolated-schema-only-fixture", { build: false, routePort });
  fixture = await startSandbox({ build: false, webRoot, port: routePort });
  fixtureDbName = fixture.query("SELECT current_database()");
  await phase("fixture-ready", { fixtureDatabase: fixtureDbName, fixtureUrl: fixture.url, syntheticClerkUserIds: [...createdClerkUsers] });
  await captureCandidateHttp();
  await phase("candidate-route-capture-complete", { completedRouteVisits: routeVisits });

  journeyContext = await browser.newContext({ viewport: { width: 1440, height }, colorScheme: "light", reducedMotion: "reduce", serviceWorkers: "block" });
  journeyPage = await journeyContext.newPage(); journeyPage.setDefaultTimeout(15000);
  const journeyPhaseRef = { value: "supplemental:journey:login" };
  journeyCdp = await attachTrace(journeyPage, "admin", journeyPhaseRef);
  await fixture.login(journeyPage, "admin");
  await recordJourney({ step: "admin-login", outcome: "completed" });
  await leadsJourney(journeyPage);
  journeyPhaseRef.value = "supplemental:journey:campaign-results";
  await campaignJourney(journeyPage);
  await journeyCdp.detach().catch(() => {}); await journeyContext.close(); journeyContext = null;
  await Promise.allSettled([...pendingTraceReads]); await flush();
  await phase("classify-supplemental-runtime");
  const httpClassification = classifyHttp();
  const consoleClassification = correlateConsole(httpClassification);
  const incompleteHttp = httpClassification.filter(row => !row.detailComplete);
  const unexpectedHttp = httpClassification.filter(row => row.classification.startsWith("defect:"));
  const swErrors = consoleClassification.filter(row => row.serviceWorkerException);
  const unexpectedConsole = consoleClassification.filter(row => row.classification.startsWith("defect:"));
  runtimeAssertions = {
    exactly18CandidateRouteVisits: routeVisits.length === 18,
    everySupplementalHttpErrorHasRequestPageRoleAndReasonOrAmbiguity: incompleteHttp.length === 0,
    candidateRepGetUsersRequestsZero: repUserListRequests.length === 0,
    everyCandidate403404503AllowedAndClassified: unexpectedHttp.length === 0,
    candidateServiceWorkerConsoleErrorsZero: swErrors.length === 0,
    candidatePageExceptionsZero: pageErrors.length === 0,
    noOtherCandidateConsoleErrors: unexpectedConsole.length === 0,
    eightLeadsScreenshots: state.screenshots.filter(path => path.startsWith("screenshots/leads-")).length === 8,
    functionalJourneysComplete: journeys.length >= 15,
    campaignResultsSent13: journeys.some(row => row.step === "campaign-results-sent-count"),
  };
  await stableWrite("http-response-errors.json", httpClassification);
  await stableWrite("console-response-correlations.json", consoleClassification);
  await stableWrite("runtime-error-classification.json", {
    sourceProof, assertions: runtimeAssertions, incompleteHttp, unexpectedHttp, repUserListRequests, swErrors,
    pageErrors, unexpectedConsole, httpResponses: httpClassification, consoleEvents: consoleClassification,
    requestFailures, scope: "supplemental current-candidate visits and functional journey only; attempt-6 primitive console events are not re-correlated",
  });
  check(Object.values(runtimeAssertions).every(Boolean), `Supplemental assertion failed: ${JSON.stringify(runtimeAssertions)}`);
  await phase("supplemental-evidence-complete", { runtimeAssertions });
} catch (error) {
  fatal = error;
  state.status = "incomplete-or-failed"; state.failure = safeText(error?.stack ?? error); state.updatedAt = new Date().toISOString();
  if (outputInitialized) {
    try { await durableEvent("events.ndjson", { type: "runner-failure", message: state.failure, at: state.updatedAt }); await stableWrite("run-progress.json", state); }
    catch {}
  }
} finally {
  try { if (journeyCdp) await journeyCdp.detach().catch(() => {}); } catch {}
  try { if (journeyContext) await journeyContext.close(); } catch {}
  try { if (browser) await browser.close(); } catch (error) { fatal ??= error; }
  if (fixture) {
    try { await fixture.close(); }
    catch (error) {
      fatal ??= error;
      await durableEvent("events.ndjson", { type: "fixture-close-warning", message: safeText(error?.message) });
      for (const id of createdClerkUsers) { try { await clerkClient.users.deleteUser(id); } catch {} }
      if (fixtureDbName && /^visual_refresh_fixture_\d+_\d+$/.test(fixtureDbName)) {
        spawnSync("dropdb", ["--if-exists", "--force", `--maintenance-db=${process.env.DATABASE_URL}`, fixtureDbName], { encoding: "utf8" });
      }
    }
  }
  if (outputInitialized) {
    try {
      const cleanup = await verifyCleanup();
      if (!cleanup.fixtureDatabaseAbsent || cleanup.deletedAndAbsentUsers !== cleanup.createdSyntheticUsers) fatal ??= new Error("Fixture cleanup verification failed");
    } catch (error) { fatal ??= error; }
    try {
      const afterHashes = {};
      for (const name of originalEvidenceNames) afterHashes[name] = await hashBytes(await readFile(join(sourceDir, name)));
      const originalEvidenceUnchanged = !!inputEvidence && JSON.stringify(afterHashes) === JSON.stringify(inputEvidence.originalEvidenceHashes);
      await stableWrite("original-evidence-integrity.json", { before: inputEvidence?.originalEvidenceHashes ?? null, after: afterHashes, unchanged: originalEvidenceUnchanged });
      if (inputEvidence && !originalEvidenceUnchanged) fatal ??= new Error("Supplemental run modified original attempt-6 structural evidence");
    } catch (error) { fatal ??= error; }
  }
}
try { await flush(); } catch (error) { fatal ??= error; }
const assertionsPass = runtimeAssertions && Object.values(runtimeAssertions).every(Boolean);
combinedSummary = {
  status: fatal ? "INCOMPLETE_OR_FAILED" : assertionsPass ? "SUPPLEMENTAL_PASS_WITH_EXISTING_STRUCTURE" : "INCOMPLETE",
  sameImmutablePins: !!inputEvidence && inputEvidence.target === target && inputEvidence.snapshot === snapshot
    && inputEvidence.webIndexSha256 === expectedIndex && inputEvidence.apiDistSha256 === expectedApi,
  structureEvidence: { source: "reports/opt-in-recertification/final-cert-run/leads-certification.json (Main attempt 6)",
    completedSeparately: true, pass: inputEvidence?.structurePass ?? false, comparisons: inputEvidence?.comparisonCount ?? 0,
    additions: inputEvidence?.additions ?? null, retryBaseline: inputEvidence?.retryBaseline ?? null,
    retryArchived: inputEvidence?.retryArchived ?? null, retryCandidate: inputEvidence?.retryCandidate ?? null },
  supplementalEvidence: { candidateHttpVisits: routeVisits.length, screenshots: state.screenshots, journeys: journeys.length,
    runtimeAssertions: runtimeAssertions ?? null, campaignSent13: journeys.some(row => row.step === "campaign-results-sent-count"),
    priorPrimitiveConsoleEventsImportedOrReclassified: false },
  separateRunNoFabricatedSingleRunExit: true, productionDataRehearsalCertified: false,
  failure: fatal ? safeText(fatal?.stack ?? fatal) : null, completedAt: new Date().toISOString(),
};
if (outputInitialized) {
  try { await stableWrite("combined-summary.json", combinedSummary); await stableWrite("run-progress.json", { ...state,
    status: fatal ? "incomplete-or-failed" : "completed", finalSummary: combinedSummary }); await flush(); }
  catch (error) { fatal ??= error; }
}
if (fatal) { console.error(safeText(fatal?.stack ?? fatal)); process.exitCode = 1; }
else console.log(JSON.stringify(combinedSummary, null, 2));
}
