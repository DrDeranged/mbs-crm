import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { startSandbox } from "../../scripts/visual-refresh/sandbox.mjs";
import { waitForPage } from "../../scripts/visual-refresh/readiness.mjs";

const root = resolve(import.meta.dirname, "../..");
const require = createRequire(join(root, "artifacts/api-server/package.json"));
const { clerkClient } = require("@clerk/express");
const createdClerkUsers = new Set();
const originalCreateUser = clerkClient.users.createUser.bind(clerkClient.users);
const originalDeleteUser = clerkClient.users.deleteUser.bind(clerkClient.users);
clerkClient.users.createUser = async (...args) => {
  const user = await originalCreateUser(...args); createdClerkUsers.add(user.id); return user;
};
clerkClient.users.deleteUser = async id => {
  try { return await originalDeleteUser(id); }
  catch (error) {
    if (error?.status === 404 || /not found|already deleted/i.test(String(error?.message))) return;
    throw error;
  }
};
const output = join(root, "reports/opt-in-recertification/final-cert-run");
const baselineRoot = resolve(root, ".local/certification-2af927c/baselines/target-2af927c");
const targetRevision = process.env.CERT_TARGET_REVISION ?? "";
const localSnapshot = process.env.CERT_LOCAL_SNAPSHOT ?? "";
const webRoot = resolve(process.env.CERT_WEB_ROOT ?? join(root, ".local/certification-853f4e4/public"));
const expectedIndexSha256 = process.env.CERT_BUILD_INDEX_SHA256 ?? "";
const expectedApiDistSha256 = process.env.CERT_API_DIST_SHA256 ?? "";
const apiDistRoot = resolve(join(root, "artifacts/api-server/dist"));
const pages = [["dashboard", "/dashboard"], ["leads", "/leads"], ["lead-detail", "/leads/1"], ["pipeline", "/deals"], ["apply", "/apply"], ["settings", "/settings"]];
const widthSet = [390, 768], height = 900, roles = ["admin", "manager", "rep"];
const snapshots = {}, errors = [], journeys = [], screenshotPaths = [], httpTrace = [], consoleTrace = [], repUserListRequests = [], pendingTraceReads = new Set(), captureProgress = [];
const approvalManifest = JSON.parse(await readFile(join(root, "reports/opt-in-recertification/approval-manifest.json"), "utf8"));
const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", headless: true });
let fixture, fixtureDbName, sourceProof;

function check(ok, message) { if (!ok) throw new Error(message); }
const expectedAdditionControls = [
  { tag: "INPUT", role: null, type: null, name: "Search referrer", href: null, disabled: false },
  { tag: "BUTTON", role: null, type: null, name: "Share referral link", href: null, disabled: false },
];
const expectedAdditionCases = ["lead-detail-390-admin","lead-detail-768-admin","lead-detail-390-manager","lead-detail-768-manager","lead-detail-390-rep","lead-detail-768-rep"];
const expectedRetryRemoval = {
  label: "approved directory-error Retry removal",
  control: { tag: "BUTTON", role: null, type: "button", name: "Retry", href: null, disabled: false },
  cases: ["leads-390-rep","leads-768-rep","pipeline-390-rep","pipeline-768-rep"],
  expectedBaselineOccurrencesPerCase: 1, expectedArchivedOccurrencesPerCase: 1, expectedCandidateOccurrencesPerCase: 0,
  expectedBaselineTotal: 4, expectedArchivedTotal: 4, expectedCandidateTotal: 0,
  applyOnlyToListedCases: true, doNotFilterOtherRetryControls: true,
};
assert.deepEqual(approvalManifest.additions.controls, expectedAdditionControls, "Approval manifest addition controls widened or changed");
assert.deepEqual(approvalManifest.additions.cases, expectedAdditionCases, "Approval manifest addition cases widened or changed");
assert.equal(approvalManifest.additions.expectedOccurrencesPerControlPerCase, 1);
assert.equal(approvalManifest.additions.expectedTotal, 12);
assert.equal(approvalManifest.additions.candidateMustContain, true);
assert.deepEqual(approvalManifest.removals, [expectedRetryRemoval], "Approval manifest removal scope widened or changed");
assert.deepEqual(approvalManifest.existingExemptions.archivedInventory, "reports/structural-certification-2026-10-03/after/exempt-controls.json");
assert.equal(approvalManifest.existingExemptions.mustRemainUnchangedForAll36RolePageViewportCases, true);
assert.equal(approvalManifest.existingExemptions.mayNotBeWidened, true);
const approvedAdditionCaseSet = new Set(approvalManifest.additions.cases);
const approvedRetryRemovalCaseSet = new Set(expectedRetryRemoval.cases);
async function hashTree(directory) {
  const hash = createHash("sha256");
  async function walk(folder, relative = "") {
    for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      const rel = join(relative, entry.name);
      if (entry.isDirectory()) await walk(join(folder, entry.name), rel);
      else if (entry.isFile()) { hash.update(rel); hash.update("\0"); hash.update(await readFile(join(folder, entry.name))); hash.update("\0"); }
    }
  }
  await walk(directory);
  return hash.digest("hex");
}
function exactCount(controls, spec) { return controls.filter(item => JSON.stringify(item) === JSON.stringify(spec)).length; }
function stripApprovedAdditions(key, controls) {
  const allowed = approvedAdditionCaseSet.has(key), remaining = [...controls], observed = [];
  for (const spec of expectedAdditionControls) {
    const count = exactCount(remaining, spec);
    observed.push({ ...spec, count });
    if (allowed && count === 1) remaining.splice(remaining.findIndex(item => JSON.stringify(item) === JSON.stringify(spec)), 1);
  }
  return { controls: remaining, allowed, actualCount: observed.reduce((sum, item) => sum + item.count, 0),
    observed, pass: observed.every(item => item.count === (allowed ? 1 : 0)) };
}
function stripApprovedRetryFromReference(key, controls) {
  const remaining = [...controls], allowed = approvedRetryRemovalCaseSet.has(key);
  const count = exactCount(remaining, expectedRetryRemoval.control);
  if (allowed && count === 1) remaining.splice(remaining.findIndex(item => JSON.stringify(item) === JSON.stringify(expectedRetryRemoval.control)), 1);
  return { controls: remaining, allowed, count };
}
function sanitizeTraceUrl(raw) {
  try {
    const u = new URL(raw);
    const path = u.pathname.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
      .replace(/(\/(?:users|leads|deals|contacts|recipients)\/)[^/]+/gi, "$1[REDACTED_ID]")
      .replace(/\/(?:eyJ[A-Za-z0-9_-]{30,}|[A-Za-z0-9_-]{48,})(?=\/|$)/g, "/[REDACTED_TOKEN]");
    const keys = [...new Set([...u.searchParams.keys()])].sort();
    return { origin: u.origin, path, query: keys.length ? Object.fromEntries(keys.map(key => [key, "[REDACTED]"])) : undefined };
  } catch { return { origin: "[non-url]", path: "[REDACTED]" }; }
}
function safeTraceText(text) {
  return String(text ?? "").replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/\+?\d[\d ()-]{7,}\d/g, "[REDACTED_PHONE]").slice(0, 1000);
}
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
  check(text.sandbox.includes("!/^(TWILIO_"), "Fixture source proof missing Twilio-environment stripping");
  check(text.twilioToken.includes('const ACCOUNT_SID = process.env["TWILIO_ACCOUNT_SID"];')
    && text.twilioToken.includes('const reason = getTwilioFailureReason();')
    && text.twilioToken.includes('res.status(503).json({ error: "Twilio token unavailable", reason })')
    && text.integrationHealth.includes('if (!env["TWILIO_ACCOUNT_SID"]) return "missing:TWILIO_ACCOUNT_SID"'),
    "Twilio token source proof no longer matches ACCOUNT_SID/getTwilioFailureReason/503 source branch");
  check(text.ownedNumbers.includes('process.env["TWILIO_ACCOUNT_SID"]') && text.ownedNumbers.includes('process.env["TWILIO_AUTH_TOKEN"]')
    && text.ownedNumbers.includes('throw new Error("Twilio owned-number lookup unavailable")'),
    "Owned-number source proof no longer matches expected missing-credential 503");
  check(text.telephonySettingsRoute.includes('router.get("/settings/telephony/owned-numbers"')
    && text.telephonySettingsRoute.includes("listOwnedTwilioNumbers()")
    && text.telephonySettingsRoute.includes('res.status(503).json({ error: "Twilio owned-number lookup unavailable" })'),
    "Owned-number route source proof no longer matches expected missing-credential 503");
  check(text.application.includes('router.get("/leads/:id/application"') && text.application.includes('res.status(404).json({ error: "No application on file" })'),
    "Application source proof no longer matches expected missing-application 404");
  const filesSha256 = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, rel]) =>
    [key, createHash("sha256").update(await readFile(join(root, rel))).digest("hex")])));
  return { files, filesSha256, sandboxStripsTwilioEnvironment: true, routeResponsesProven: true };
}
function sameTraceEndpoint(a, b) {
  return a.role === b.role && a.phase === b.phase && a.method === b.method && a.status === b.status
    && a.pagePathAtInitiation === b.pagePathAtInitiation && a.url?.origin === b.url?.origin && a.url?.path === b.url?.path;
}
function classifyHttpResponses(sourceProof) {
  const trace = httpTrace.map((row, index) => {
    const hasReason = row.reason && Object.keys(row.reason).length > 0;
    const sibling = !hasReason && httpTrace.find(other => other !== row && sameTraceEndpoint(other, row)
      && other.reason && Object.keys(other.reason).length > 0);
    const explicitAmbiguity = sibling ? {
      note: "Duplicate same-role/phase/request/page response has a captured reason; this response body itself was unavailable.",
      supportingResponse: { method: sibling.method, url: sibling.url, status: sibling.status, reason: sibling.reason },
    } : null;
    const detailComplete = !!(row.method && row.url?.origin && row.url?.path && row.pagePathAtInitiation && row.role && row.phase
      && (hasReason || explicitAmbiguity));
    const baselineOnly = row.phase?.startsWith("baseline:");
    let classification = "defect: unexpected status/path/reason";
    if (row.status === 403 && row.method === "GET" && row.url?.path === "/api/users" && row.role === "rep" && baselineOnly && row.reason?.error === "Forbidden") {
      classification = "baseline reference only: historical rep user-list authorization denial";
    } else if (row.status === 503 && row.method === "POST" && row.url?.path === "/api/twilio/token"
      && row.reason?.error === "Twilio token unavailable" && row.reason?.reason === "missing:TWILIO_ACCOUNT_SID") {
      classification = "expected isolated-fixture missing Twilio credentials";
    } else if (row.status === 503 && row.method === "GET" && row.url?.path === "/api/settings/telephony/owned-numbers"
      && row.reason?.error === "Twilio owned-number lookup unavailable") {
      classification = "expected isolated-fixture missing Twilio credentials";
    } else if (row.status === 404 && row.method === "GET" && /\/api\/leads\/[^/]+\/application$/.test(row.url?.path ?? "")
      && (row.reason?.error === "No application on file" || (explicitAmbiguity && sibling?.reason?.error === "No application on file"))) {
      classification = explicitAmbiguity ? "expected fixture application absence; response-body ambiguity explicitly linked" : "expected fixture application absence";
    }
    if (!baselineOnly && row.status === 403) classification = "defect: candidate authorization response";
    return { eventId: row.eventId ?? `http-${index + 1}`, ...row, detailComplete,
      reasonOrExplicitAmbiguity: hasReason ? { reason: row.reason } : explicitAmbiguity,
      classification, candidateResponse: !baselineOnly };
  });
  return trace;
}
function isServiceWorkerConsoleError(event) {
  return /service.?worker|navigator\.serviceWorker/i.test(event.message)
    || (/addEventListener/i.test(event.message) && /undefined/i.test(event.message)
      && /(?:sw|service.?worker|index-[^/]+\.js)/i.test(event.location?.url?.path ?? ""));
}
function classifyConsoleErrors(httpClassification) {
  return consoleTrace.map((event, index) => {
    const status = Number(event.message.match(/\b(403|404|503)\b/)?.[1] ?? 0);
    const location = event.location?.url;
    const candidateResponses = status && location ? httpClassification.filter(row => row.role === event.role && row.status === status
      && row.url?.origin === location.origin && row.url?.path === location.path
      && Math.abs(Date.parse(row.observedAt) - Date.parse(event.observedAt)) <= 2000) : [];
    const samePage = candidateResponses.filter(row => row.pagePathAtInitiation === event.pagePath);
    const matches = samePage.length ? samePage : candidateResponses;
    const isBaseline = event.phase?.startsWith("baseline:");
    const sw = isServiceWorkerConsoleError(event);
    const approvedHttp = status && matches.length > 0 && matches.every(row =>
      row.classification.startsWith("expected ") || row.classification.startsWith("baseline reference only:"));
    const classification = sw ? (isBaseline ? "baseline-only service-worker block noise" : "defect: candidate service-worker console exception")
      : status ? (approvedHttp ? "expected response error console message" : "defect: unclassified/unexpected HTTP console error")
        : (isBaseline ? "baseline-only console error; retained as reference" : "defect: candidate console error without classified HTTP response");
    return { eventId: `console-${index + 1}`, ...event, matchedResponseIds: matches.map(row => row.eventId),
      matchConfidence: matches.length === 1 ? "unique exact URL/status/role/time match"
        : matches.length > 1 ? "ambiguous multiple exact URL/status/role/time matches" : "unmatched",
      serviceWorkerException: sw, classification, candidateError: !isBaseline };
  });
}
function isCandidatePhase(phase) { return phase?.startsWith("target:") || phase?.startsWith("journey:"); }
async function attachNetworkTrace(page, role, phaseRef) {
  const metas = new WeakMap(), requests = new Map();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  cdp.on("Network.requestWillBeSent", event => {
    const u = sanitizeTraceUrl(event.request.url);
    const row = { method: event.request.method, url: u, role, phase: phaseRef.value,
      pagePathAtInitiation: event.type === "Document" ? u.path : new URL(page.url()).pathname,
      initiator: { type: event.initiator?.type ?? null, url: event.initiator?.url ? sanitizeTraceUrl(event.initiator.url) : null,
        stack: (event.initiator?.stack?.callFrames ?? []).slice(0, 5).map(f => ({ functionName: safeTraceText(f.functionName), url: sanitizeTraceUrl(f.url), lineNumber: f.lineNumber, columnNumber: f.columnNumber })) },
      resourceType: event.type ?? null, initiatedAt: new Date().toISOString() };
    if (role === "rep" && row.method === "GET" && u.path === "/api/users") repUserListRequests.push(row);
    requests.set(event.requestId, row);
  });
  cdp.on("Network.responseReceived", event => {
    const requestRow = requests.get(event.requestId);
    if (requestRow && role === "rep" && requestRow.method === "GET" && requestRow.url?.path === "/api/users") {
      requestRow.status = event.response.status;
      requestRow.statusText = safeTraceText(event.response.statusText);
      requestRow.respondedAt = new Date().toISOString();
    }
    if (![403, 404, 503].includes(event.response.status)) return;
    httpTrace.push({ ...requestRow, status: event.response.status,
      statusText: safeTraceText(event.response.statusText), observedAt: new Date().toISOString(), reason: null });
  });
  page.on("request", request => metas.set(request, { method: request.method(), url: sanitizeTraceUrl(request.url()),
    role, phase: phaseRef.value, pagePathAtInitiation: request.resourceType() === "document" ? sanitizeTraceUrl(request.url()).path : new URL(page.url()).pathname }));
  page.on("response", response => {
    if (![403, 404, 503].includes(response.status())) return;
    const meta = metas.get(response.request()) ?? {};
    const u = sanitizeTraceUrl(response.url());
    const now = Date.now();
    const row = [...httpTrace].reverse().filter(e => e.role === role && (!meta.phase || e.phase === meta.phase)
      && e.method === response.request().method() && e.status === response.status()
      && e.url?.origin === u.origin && e.url?.path === u.path && !e.playwrightResponseMerged
      && Math.abs(Date.parse(e.observedAt) - now) < 1500)
      .sort((a,b) => Math.abs(Date.parse(a.observedAt)-now)-Math.abs(Date.parse(b.observedAt)-now))[0];
    const task = response.text().then(text => {
      const parsed = (() => { try { return JSON.parse(text); } catch { return null; } })();
      const allowed = ["error", "message", "reason", "code", "detail", "title", "status"];
      const reason = parsed && typeof parsed === "object"
        ? Object.fromEntries(allowed.filter(key => typeof parsed[key] === "string" || typeof parsed[key] === "number").map(key => [key, safeTraceText(parsed[key])]))
        : (/^\s*</.test(text) ? { bodyOmitted: "html" } : { text: safeTraceText(text) });
      if (row) { row.reason = reason; row.playwrightResponseMerged = true; }
      else httpTrace.push({ ...meta, status: response.status(), url: u, reason, observedAt: new Date().toISOString() });
    }).catch(() => {});
    pendingTraceReads.add(task); task.finally(() => pendingTraceReads.delete(task));
  });
  page.on("console", message => {
    if (message.type() !== "error") return;
    const loc = message.location();
    consoleTrace.push({ role, phase: phaseRef.value, pagePath: new URL(page.url()).pathname, message: safeTraceText(message.text()),
      location: { url: loc.url ? sanitizeTraceUrl(loc.url) : null, lineNumber: loc.lineNumber, columnNumber: loc.columnNumber }, observedAt: new Date().toISOString() });
  });
  return cdp;
}
function listenErrors(page, phaseRef, role) {
  page.on("pageerror", error => errors.push({ phase: phaseRef.value, role, kind: "pageerror", pagePath: new URL(page.url()).pathname,
    message: safeTraceText(error.message), observedAt: new Date().toISOString() }));
  page.on("console", message => {
    if (message.type() !== "error") return;
    const location = message.location();
    errors.push({ phase: phaseRef.value, role, kind: "console", pagePath: new URL(page.url()).pathname,
      message: safeTraceText(message.text()), observedAt: new Date().toISOString(),
      location: { url: location.url ? sanitizeTraceUrl(location.url) : null, lineNumber: location.lineNumber, columnNumber: location.columnNumber } });
  });
}
async function inventory(page) {
  return page.evaluate(() => {
    const describe = el => ({ tag: el.tagName, role: el.getAttribute("role"), type: el.getAttribute("type"),
      name: el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.textContent?.trim().replace(/\s+/g, " "),
      href: el.getAttribute("href"), disabled: el.hasAttribute("disabled") });
    const exempt = el => !!el.closest("[data-appearance-control],nav[aria-label='Record actions']");
    const els = [...document.querySelectorAll("button,a,input,select,textarea,[role=combobox],[contenteditable=true]")];
    return { controls: els.filter(el => !exempt(el)).map(describe), exemptions: els.filter(exempt).map(describe) };
  });
}
async function capturePhase(phase) {
  const controls = {}, exemptions = {};
  const roleOutcomes = await Promise.allSettled(roles.map(async role => {
    const context = await browser.newContext({ viewport: { width: 1440, height }, colorScheme: "light", reducedMotion: "reduce", serviceWorkers: "block" });
    try {
      if (phase === "baseline") {
        await context.route("**/*", async route => {
          const url = new URL(route.request().url());
          if (url.origin !== fixture.url || url.pathname.startsWith("/api/")) return route.continue();
          const isHtml = route.request().resourceType() === "document" || route.request().headers().accept?.includes("text/html");
          if (!isHtml && !/\.(?:js|css|woff2?|png|svg|webp|ico|jpg|json|webmanifest)$/.test(url.pathname)) return route.continue();
          const path = isHtml ? "index.html" : decodeURIComponent(url.pathname).replace(/^\//, "");
          if (path.split("/").includes("..")) throw new Error("Unsafe baseline path");
          try {
            const bytes = await readFile(join(baselineRoot, path));
            const ext = path.split(".").pop();
            const types = { html: "text/html", js: "application/javascript", css: "text/css", svg: "image/svg+xml", png: "image/png", ico: "image/x-icon", woff2: "font/woff2", jpg: "image/jpeg", webp: "image/webp", json: "application/json", webmanifest: "application/manifest+json" };
            await route.fulfill({ status: 200, contentType: types[ext] || "application/octet-stream", body: bytes });
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
            await route.fulfill({ status: 404, contentType: "text/plain", body: `Missing retained baseline asset: ${path}` });
          }
        });
      }
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      const phaseRef = { value: `${phase}:login` }; listenErrors(page, phaseRef, role);
      await attachNetworkTrace(page, role, phaseRef);
      await fixture.login(page, role);
      for (const width of widthSet) {
        await page.setViewportSize({ width, height });
        for (const [name, path] of pages) {
          phaseRef.value = `${phase}:${name}:${width}`;
          await page.goto(fixture.url + path);
          await waitForPage(page, name);
          const result = await inventory(page), key = `${name}-${width}-${role}`;
          controls[key] = result.controls; exemptions[key] = result.exemptions;
          captureProgress.push({ phase, role, page: name, width, status: "completed", controls: result.controls.length, exemptions: result.exemptions.length });
          await writeFile(join(output, "capture-progress.json"), JSON.stringify({ completed: captureProgress.length, required: 72, visits: captureProgress }, null, 2));
        }
      }
    } finally {
      await context.close();
    }
  }));
  const failedRole = roleOutcomes.find(result => result.status === "rejected");
  if (failedRole) throw failedRole.reason;
  snapshots[phase] = { controls, exemptions };
}
async function selectOption(page, combo, option) {
  await combo.click();
  const seen = await page.getByRole("option").allTextContents();
  check(seen.some(text => text.trim() === option), `Accessible option "${option}" absent; saw ${JSON.stringify(seen)}`);
  await page.getByRole("option", { name: option, exact: true }).click();
}
async function leadsJourney(page, phaseRef) {
  phaseRef.value = "journey:leads";
  const test = async (selector, outcome, extra = {}) => journeys.push({ selector, outcome, ...extra });
  await page.setViewportSize({ width: 1440, height });
  await page.goto(fixture.url + "/leads");
  await page.getByRole("heading", { name: "Leads", exact: true }).waitFor();
  await page.locator('[data-testid="table-leads-fit"] tbody tr').first().waitFor();
  const search = page.getByPlaceholder("Search by name, email, company…", { exact: true });
  await search.fill("Synthetic Contact");
  const leadRows = page.locator('[data-testid="table-leads-fit"] tbody tr');
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll('[data-testid="table-leads-fit"] tbody tr')];
    return rows.length === 1 && rows[0].textContent.includes("Synthetic Contact");
  });
  check(await leadRows.count() === 1, "Search Synthetic Contact did not narrow to one lead");
  await test('getByPlaceholder("Search by name, email, company…")', "Synthetic Contact -> 1 matching row");
  await search.fill("Fixture Services LLC");
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll('[data-testid="table-leads-fit"] tbody tr')];
    return rows.length === 1 && rows[0].textContent.includes("Fixture Services LLC");
  });
  check(await leadRows.count() === 1, "Company search did not narrow to one lead");
  await test('getByPlaceholder("Search by name, email, company…")', "Fixture Services LLC -> Sample Applicant only");
  await search.fill("");
  const combos = page.getByRole("combobox");
  await selectOption(page, combos.nth(0), "Contacted");
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="table-leads-fit"] tbody tr').length === 1);
  check(await page.locator('[data-testid="table-leads-fit"] tbody tr').count() === 1, "Contacted filter did not return one lead");
  await test('getByRole("combobox").nth(0)', "Status Contacted -> Synthetic Contact only");
  await selectOption(page, combos.nth(0), "All Statuses");
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="table-leads-fit"] tbody tr').length === 2);
  await selectOption(page, page.getByRole("combobox").nth(1), "Equipment");
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="table-leads-fit"] tbody tr').length === 1);
  check(await page.locator('[data-testid="table-leads-fit"] tbody tr').count() === 1, "Equipment type filter did not return one lead");
  await test('getByRole("combobox").nth(1)', "Type Equipment -> matching lead retained");
  await selectOption(page, page.getByRole("combobox").nth(1), "All Types");
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="table-leads-fit"] tbody tr').length === 2);
  const rep = page.getByRole("button", { name: "Filter by representative" });
  await rep.click();
  const repOptions = await page.getByRole("option").allTextContents();
  check(repOptions.some(text => text.includes("Visual Fixture")), `Fixture rep option absent: ${JSON.stringify(repOptions)}`);
  await page.getByRole("option", { name: /Visual Fixture/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="table-leads-fit"] tbody tr').length === 2);
  check(await page.locator('[data-testid="table-leads-fit"] tbody tr').count() === 2, "Rep filter did not return the two assigned synthetic leads");
  await test('getByRole("button", {name:"Filter by representative"})', "Visual Fixture -> two assigned synthetic leads");
  const sortRequests = [];
  page.on("request", request => { if (/\/api\/leads(?:\?|$)/.test(request.url())) sortRequests.push(request.url()); });
  const oldestRequestPromise = page.waitForRequest(request => {
    try { return new URL(request.url()).searchParams.get("sortOrder") === "asc"; } catch { return false; }
  });
  await selectOption(page, page.getByRole("combobox").last(), "Oldest First");
  const oldestRequest = await oldestRequestPromise;
  await page.getByRole("combobox").last().getByText("Oldest First").waitFor();
  const sortedRequest = oldestRequest.url();
  check(!!sortedRequest, `Oldest First did not request sortOrder=asc: ${JSON.stringify(sortRequests)}`);
  await test('getByRole("combobox").last()', "Oldest First selected; API request sortOrder=asc", { request: sortedRequest });
  await page.goto(fixture.url + "/leads");
  await page.getByRole("heading", { name: "Leads", exact: true }).waitFor();
  const table = page.locator('[data-testid="table-leads-fit"]');
  const row = table.locator("tbody tr").filter({ hasText: "Synthetic Contact" });
  const blankRowPoint = await row.evaluate(tr => {
    for (const td of tr.cells) {
      const r = td.getBoundingClientRect();
      const points = [[r.left+3,r.top+3],[r.right-3,r.top+3],[r.left+3,r.bottom-3],[r.right-3,r.bottom-3]];
      for (const [x,y] of points) {
        const target = document.elementFromPoint(x,y);
        if (target === td) return { x, y };
      }
    }
    return null;
  });
  check(blankRowPoint, "Could not identify a true blank, non-interactive area of the lead row");
  const leadsBeforeBlankClick = page.url();
  const unexpectedRowNavigation = page.waitForURL(/\/leads\/1(?:\?.*)?$/, { timeout: 1200 }).then(() => true).catch(() => false);
  await page.mouse.click(blankRowPoint.x, blankRowPoint.y);
  check(!(await unexpectedRowNavigation) && page.url() === leadsBeforeBlankClick, "Blank row background unexpectedly navigated");
  await test("blank non-interactive lead-row background", "remained on /leads; row-background navigation is not expected and is not restored", { point: blankRowPoint });
  const phone = row.locator('a[href^="tel:"]');
  const phoneHref = await phone.getAttribute("href");
  await page.evaluate(() => {
    window.__telClicks = [];
    document.addEventListener("click", event => {
      const link = event.target.closest?.('a[href^="tel:"]');
      if (link) { event.preventDefault(); window.__telClicks.push(link.href); }
    }, true);
  });
  const beforePhone = page.url();
  await phone.click();
  check(page.url() === beforePhone, "Phone action navigated away from Leads");
  check((await page.evaluate(() => window.__telClicks)).length === 1, "Phone click was not intercepted before dialing");
  await test('table row a[href^="tel:"]', "phone href captured; default prevented; URL stayed /leads", { href: phoneHref });
  const email = row.locator('[data-contact-link="email"]');
  const emailHref = await email.getAttribute("href");
  await email.click();
  await page.waitForURL(/\/leads\/1(?:\?.*)?$/);
  const comms = page.getByRole("tab", { name: /^Comms/ });
  await comms.waitFor();
  check(await comms.getAttribute("data-state") === "active", "Email link did not activate lead Comms");
  await test('table row [data-contact-link="email"]', "opened /leads/1 and activated Comms tab", { href: emailHref, url: page.url() });
  const phoneDetail = page.locator('a[href^="tel:"]');
  check(await phoneDetail.count() >= 1, "Lead detail phone action missing");
  const beforeDetailPhone = page.url();
  await phoneDetail.first().click();
  check(page.url() === beforeDetailPhone, "Lead detail phone action navigated away");
  await test('lead detail a[href^="tel:"]', "default prevented; remained on lead detail");
  await page.goto(fixture.url + "/leads");
  await page.getByRole("link", { name: /Synthetic Contact/ }).first().click();
  await page.waitForURL(/\/leads\/1(?:\?.*)?$/);
  await waitForPage(page, "lead-detail");
  const detailHeading = await page.locator("h1").first().innerText();
  check(new URL(page.url()).pathname === "/leads/1" && /Fixture Equipment LLC|Synthetic Contact/.test(detailHeading), "Lead row/name link did not navigate to expected detail");
  await test('getByRole("link", {name:/Synthetic Contact/})', "navigated to /leads/1 detail", { heading: detailHeading, url: page.url() });
  await page.goto(fixture.url + "/leads");
  await page.getByRole("heading", { name: "Leads", exact: true }).waitFor();
  const companyRow = page.locator('[data-testid="table-leads-fit"] tbody tr').filter({ hasText: "Synthetic Contact" });
  const companyDetailLink = companyRow.getByRole("link").nth(1);
  const companyHref = await companyDetailLink.getAttribute("href");
  check(companyHref === "/leads/1", `Second lead-row link did not target the same lead detail: ${companyHref}`);
  await companyDetailLink.click();
  await page.waitForURL(/\/leads\/1(?:\?.*)?$/);
  await waitForPage(page, "lead-detail");
  check(new URL(page.url()).pathname === "/leads/1", "Company row link did not navigate to expected detail");
  await test('second row link (company)', "navigated to /leads/1 detail", { href: companyHref, url: page.url() });
  const screenshots = [];
  for (const theme of ["light", "dark"]) {
    if (theme === "dark") {
      await page.setViewportSize({ width: 390, height });
      await page.goto(fixture.url + "/settings");
      await waitForPage(page, "settings");
      await page.getByLabel("Appearance theme").selectOption("dark");
    }
    for (const width of [390, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height });
      await page.goto(fixture.url + "/leads");
      await page.getByRole("heading", { name: "Leads", exact: true }).waitFor();
      await waitForPage(page, "leads");
      if (theme === "dark") check(await page.locator("html").getAttribute("data-appearance") === "dark", "Dark theme did not persist");
      const geometry = await page.evaluate(() => {
        const r = el => el?.getBoundingClientRect().toJSON();
        const table = document.querySelector('[data-testid="table-leads-fit"] table');
        const region = document.querySelector(".leads-fit-region");
        return { viewport: { width: innerWidth, height: innerHeight }, document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
          table: table && { rect: r(table), clientWidth: table.clientWidth, scrollWidth: table.scrollWidth },
          fitRegion: region && { rect: r(region), clientWidth: region.clientWidth, scrollWidth: region.scrollWidth, clientHeight: region.clientHeight, scrollHeight: region.scrollHeight },
          rows: [...(table?.querySelectorAll("tbody tr") ?? [])].map(row => r(row)), contactLinks: [...document.querySelectorAll('[data-contact-link],a[href^="tel:"]')].map(el => ({ href: el.getAttribute("href"), rect: r(el) })) };
      });
      const name = `leads-${width}-${theme}.png`, file = join(output, name);
      await page.screenshot({ path: file });
      screenshots.push(name); screenshotPaths.push(file);
      journeys.push({ selector: "authenticated Leads initial view", outcome: `${width}x${height} ${theme}`, geometry });
    }
  }
  check(screenshots.length === 8, `Expected eight Leads screenshots; got ${screenshots.length}`);
}

async function restoreHistoricalCampaign(fixture) {
  const sourcePath = join(root, ".local/certification-853f4e4/historical-campaign.json");
  const sourceBytes = await readFile(sourcePath);
  const historical = JSON.parse(sourceBytes);
  check(historical.campaign?.id === 5 && historical.campaign?.status === "completed", "Unexpected historical campaign fixture");
  check(historical.launches?.length === 1 && historical.recipients?.length === 13 && historical.sends?.length === 13, "Historical fixture row counts changed");
  const dbName = fixture.query("SELECT current_database()");
  check(/^visual_refresh_fixture_\d+_\d+$/.test(dbName), `Refusing campaign fixture writes to unrecognized database ${dbName}`);
  const dbUrl = new URL(process.env.DATABASE_URL); dbUrl.pathname = `/${dbName}`;
  check(dbUrl.pathname.slice(1) === dbName && /^visual_refresh_fixture_/.test(dbName), "Fixture-only database guard failed");
  const q = value => `'${String(value).replaceAll("'", "''")}'`;
  const ts = value => value == null ? "NULL" : `${q(value.replace("T", " "))}::timestamp`;
  const tz = value => value == null ? "NULL" : `${q(value)}::timestamptz`;
  const leadsBySource = new Map();
  [...new Set(historical.recipients.map(row => row.lead_id))].forEach((sourceId, index) => leadsBySource.set(sourceId, index + 3));
  const sql = [];
  for (const [sourceLeadId, id] of leadsBySource) {
    const n = id - 2;
    sql.push(`INSERT INTO leads(id,first_name,last_name,email,phone,company_name,application_type,status,assigned_rep_id,lead_source,created_at,updated_at)
      VALUES (${id},'Historical','Fixture Recipient ${String(n).padStart(2,"0")}',${q(`historical-recipient-${String(n).padStart(2,"0")}@example.invalid`)},
      '+1202555${String(100+n).slice(-4)}',${q(`Synthetic Campaign Recipient ${String(n).padStart(2,"0")}`)},'equipment','contacted',3,'manual',now(),now());`);
  }
  const c = historical.campaign;
  sql.push(`INSERT INTO campaigns(id,name,channel,status,email_template_id,audience_rules,scheduled_at,launched_at,completed_at,owner_id,created_by,version,created_at,updated_at,tracking_since,reply_to_email,flyer_delivery_mode)
    VALUES (5,${q(c.name)},${q(c.channel)},${q(c.status)},1,'{}'::jsonb,${tz(c.scheduled_at)},${tz(c.launched_at)},${tz(c.completed_at)},1,1,${c.version},${tz(c.created_at)},${tz(c.updated_at)},NULL,'fixture-replies@example.invalid',${q(c.flyer_delivery_mode)});`);
  const launch = historical.launches[0];
  sql.push(`INSERT INTO campaign_launches(id,campaign_id,idempotency_key,requested_by,mode,status,eligible_count,excluded_count,sent_count,failed_count,scheduled_at,started_at,completed_at,created_at)
    VALUES (5,5,'historical-fixture-launch-5',1,${q(launch.mode)},${q(launch.status)},${launch.eligible_count},${launch.excluded_count},${launch.sent_count},${launch.failed_count},${tz(launch.scheduled_at)},${tz(launch.started_at)},${tz(launch.completed_at)},${tz(launch.created_at)});`);
  for (const send of historical.sends) {
    const n = leadsBySource.get(send.lead_id);
    const ordinal = String(n - 2).padStart(2, "0");
    sql.push(`INSERT INTO email_sends(id,lead_id,user_id,template_id,subject,to_email,from_email,status,sendgrid_message_id,sent_at,opened_at,clicked_at,created_at,updated_at,campaign_id,campaign_launch_id,delivery_kind)
      VALUES (${send.id},${n},1,1,${q("Vendors — Heavy Equipment (synthetic historical fixture)")},${q(`historical-recipient-${ordinal}@example.invalid`)},'fixture-sender@example.invalid',
      ${q(send.status)},NULL,${ts(send.sent_at)},${ts(send.opened_at)},${ts(send.clicked_at)},${ts(send.created_at)},${ts(send.updated_at)},5,5,${q(send.delivery_kind)});`);
  }
  for (const recipient of historical.recipients) {
    sql.push(`INSERT INTO campaign_recipients(id,launch_id,campaign_id,lead_id,channel,status,exclusion_reason,available_at,email_send_id,sent_at,created_at)
      VALUES (${recipient.id},5,5,${leadsBySource.get(recipient.lead_id)},${q(recipient.channel)},${q(recipient.status)},${recipient.exclusion_reason == null ? "NULL" : q(recipient.exclusion_reason)},
      ${tz(recipient.available_at)},${recipient.email_send_id},NULL,${tz(recipient.created_at)});`);
  }
  for (const [table, seqValue] of [["leads", 15], ["campaigns", 5], ["campaign_launches", 5], ["campaign_recipients", 26], ["email_sends", 45]]) {
    sql.push(`SELECT setval(pg_get_serial_sequence('${table}','id'),${seqValue},true);`);
  }
  // Explicit fixture-only URL guard above; never use fixture.query for writes, and never connect to a customer database.
  const inserted = spawnSync("psql", [`--dbname=${dbUrl}`, "--no-psqlrc", "--set=ON_ERROR_STOP=on", "--single-transaction", "--command", sql.join("\n")], { encoding: "utf8" });
  check(inserted.status === 0, `Historical rows failed to insert into isolated fixture: ${inserted.stderr?.slice(-1200)}`);
  const preserved = fixture.query("SELECT c.id, c.name, c.status, c.tracking_since IS NULL AS no_historical_tracking_provenance, l.id AS launch_id, l.sent_count, (SELECT count(*) FROM campaign_recipients r WHERE r.campaign_id=c.id AND r.status='sent') AS recipient_sent, (SELECT count(*) FROM email_sends e WHERE e.campaign_id=c.id AND e.status IN ('delivered','opened','clicked')) AS actual_email_sends, (SELECT count(*) FROM campaign_recipients r WHERE r.campaign_id=c.id AND r.sent_at IS NULL) AS recipient_sent_at_null, (SELECT count(*) FROM email_sends e WHERE e.campaign_id=c.id AND e.sent_at IS NOT NULL) AS email_sent_at_retained FROM campaigns c JOIN campaign_launches l ON l.campaign_id=c.id WHERE c.id=5");
  const leadMap = [...leadsBySource.values()].map((fixtureLeadId, index) => ({ sourceReference: `production-lead-${index + 1}`, fixtureLeadId, syntheticIdentity: `Historical Fixture Recipient ${String(index + 1).padStart(2,"0")}`, syntheticEmail: `historical-recipient-${String(index + 1).padStart(2,"0")}@example.invalid` }));
  const anonymized = { provenance: { source: ".local/certification-853f4e4/historical-campaign.json", sourceSha256: createHash("sha256").update(sourceBytes).digest("hex"), dataClass: "production READ-ONLY historical snapshot; no contact details supplied", campaignId: 5, copiedAt: new Date().toISOString() },
    campaign: { id: 5, name: c.name, status: c.status, channel: c.channel, version: c.version, tracking_since: null, launch_id: 5, owner_fixture_user_id: 1, created_by_fixture_user_id: 1, email_template_fixture_id: 1 },
    launch: { id: 5, mode: launch.mode, status: launch.status, eligible_count: launch.eligible_count, sent_count: launch.sent_count, failed_count: launch.failed_count, excluded_count: launch.excluded_count, requested_by_fixture_user_id: 1, created_at: launch.created_at, started_at: launch.started_at, completed_at: launch.completed_at },
    recipientRows: historical.recipients.map(row => ({ id: row.id, status: row.status, channel: row.channel, sourceReference: `production-lead-${[...leadsBySource.keys()].indexOf(row.lead_id)+1}`, fixtureLeadId: leadsBySource.get(row.lead_id), launch_id: row.launch_id, campaign_id: row.campaign_id, email_send_id: row.email_send_id, sent_at: null, created_at: row.created_at })),
    emailSends: historical.sends.map(row => ({ id: row.id, status: row.status, sourceReference: `production-lead-${[...leadsBySource.keys()].indexOf(row.lead_id)+1}`, fixtureLeadId: leadsBySource.get(row.lead_id), sent_at: row.sent_at, opened_at: row.opened_at, clicked_at: row.clicked_at, created_at: row.created_at, updated_at: row.updated_at, campaign_id: row.campaign_id, campaign_launch_id: row.campaign_launch_id, delivery_kind: row.delivery_kind, synthetic_to_email: `historical-recipient-${String(leadsBySource.get(row.lead_id)-2).padStart(2,"0")}@example.invalid`, synthetic_from_email: "fixture-sender@example.invalid", synthetic_subject: "Vendors — Heavy Equipment (synthetic historical fixture)" })),
    syntheticLeads: leadMap, fixtureVerification: preserved };
  await writeFile(join(output, "historical-campaign-anonymized.json"), JSON.stringify(anonymized, null, 2));
  await writeFile(join(output, "historical-campaign-source-provenance.json"), JSON.stringify({ sourceFile: anonymized.provenance.source, sourceSha256: anonymized.provenance.sourceSha256, productionDatabaseAccess: "READ-ONLY source snapshot only; inserts executed only against guarded visual_refresh_fixture_* disposable clone", pii: "source snapshot contains no customer contact details; fixture names/emails substituted", rowCounts: { sends: historical.sends.length, recipients: historical.recipients.length, launches: historical.launches.length }, fixtureCurrentDatabase: dbName, insertedCampaign: 5 }, null, 2));
  return { historical, anonymized, preserved };
}

async function campaignJourney(page, fixture, phaseRef) {
  phaseRef.value = "journey:campaign-results";
  const { historical, anonymized, preserved } = await restoreHistoricalCampaign(fixture);
  const errorStart = errors.length;
  const resultsPromise = page.waitForResponse(response => response.url().includes("/api/campaigns/5/results"));
  const metricsPromise = page.waitForResponse(response => response.url().includes("/api/campaigns/5/metrics"));
  await page.goto(fixture.url + "/campaigns/5");
  await page.getByText("Vendors — Heavy Equipment", { exact: true }).first().waitFor();
  const resultsTab = page.getByRole("tab", { name: "Results", exact: true });
  await resultsTab.click();
  const [resultsResponse, metricsResponse] = await Promise.all([resultsPromise, metricsPromise]);
  check(resultsResponse.status() === 200 && metricsResponse.status() === 200, `Campaign Results API status not 200: ${resultsResponse.status()}/${metricsResponse.status()}`);
  const results = await resultsResponse.json(), metrics = await metricsResponse.json();
  check(results.counts.sent === 13 && results.launches.length === 1, `Legacy API counts incorrect: ${JSON.stringify(results.counts)}`);
  check(metrics.sent === 13 && metrics.trackingSince == null, `KPI API historical sent/tracking mismatch: ${JSON.stringify({ sent: metrics.sent, trackingSince: metrics.trackingSince })}`);
  await page.getByText("Campaign Results", { exact: true }).waitFor();
  const legacySent = page.getByText("Sent", { exact: true }).first().locator("..");
  check((await legacySent.innerText()).includes("13"), `Legacy Results Sent KPI not 13: ${await legacySent.innerText()}`);
  const sentKpi = page.getByTestId("kpi-sent");
  await sentKpi.waitFor();
  check((await sentKpi.innerText()).includes("13"), `New KPI Sent not 13: ${await sentKpi.innerText()}`);
  check((await page.getByTestId("panel-campaign-kpis").innerText()).includes("Historical tracking not available"), "KPI panel did not disclose absent historical tracking");
  check((await page.getByTestId("kpi-uniqueClicks").innerText()).includes("Not tracked"), "Unknown unique click metric was not shown as Not tracked");
  check((await page.getByTestId("kpi-replies").innerText()).includes("Not tracked"), "Unknown replies metric was not shown as Not tracked");
  const campaignScreenshot = join(output, "campaign-5-results.png");
  await page.screenshot({ path: campaignScreenshot, fullPage: true });
  const campaignEvidence = { url: page.url(), title: "Vendors — Heavy Equipment", status: "completed",
    resultsApi: { status: resultsResponse.status(), counts: results.counts, launches: results.launches.length },
    metricsApi: { status: metricsResponse.status(), sent: metrics.sent, trackingSince: metrics.trackingSince, uniqueFlyerClicks: metrics.uniqueFlyerClicks, replies: metrics.replies, fundedDollars: metrics.fundedDollars },
    legacyResultsSent: await legacySent.innerText(), kpiSent: await sentKpi.innerText(),
    untrackedText: ["Historical tracking not available", "Not tracked"], screenshot: "reports/opt-in-recertification/final-cert-run/campaign-5-results.png",
    fixtureVerification: preserved, historicalRows: { sends: historical.sends.length, recipients: historical.recipients.length, launches: historical.launches.length },
    runtimeErrors: errors.slice(errorStart), noLaunchAction: true, noDeliveryAction: true, disclaimer: "Candidate-code behavior rendered from anonymized historical production records in isolated fixture; not a newly published production page." };
  check(!campaignEvidence.runtimeErrors.some(error => error.kind === "pageerror"), `Campaign Results runtime exception: ${JSON.stringify(campaignEvidence.runtimeErrors)}`);
  journeys.push({ selector: 'page.goto("/campaigns/5") then getByRole("tab",{name:"Results"})', outcome: "campaign completed; legacy Results Sent 13; new KPI Sent 13; unknown historical metrics disclosed as Not tracked", campaign: campaignEvidence });
  await writeFile(join(output, "campaign-results-verification.json"), JSON.stringify(campaignEvidence, null, 2));
}

try {
  check(webRoot.startsWith(root) && await readFile(join(webRoot, "index.html")), "Immutable web build missing");
  check(/^[0-9a-f]{40}$/.test(targetRevision) && /^[0-9a-f]{40}$/.test(localSnapshot), "Supply exact CERT_TARGET_REVISION and CERT_LOCAL_SNAPSHOT pins before the final run");
  check(/^[0-9a-f]{64}$/.test(expectedIndexSha256) && /^[0-9a-f]{64}$/.test(expectedApiDistSha256),
    "Supply exact CERT_BUILD_INDEX_SHA256 and CERT_API_DIST_SHA256 pins before the final run");
  const frozenIndex = await readFile(join(webRoot, "index.html"));
  const actualIndexSha256 = createHash("sha256").update(frozenIndex).digest("hex");
  check(actualIndexSha256 === expectedIndexSha256, `Frozen candidate index hash mismatch: expected ${expectedIndexSha256}, observed ${actualIndexSha256}`);
  const actualApiDistSha256 = await hashTree(apiDistRoot);
  check(actualApiDistSha256 === expectedApiDistSha256, `Frozen API dist hash mismatch: expected ${expectedApiDistSha256}, observed ${actualApiDistSha256}`);
  sourceProof = await verifyExpectedFixtureSources();
  await mkdir(output, { recursive: true });
  fixture = await startSandbox({ build: false, webRoot, port: 4320 });
  const dbName = fixture.query("SELECT current_database()");
  fixtureDbName = dbName;
  const dbUrl = new URL(process.env.DATABASE_URL); dbUrl.pathname = `/${dbName}`;
  const aligned = spawnSync("psql", [`--dbname=${dbUrl}`, "--no-psqlrc", "--set=ON_ERROR_STOP=on", "--command",
    "UPDATE leads SET created_at = now() - interval '18.6 days', last_activity_at = now() - interval '18.6 days' WHERE id IN (1,2);"], { encoding: "utf8" });
  check(aligned.status === 0, "Could not align disposable fixture activity timestamps");
  const ageEvidence = fixture.query("SELECT id, to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') AS created_utc, to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') AS updated_utc, to_char(last_activity_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') AS activity_utc, floor(extract(epoch FROM (now()-created_at))/86400)::int AS idle_days FROM leads ORDER BY id");
  await writeFile(join(output, "fixture-age-alignment.txt"), `${ageEvidence}\n`);
  const baselineIndex = await readFile(join(baselineRoot, "index.html"));
  await capturePhase("baseline");
  await capturePhase("target");
  const certified = JSON.parse(await readFile(join(root, "reports/structural-certification-2026-10-03/after/role-controls.json")));
  const certifiedExempt = JSON.parse(await readFile(join(root, "reports/structural-certification-2026-10-03/after/exempt-controls.json")));
  const additionAudit = [], removalAudit = [];
  const comparisons = Object.keys(snapshots.baseline.controls).map(key => {
    const targetRaw = snapshots.target.controls[key] ?? [];
    const targetPolicy = stripApprovedAdditions(key, targetRaw);
    const baselineRemoval = stripApprovedRetryFromReference(key, snapshots.baseline.controls[key] ?? []);
    const archivedRemoval = stripApprovedRetryFromReference(key, certified[key] ?? []);
    const additionExpected = approvedAdditionCaseSet.has(key) ? 2 : 0;
    const additionRow = { key, expectedCount: additionExpected, actualCount: targetPolicy.actualCount,
      observed: targetPolicy.observed, pass: targetPolicy.pass };
    additionAudit.push(additionRow);
    const isRemovalCase = approvedRetryRemovalCaseSet.has(key);
    const candidateRetryCount = exactCount(targetRaw, expectedRetryRemoval.control);
    const removalRow = isRemovalCase ? {
      key, expectedBaselineCount: 1, actualBaselineCount: baselineRemoval.count,
      expectedArchivedCount: 1, actualArchivedCount: archivedRemoval.count,
      expectedCandidateCount: 0, actualCandidateCount: candidateRetryCount,
      pass: baselineRemoval.count === 1 && archivedRemoval.count === 1 && candidateRetryCount === 0,
    } : null;
    if (removalRow) removalAudit.push(removalRow);
    return {
      key,
      controlsEqual: JSON.stringify(baselineRemoval.controls) === JSON.stringify(targetPolicy.controls),
      exemptionsEqual: JSON.stringify(snapshots.baseline.exemptions[key]) === JSON.stringify(snapshots.target.exemptions[key]),
      certifiedInventoryEqual: JSON.stringify(archivedRemoval.controls) === JSON.stringify(targetPolicy.controls),
      certifiedExemptionsEqual: JSON.stringify(certifiedExempt[key]) === JSON.stringify(snapshots.target.exemptions[key]),
      approvedAdditionPass: targetPolicy.pass,
      approvedRemovalPass: removalRow ? removalRow.pass : true,
      approvedAdditionCount: targetPolicy.actualCount,
      approvedRetryRemoval: removalRow,
    };
  });
  check(additionAudit.length === 36, `Expected 36 addition-audit rows, got ${additionAudit.length}`);
  check(removalAudit.length === 4, `Expected exactly four approved retry-removal cases, got ${removalAudit.length}`);
  const additionsPolicyPass = approvalManifest.additions.cases.every(key => additionAudit.find(row => row.key === key)?.expectedCount === 2)
    && additionAudit.every(row => row.pass);
  const removalsPolicyPass = removalAudit.length === 4 && removalAudit.every(row => row.pass);
  await writeFile(join(output, "approved-exceptions.json"), JSON.stringify({
    manifest: approvalManifest,
    additions: { expectedTotal: approvalManifest.additions.expectedTotal,
      actualTotal: additionAudit.reduce((sum, row) => sum + row.actualCount, 0), rows: additionAudit },
    removals: { expectedBaselineTotal: expectedRetryRemoval.expectedBaselineTotal,
      actualBaselineTotal: removalAudit.reduce((sum, row) => sum + row.actualBaselineCount, 0),
      expectedArchivedTotal: expectedRetryRemoval.expectedArchivedTotal,
      actualArchivedTotal: removalAudit.reduce((sum, row) => sum + row.actualArchivedCount, 0),
      expectedCandidateTotal: expectedRetryRemoval.expectedCandidateTotal,
      actualCandidateTotal: removalAudit.reduce((sum, row) => sum + row.actualCandidateCount, 0), rows: removalAudit },
    baselineExemptionsUnchanged: "separately compared for every role/page/width; never widened",
  }, null, 2));
  const structureDifferences = comparisons.filter(row => !row.controlsEqual || !row.exemptionsEqual || !row.certifiedInventoryEqual || !row.certifiedExemptionsEqual).map(row => {
    const key = row.key, rawTarget = snapshots.target.controls[key] ?? [];
    const target = stripApprovedAdditions(key, rawTarget).controls;
    const baseline = stripApprovedRetryFromReference(key, snapshots.baseline.controls[key] ?? []).controls;
    const archived = stripApprovedRetryFromReference(key, certified[key] ?? []).controls;
    let first = 0;
    while (first < Math.max(target.length, archived.length) && JSON.stringify(target[first]) === JSON.stringify(archived[first])) first++;
    return { key, flags: row, firstCertifiedControlDifference: first, rawTargetCount: rawTarget.length, normalizedTargetCount: target.length, certifiedCount: archived.length,
      targetAtDifference: target[first] ?? null, certifiedAtDifference: archived[first] ?? null, rawTargetControls: rawTarget,
      normalizedBaselineControls: baseline, normalizedTargetControls: target, certifiedControls: archived,
      targetExemptions: snapshots.target.exemptions[key] ?? [], certifiedExemptions: certifiedExempt[key] ?? [] };
  });
  await writeFile(join(output, "structure-differences.json"), JSON.stringify(structureDifferences, null, 2));
  const result = { target: targetRevision, localSnapshot,
    baselineRevision: "2af927ca2830926bf325cef2eecfffc24ab5c110",
    baselineIndexSha256: createHash("sha256").update(baselineIndex).digest("hex"),
    candidateIndexSha256: actualIndexSha256, candidateApiDistSha256: actualApiDistSha256, candidateApiDistRoot: "artifacts/api-server/dist",
    baselineRoot: ".local/certification-2af927c/baselines/target-2af927c", strictRequired: 36, comparisons,
    approvedStructureDeltaPolicy: {
      additions: { exactControls: expectedAdditionControls, cases: approvalManifest.additions.cases,
        expectedPerCase: 2, expectedTotal: approvalManifest.additions.expectedTotal,
        actualTotal: additionAudit.reduce((sum, row) => sum + row.actualCount, 0) },
      removals: { exactControl: expectedRetryRemoval.control, cases: expectedRetryRemoval.cases,
        expectedBaselineTotal: expectedRetryRemoval.expectedBaselineTotal,
        expectedArchivedTotal: expectedRetryRemoval.expectedArchivedTotal,
        expectedCandidateTotal: expectedRetryRemoval.expectedCandidateTotal },
    },
    structurePass: comparisons.length === 36 && additionsPolicyPass && removalsPolicyPass
      && comparisons.every(row => row.controlsEqual && row.exemptionsEqual && row.certifiedInventoryEqual && row.certifiedExemptionsEqual && row.approvedAdditionPass && row.approvedRemovalPass),
    widths: [390, 768, 1280, 1440], height, screenshots: screenshotPaths.map(file => file.slice(root.length + 1)),
    fixtureAgeEvidence: ageEvidence, journeys, errors, sourceProof, authentication: "real development Clerk tickets; fixture.login; admin/manager/rep fixture claims",
    database: "isolated schema-only clone; synthetic contacts; delivery credentials removed; background jobs disabled; no live delivery"};
  await writeFile(join(output, "leads-certification.json"), JSON.stringify(result, null, 2));
  await writeFile(join(output, "structure-controls.json"), JSON.stringify(snapshots, null, 2));
  const journeyContext = await browser.newContext({ viewport: { width: 1440, height }, colorScheme: "light", reducedMotion: "reduce", serviceWorkers: "block" });
  const journeyPhase = { value: "journey:login" };
  const journeyPage = await journeyContext.newPage(); journeyPage.setDefaultTimeout(15000); listenErrors(journeyPage, journeyPhase, "admin");
  await attachNetworkTrace(journeyPage, "admin", journeyPhase);
  await fixture.login(journeyPage, "admin");
  await leadsJourney(journeyPage, journeyPhase);
  await campaignJourney(journeyPage, fixture, journeyPhase);
  await journeyContext.close();
  await Promise.allSettled([...pendingTraceReads]);
  const httpClassification = classifyHttpResponses(sourceProof);
  const consoleClassification = classifyConsoleErrors(httpClassification);
  const candidateRepUserListRequests = repUserListRequests.filter(row => isCandidatePhase(row.phase));
  const incompleteHttpDetails = httpClassification.filter(row => !row.detailComplete);
  const unexpectedCandidateResponses = httpClassification.filter(row => row.candidateResponse && row.classification.startsWith("defect:"));
  const candidatePageErrors = errors.filter(row => row.kind === "pageerror" && isCandidatePhase(row.phase));
  const candidateServiceWorkerErrors = consoleClassification.filter(row => row.candidateError && row.serviceWorkerException);
  const unexpectedCandidateConsoleErrors = consoleClassification.filter(row => row.candidateError && row.classification.startsWith("defect:"));
  const runtimeAssertions = {
    everyHttpErrorHasRequestPageRoleAndReasonOrExplicitAmbiguity: incompleteHttpDetails.length === 0,
    candidateRepGetUsersRequestsZero: candidateRepUserListRequests.length === 0,
    expectedHttpStatusesOnly: unexpectedCandidateResponses.length === 0,
    candidateServiceWorkerRegistrationConsoleErrorsZero: candidateServiceWorkerErrors.length === 0,
    candidatePageExceptionsZero: candidatePageErrors.length === 0,
    noOtherCandidateConsoleErrors: unexpectedCandidateConsoleErrors.length === 0,
  };
  const runtimeAudit = {
    sourceProof, assertions: runtimeAssertions,
    incompleteHttpDetails, candidateRepUserListRequests, allRepUserListRequests: repUserListRequests,
    unexpectedCandidateResponses, candidatePageErrors, candidateServiceWorkerErrors,
    unexpectedCandidateConsoleErrors, httpResponses: httpClassification, consoleEvents: consoleClassification,
  };
  result.journeys = journeys;
  result.errors = errors;
  result.screenshots = screenshotPaths.map(file => file.slice(root.length + 1));
  result.runtimeAssertions = runtimeAssertions;
  await writeFile(join(output, "leads-certification.json"), JSON.stringify(result, null, 2));
  await writeFile(join(output, "journeys.json"), JSON.stringify(journeys, null, 2));
  await writeFile(join(output, "console-errors.json"), JSON.stringify(errors, null, 2));
  await writeFile(join(output, "http-response-errors.json"), JSON.stringify(httpClassification, null, 2));
  await writeFile(join(output, "console-response-correlations.json"), JSON.stringify(consoleClassification, null, 2));
  await writeFile(join(output, "runtime-error-classification.json"), JSON.stringify(runtimeAudit, null, 2));
  check(result.structurePass, "STRICT STRUCTURE comparison mismatch; Leads and campaign exercises completed; see structure-differences.json");
  check(incompleteHttpDetails.length === 0, `HTTP error response missing request/page/role/reason-or-ambiguity details`);
  check(candidateRepUserListRequests.length === 0, `Rep GET /api/users requests remain in candidate: ${JSON.stringify(candidateRepUserListRequests)}`);
  check(unexpectedCandidateResponses.length === 0, `Unexpected candidate HTTP error responses: ${JSON.stringify(unexpectedCandidateResponses)}`);
  check(candidateServiceWorkerErrors.length === 0, `Candidate service-worker registration console errors: ${JSON.stringify(candidateServiceWorkerErrors)}`);
  check(candidatePageErrors.length === 0, `Candidate page exceptions: ${JSON.stringify(candidatePageErrors)}`);
  check(unexpectedCandidateConsoleErrors.length === 0, `Unexpected candidate console errors: ${JSON.stringify(unexpectedCandidateConsoleErrors)}`);
  console.log(JSON.stringify({ structure: "PASS 36/36", screenshots: screenshotPaths, journeys: journeys.length, runtimeAssertions }, null, 2));
} catch (error) {
  await writeFile(join(output, "corrected-run-failure.txt"), `${error?.stack ?? String(error)}\n`);
  await writeFile(join(output, "console-errors.json"), JSON.stringify(errors, null, 2));
  if (snapshots.baseline && snapshots.target) await writeFile(join(output, "structure-controls.json"), JSON.stringify(snapshots, null, 2));
  throw error;
} finally {
  await browser.close();
  try { await fixture?.close(); } catch (error) { await writeFile(join(output, "cleanup-warning.txt"), `${error?.stack ?? String(error)}\n`); }
  for (const userId of createdClerkUsers) {
    try { await clerkClient.users.deleteUser(userId); }
    catch (error) { await writeFile(join(output, "cleanup-warning.txt"), `${error?.stack ?? String(error)}\n`, { flag: "a" }); }
  }
  if (fixtureDbName && /^visual_refresh_fixture_\d+_\d+$/.test(fixtureDbName)) {
    const drop = spawnSync("dropdb", ["--if-exists", "--force", `--maintenance-db=${process.env.DATABASE_URL}`, fixtureDbName], { encoding: "utf8" });
    if (drop.status !== 0) await writeFile(join(output, "cleanup-warning.txt"), `${drop.stderr}\n`, { flag: "a" });
  }
}
