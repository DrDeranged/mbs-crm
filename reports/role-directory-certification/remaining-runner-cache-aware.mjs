// Deterministic derivative loader for the pinned remaining runner. It keeps
// both frozen runners unchanged and applies only cache-aware test-harness edits.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const reportRoot = join(root, "reports/role-directory-certification");
const authPath = join(reportRoot, "launch-authorization.json");
const baseRunnerPath = join(reportRoot, "remaining-runner.mjs");
const sandboxPath = join(root, "scripts/visual-refresh/sandbox.mjs");
const readinessPath = join(root, "scripts/visual-refresh/readiness.mjs");
const shaFile = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const check = (ok, message) => { if (!ok) throw new Error(message); };

function cacheAwareObservation(cache, fullQueryKey) {
  const evidence = cache.get(fullQueryKey);
  return evidence?.status === 200
    ? { mode: "reuse-prior-200", evidence }
    : { mode: "await-fresh-http-response", evidence: null };
}
function canonicalFullLeadQuery(rawUrl) {
  const url = new URL(rawUrl);
  const query = [...url.searchParams.entries()]
    .sort(([ak, av], [bk, bv]) => ak.localeCompare(bk) || av.localeCompare(bv))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
  return `${url.origin}${url.pathname}?${query}`;
}
function cacheLogicSelfTest() {
  const cached = new Map();
  const initial = canonicalFullLeadQuery("https://crm.invalid/api/leads?page=1&limit=7&sortBy=updatedAt&sortOrder=desc");
  const searched = canonicalFullLeadQuery("https://crm.invalid/api/leads?search=Synthetic+Contact&page=1&limit=7&sortBy=updatedAt&sortOrder=desc");
  const contacted = canonicalFullLeadQuery("https://crm.invalid/api/leads?search=Synthetic+Contact&status=contacted&page=1&limit=7&sortBy=updatedAt&sortOrder=desc");
  const equipment = canonicalFullLeadQuery("https://crm.invalid/api/leads?search=Synthetic+Contact&applicationType=equipment&page=1&limit=7&sortBy=updatedAt&sortOrder=desc");
  const assigned = canonicalFullLeadQuery("https://crm.invalid/api/leads?search=Synthetic+Contact&repId=3&page=1&limit=7&sortBy=updatedAt&sortOrder=desc");
  for (const key of [initial, searched, contacted, equipment, assigned]) cached.set(key, { status: 200, body: { total: 1 } });
  for (const key of [initial, searched, contacted, equipment, assigned]) {
    check(cacheAwareObservation(cached, key).mode === "reuse-prior-200",
      `Cache self-test expected previously observed full query to reuse its 200 response: ${key}`);
  }
  const unseen = canonicalFullLeadQuery("https://crm.invalid/api/leads?search=previously-unseen&page=1&limit=7&sortBy=updatedAt&sortOrder=desc");
  check(cacheAwareObservation(cached, unseen).mode === "await-fresh-http-response",
    "Cache self-test expected an unseen full query to wait for a real HTTP response.");
  return { passed: true, previouslyObservedFullQueriesReused: 5, unseenQueryWaitsForHttp: true };
}
function priorLeadFailureEvidence() {
  const runs = join(reportRoot, "continuation/runs");
  const oldRun = join(runs, "3_fdWq7W");
  const cacheRun = join(runs, "f9i-LwP9");
  const oldFailure = JSON.parse(readFileSync(join(oldRun, "failure.json"), "utf8"));
  const cacheFailure = JSON.parse(readFileSync(join(cacheRun, "failure.json"), "utf8"));
  const cacheCheckpoints = JSON.parse(readFileSync(join(cacheRun, "section-checkpoints.json"), "utf8"));
  const cacheNetwork = readFileSync(join(cacheRun, "network-events.ndjson"), "utf8").trim().split("\n")
    .filter(Boolean).map(JSON.parse);
  check(oldFailure.status === "FAILED" && oldFailure.message.includes("waitForFunction"),
    "Retained task 3 Leads historical-count failure evidence is missing or changed.");
  check(cacheFailure.status === "FAILED" && cacheFailure.phase === "remaining:leads:lead-search-reset-initial-list"
    && cacheFailure.message.includes("waitForResponse") && cacheFailure.diagnostic?.assertion === "lead-search-company"
    && cacheFailure.diagnostic?.apiBody?.leads?.[0]?.id === 2,
    "Retained f9i-LwP9 Leads cache-reset failure evidence is missing or changed.");
  check(cacheCheckpoints.leads?.initialTotal === 15 && cacheCheckpoints.leads?.initialVisible === 7,
    "Retained f9i-LwP9 initial list evidence no longer confirms total 15/page size 7.");
  const resetRequests = cacheNetwork.filter((event) => event.eventType === "request"
    && event.phase === "remaining:leads:lead-search-reset-initial-list" && event.url?.path === "/api/leads");
  check(resetRequests.length === 0, "Retained f9i-LwP9 evidence unexpectedly shows a reset HTTP request.");
  return {
    preserved: true,
    task3: { run: "3_fdWq7W", failureFile: "continuation/runs/3_fdWq7W/failure.json",
      message: oldFailure.message, interpretation: "The historical-count assertion was invalid after the isolated seed added 13 rows: 15 total, page limit 7; keep as harness failure, not product defect." },
    cacheReset: { run: "f9i-LwP9", failureFile: "continuation/runs/f9i-LwP9/failure.json",
      phase: cacheFailure.phase, message: cacheFailure.message,
      initialTotal: cacheCheckpoints.leads.initialTotal, initialVisible: cacheCheckpoints.leads.initialVisible,
      lastObservedQuery: cacheFailure.diagnostic.apiBody, lastObservedDomRows: cacheFailure.diagnostic.domRowIds,
      resetLeadApiRequestsObserved: resetRequests.length,
      interpretation: "Previously observed unfiltered query returned from cache; no new /api/leads request is correct." },
  };
}
function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  check(first >= 0 && source.indexOf(before, first + before.length) < 0, `Expected one exact source marker for ${label}.`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}
function replaceBetween(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  check(start >= 0 && end > start, `Could not find source interval for ${label}.`);
  return source.slice(0, start) + replacement + source.slice(end);
}

function deriveRuntime() {
  const cacheDecisionSource = `const cacheAwareObservation = ${cacheAwareObservation.toString()};`;
  const cacheHelpers = `
function canonicalFullLeadQuery(rawUrl) {
  const url = new URL(rawUrl);
  const query = [...url.searchParams.entries()]
    .sort(([ak, av], [bk, bv]) => ak.localeCompare(bk) || av.localeCompare(bv))
    .map(([key, value]) => \`\${encodeURIComponent(key)}=\${encodeURIComponent(value)}\`).join("&");
  return \`\${url.origin}\${url.pathname}?\${query}\`;
}
function expectedFullLeadQuery(initialUrl, expected = {}) {
  const url = new URL(initialUrl);
  const query = { search: null, status: null, applicationType: null, repId: null, sortOrder: "desc", ...expected };
  for (const key of ["search", "status", "applicationType", "repId", "sortOrder"]) {
    if (query[key] == null) url.searchParams.delete(key);
    else url.searchParams.set(key, String(query[key]));
  }
  return canonicalFullLeadQuery(url.href);
}
async function leadControlSnapshot(page) {
  const input = page.getByPlaceholder("Search by name, email, company…", { exact: true });
  const comboTexts = await page.getByRole("combobox").allInnerTexts();
  const repButton = page.getByRole("button", { name: "Filter by representative", exact: true });
  return {
    search: await input.inputValue(),
    status: text(comboTexts[0]), applicationType: text(comboTexts[1]), sortOrder: text(comboTexts.at(-1)),
    representative: await repButton.innerText().catch(() => ""),
  };
}
function assertLeadControls(controls, expected, label, apiSnapshot) {
  const values = { search: "", status: null, applicationType: null, repId: null, sortOrder: "desc", ...expected };
  const statusLabel = values.status === "contacted" ? "Contacted" : values.status === "new_lead" ? "New Lead"
    : values.status === "follow_up" ? "Follow Up" : "All Statuses";
  const typeLabel = values.applicationType === "equipment" ? "Equipment"
    : values.applicationType === "working_capital" ? "Working Capital" : "All Types";
  const repLabel = values.repId == null ? "All Reps" : "Visual Fixture";
  const sortLabel = values.sortOrder === "asc" ? "Oldest First" : "Newest First";
  const observed = controls.search === values.search
    && controls.status.includes(statusLabel) && controls.applicationType.includes(typeLabel)
    && controls.sortOrder.includes(sortLabel) && controls.representative.includes(repLabel);
  check(observed, \`\${label}: UI controls do not match full API query; controls=\${JSON.stringify(controls)} api=\${JSON.stringify(apiSnapshot)}\`);
}
async function getLeadListAfter(page, expectedQuery, action, label, phaseRef) {
  currentPhase = \`remaining:leads:\${label}\`;
  if (phaseRef) phaseRef.value = currentPhase;
  const state = leadApiCacheByPage.get(page);
  check(state?.initialUrl, \`\${label}: initial lead query cache was not seeded.\`);
  const fullQueryKey = expectedFullLeadQuery(state.initialUrl, expectedQuery);
  const decision = cacheAwareObservation(state.responses, fullQueryKey);
  let responsePromise = null;
  if (decision.mode === "await-fresh-http-response") {
    responsePromise = page.waitForResponse((response) => {
      try { return response.request().method() === "GET" && canonicalFullLeadQuery(response.url()) === fullQueryKey; }
      catch { return false; }
    }, { timeout: 15000 });
  }
  await action();
  let responseStatus, responseUrl, body, responseProvenance;
  if (decision.mode === "reuse-prior-200") {
    ({ status: responseStatus, url: responseUrl, body } = decision.evidence);
    responseProvenance = "reused-previously-observed-full-query-200";
  } else {
    const response = await responsePromise;
    responseStatus = response.status(); responseUrl = response.url(); body = await response.json();
    check(responseStatus === 200, \`\${label}: fresh /api/leads expected 200; got \${responseStatus}; body=\${JSON.stringify(apiLeadSnapshot(body))}\`);
    const evidence = { status: responseStatus, url: responseUrl, body, observedAt: new Date().toISOString() };
    state.responses.set(fullQueryKey, evidence);
    append(outputFolder, "lead-api-query-cache.ndjson", {
      event: "captured-fresh-response", fullQueryKey, responseStatus, url: safeUrl(responseUrl), body: apiLeadSnapshot(body),
    });
    responseProvenance = "fresh-http-response";
  }
  if (responseStatus !== 200) throw new Error(\`\${label}: cached API evidence was not a 200: \${responseStatus}\`);
  const rows = await waitDomMatchesBody(page, body, label);
  const controls = await leadControlSnapshot(page);
  const bodySnapshot = apiLeadSnapshot(body);
  assertLeadControls(controls, expectedQuery, label, bodySnapshot);
  const snapshot = {
    responseStatus, requestUrl: safeUrl(responseUrl), fullQueryKey, responseProvenance,
    waitedForNewHttpResponse: decision.mode !== "reuse-prior-200",
    body: bodySnapshot, domRowIds: rows.map((row) => row.rowId), domRows: rows, controls,
    at: new Date().toISOString(),
  };
  diagnostic = { ...diagnostic, section: "leads", assertion: label, ...snapshot };
  append(outputFolder, "lead-api-query-cache.ndjson", {
    event: decision.mode === "reuse-prior-200" ? "reused-prior-response-and-asserted-current-dom" : "fresh-response-and-asserted-current-dom",
    fullQueryKey, responseStatus, responseProvenance, waitedForNewHttpResponse: snapshot.waitedForNewHttpResponse,
    body: bodySnapshot, domRowIds: snapshot.domRowIds, controls,
  });
  return { body, rows, snapshot };
}
`;
  const screenshotFunction = `
async function captureLeadsScreenshots(fx) {
  checkpoint("leads-screenshots", "running", { expected: 8, beforeCampaignAndLeadInteractions: true });
  currentPhase = "remaining:leads:screenshots";
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", reducedMotion: "reduce", serviceWorkers: "block" });
  try {
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const phaseRef = { value: currentPhase }, tracing = await trace(page, phaseRef, "leads-screenshots");
    await fx.login(page, "admin");
    for (const theme of ["light", "dark"]) {
      if (theme === "dark") {
        await page.goto(\`\${fx.url}/settings\`); await waitForPage(page, "settings");
        await page.getByLabel("Appearance theme").selectOption("dark");
      }
      for (const width of [390, 768, 1280, 1440]) {
        phaseRef.value = \`remaining:leads:screenshot:\${theme}:\${width}\`;
        await page.setViewportSize({ width, height: 900 });
        const responsePromise = page.waitForResponse((r) => r.request().method() === "GET"
          && new URL(r.url()).pathname === "/api/leads", { timeout: 15000 });
        await page.goto(\`\${fx.url}/leads\`); await waitForPage(page, "leads");
        if (theme === "dark") check(await page.locator("html").getAttribute("data-appearance") === "dark", "Dark appearance did not persist.");
        const response = await responsePromise, body = await response.json();
        check(response.status() === 200, \`Screenshot list response expected 200, got \${response.status()}.\`);
        const rows = await waitDomMatchesBody(page, body, \`screenshot-list-\${theme}-\${width}\`);
        const geometry = await page.evaluate(() => ({
          viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth,
          tableWidth: document.querySelector('[data-testid="table-leads-fit"] table')?.getBoundingClientRect().width ?? null,
        }));
        const name = \`leads-\${width}-\${theme}.png\`;
        await page.screenshot({ path: join(outputFolder, "screenshots", name) });
        step("leads-screenshots", \`leads-screenshot-\${width}-\${theme}\`, {
          filename: name, geometry, apiStatus: response.status(), apiBody: apiLeadSnapshot(body),
          fullQueryKey: canonicalFullLeadQuery(response.url()), domRowIds: rows.map((row) => row.rowId),
        });
      }
    }
    const files = require("node:fs").readdirSync(join(outputFolder, "screenshots")).filter((name) => name.endsWith(".png"));
    check(files.length === 8, \`Expected eight Leads screenshots, got \${files.length}.\`);
    const imgs = ["light", "dark"].flatMap((theme) => [390, 768, 1280, 1440].map((width) => \`screenshots/leads-\${width}-\${theme}.png\`));
    atomicJson(outputFolder, "leads-screenshots-evidence.json", { status: "passed", screenshots: files, count: files.length, order: "before Campaign 13 and Leads 13" });
    writeFileSync(join(outputFolder, "gallery.html"), \`<!doctype html><meta charset="utf-8"><title>Leads screenshots</title><h1>Leads — responsive light/dark evidence</h1><p>Schema-only fixture; this gallery is not a production-data certification.</p><main>\${imgs.map((file) => \`<figure><img src="\${file}" alt="\${file}"><figcaption>\${file}</figcaption></figure>\`).join("")}</main><style>body{font:16px system-ui;margin:2rem}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem}img{max-width:100%;height:auto;border:1px solid #aaa}figure{margin:0}</style>\`);
    checkpoint("leads-screenshots", "passed", { count: files.length, evidence: "leads-screenshots-evidence.json", gallery: "gallery.html" });
    await tracing.detach().catch(() => {});
  } finally { await context.close(); }
}
async function runIndependentSection(name, work) {
  try { await work(); return true; }
  catch (error) {
    const failure = { section: name, message: text(error.stack ?? error), diagnostic, at: new Date().toISOString() };
    append(outputFolder, "section-failures.ndjson", failure);
    checkpoint(name, "failed", { failure: text(error.message), diagnostic });
    return false;
  }
}
`;
  let source = readFileSync(baseRunnerPath, "utf8");
  source = replaceOnce(source,
    "let outputFolder, runId, progress, browser, fixture, fixtureDbName;",
    "let outputFolder, runId, progress, browser, fixture, fixtureDbName;\nconst leadApiCacheByPage = new WeakMap();\n" + cacheDecisionSource,
    "page-scoped full-query cache");
  source = replaceOnce(source,
    'const tracing = await trace(page, phaseRef, "leads-journey");',
    'const tracing = await trace(page, phaseRef, "leads-journey");\n    const leadCache = { initialUrl: null, responses: new Map() };\n    leadApiCacheByPage.set(page, leadCache);',
    "lead query cache initialization");
  source = replaceOnce(source,
    "const initialResponse = await initialPromise, initialBody = await initialResponse.json();",
    `const initialResponse = await initialPromise, initialBody = await initialResponse.json();
    leadCache.initialUrl = initialResponse.url();
    const initialFullQueryKey = canonicalFullLeadQuery(initialResponse.url());
    leadCache.responses.set(initialFullQueryKey, { status: initialResponse.status(), url: initialResponse.url(), body: initialBody, observedAt: new Date().toISOString() });
    append(outputFolder, "lead-api-query-cache.ndjson", { event: "captured-initial-full-query-200", fullQueryKey: initialFullQueryKey, responseStatus: initialResponse.status(), body: apiLeadSnapshot(initialBody) });`,
    "initial response cache seed");

  source = replaceBetween(source, "async function getLeadListAfter(", "\nfunction assertSingleLead", cacheHelpers, "cache-aware Leads query helper");
  source = replaceOnce(source,
    '    step("leads", "lead-representative-filter", { selectedOption: text(repOptionText), expectedRepId: 3, api: result.snapshot });',
    `    step("leads", "lead-representative-filter", { selectedOption: text(repOptionText), expectedRepId: 3, api: result.snapshot });
    const repResetButton = page.getByRole("button", { name: "Filter by representative", exact: true });
    const repReset = await getLeadListAfter(page, { search: "Synthetic Contact" }, async () => {
      await repResetButton.click();
      await page.getByRole("option", { name: "All Reps", exact: true }).click();
    }, "lead-representative-filter-reset", phaseRef);
    assertSingleLead(repReset, 1, "representative reset", { assignedRepId: 3 });
    checkpoint("leads", "rep-reset-cache-reuse", { responseProvenance: repReset.snapshot.responseProvenance, fullQueryKey: repReset.snapshot.fullQueryKey, responseStatus: repReset.snapshot.responseStatus, domRowIds: repReset.snapshot.domRowIds, controls: repReset.snapshot.controls });`,
    "rep filter reset cache assertion");
  source = replaceOnce(source,
    'queryMatches(r.url(), baseLeadQuery({ search: "Synthetic Contact", repId: "3", sortOrder: "asc" }))',
    'queryMatches(r.url(), baseLeadQuery({ search: "Synthetic Contact", sortOrder: "asc" }))',
    "oldest sort after rep reset");
  source = replaceOnce(source,
    '    const oldestResponse = await oldestPromise, oldestBody = await oldestResponse.json();',
    `    const oldestResponse = await oldestPromise, oldestBody = await oldestResponse.json();
    const oldestKey = canonicalFullLeadQuery(oldestResponse.url());
    leadCache.responses.set(oldestKey, { status: oldestResponse.status(), url: oldestResponse.url(), body: oldestBody, observedAt: new Date().toISOString() });
    append(outputFolder, "lead-api-query-cache.ndjson", { event: "captured-fresh-response", fullQueryKey: oldestKey, responseStatus: oldestResponse.status(), body: apiLeadSnapshot(oldestBody) });
    const oldestControls = await leadControlSnapshot(page);
    assertLeadControls(oldestControls, { search: "Synthetic Contact", sortOrder: "asc" }, "lead-oldest-sort", apiLeadSnapshot(oldestBody));`,
    "oldest-sort cache and control snapshot");
  source = replaceOnce(source,
    'result = { response: oldestResponse, body: oldestBody, rows: oldestRows, snapshot: { status: oldestResponse.status(), requestUrl: safeUrl(oldestResponse.url()), body: apiLeadSnapshot(oldestBody), domRowIds: oldestRows.map((row) => row.rowId), domRows: oldestRows } };',
    'result = { response: oldestResponse, body: oldestBody, rows: oldestRows, snapshot: { status: oldestResponse.status(), requestUrl: safeUrl(oldestResponse.url()), fullQueryKey: oldestKey, responseProvenance: "fresh-http-response", body: apiLeadSnapshot(oldestBody), domRowIds: oldestRows.map((row) => row.rowId), domRows: oldestRows, controls: oldestControls } };',
    "oldest snapshot");

  const leadStart = source.indexOf("async function leadsJourney(");
  const campaignStart = source.indexOf("\nasync function campaignJourney(", leadStart);
  check(leadStart >= 0 && campaignStart > leadStart, "Could not split screenshot work from Leads interaction work.");
  let leadBody = source.slice(leadStart, campaignStart);
  const screenshotStart = leadBody.indexOf('    phaseRef.value = "remaining:leads:screenshots"; currentPhase = phaseRef.value;');
  const screenshotEnd = leadBody.lastIndexOf('    await tracing.detach().catch(() => {});');
  check(screenshotStart >= 0 && screenshotEnd > screenshotStart, "Could not isolate the existing screenshot block.");
  leadBody = leadBody.slice(0, screenshotStart) + '    await tracing.detach().catch(() => {});\n  } finally { await context.close(); }\n}\n';
  source = source.slice(0, leadStart) + leadBody + screenshotFunction + source.slice(campaignStart);

  source = replaceOnce(source,
    '    step("campaign-13", "admin-results-metrics-13", {\n      api: campaignApiSnapshot, dom: { legacySent: legacyText, sentKpi: kpiText, panel: panels, uniqueClicks: clicks, replies },\n    });',
    `    step("campaign-13", "admin-results-metrics-13", {
      api: campaignApiSnapshot, dom: { legacySent: legacyText, sentKpi: kpiText, panel: panels, uniqueClicks: clicks, replies },
    });
    atomicJson(outputFolder, "campaign-13-evidence.json", { status: "passed", api: campaignApiSnapshot, dom: { legacySent: legacyText, sentKpi: kpiText, panel: panels, uniqueClicks: clicks, replies } });`,
    "campaign immediate evidence");

  source = replaceOnce(source,
    '    updateProgress({ status: "running", phase: "leads-13-interactions" });\n    await leadsJourney(fixture);\n    updateProgress({ phase: "campaign-13" });\n    await campaignJourney(fixture);',
    `      updateProgress({ status: "running", phase: "independent-screenshots-campaign" });
    await runIndependentSection("leads-screenshots", () => captureLeadsScreenshots(fixture));
    await runIndependentSection("campaign-13", () => campaignJourney(fixture));
    updateProgress({ phase: "leads-13-interactions" });
    await leadsJourney(fixture);`,
    "pre-Leads independent section order");
  source = replaceOnce(source,
    '    && badPwr.length === 0 && badCdp.length === 0 && consoleRows.length === 0 && pageErrors.length === 0 && requestFailures.length === 0;',
    '    && badPwr.length === 0 && badCdp.length === 0 && consoleRows.length === 0 && pageErrors.length === 0 && requestFailures.length === 0\n    && readNdjson(join(outputFolder, "section-failures.ndjson")).length === 0;',
    "independent section failures block completion");
  source = replaceOnce(source, "\nasync function execute() {",
    "\n" + priorLeadFailureEvidence.toString() + "\nasync function execute() {", "preserved prior Leads failure evidence reader");
  source = replaceOnce(source,
    '  atomicJson(outputFolder, "retained-role-evidence.json", roles);',
    '  atomicJson(outputFolder, "retained-role-evidence.json", roles);\n  atomicJson(outputFolder, "retained-prior-lead-search-failures.json", priorLeadFailureEvidence());',
    "copy prior Leads failure evidence into new run");

  source = replaceOnce(source,
    'const root = resolve(import.meta.dirname, "../..");',
    `const root = ${JSON.stringify(root)};`,
    "fixed project root for generated runtime");
  source = replaceOnce(source, 'import { chromium } from "@playwright/test";',
    `import { chromium } from ${JSON.stringify(import.meta.resolve("@playwright/test"))};`, "absolute Playwright import");
  source = replaceOnce(source, 'import { startSandbox } from "../../scripts/visual-refresh/sandbox.mjs";',
    `import { startSandbox } from ${JSON.stringify(pathToFileURL(sandboxPath).href)};`, "absolute sandbox import");
  source = replaceOnce(source, 'import { waitForPage } from "../../scripts/visual-refresh/readiness.mjs";',
    `import { waitForPage } from ${JSON.stringify(pathToFileURL(readinessPath).href)};`, "absolute readiness import");
  source = source.replaceAll("lock.remainingRunnerSha256", "lock.cacheAwareRemainingRunnerSha256");
  source = source.replaceAll("shaFile(import.meta.filename)", "shaFile(join(reportRoot, 'remaining-runner-cache-aware.mjs'))");
  return source;
}

function authLock(requirePin) {
  const lock = JSON.parse(readFileSync(authPath, "utf8"));
  check(lock.remainingRunnerSha256 === shaFile(baseRunnerPath),
    "Pinned prior remaining-runner changed; cache-aware derivative will not alter/replace it.");
  if (requirePin) {
    check(lock.cacheAwareRemainingRunnerSha256 === shaFile(import.meta.filename),
      "Main cacheAwareRemainingRunnerSha256 does not match this file.");
    check(typeof lock.managedTaskId === "string" && lock.managedTaskId.length >= 4,
      "Main authorization lacks the new managedTaskId.");
  }
  return lock;
}
function compileDerived(source) {
  const result = spawnSync(process.execPath, ["--check", "--input-type=module"], { input: source, encoding: "utf8", timeout: 15000 });
  check(result.status === 0, `Derived cache-aware runner syntax error: ${result.stderr || result.error?.message || "unknown"}`);
}
async function runDerived(args, source) {
  const folder = mkdtempSync(join(tmpdir(), "role-directory-remaining-"));
  const runtimePath = join(folder, "runtime.mjs");
  writeFileSync(runtimePath, source);
  try {
    const child = spawn(process.execPath, [runtimePath, ...args], { cwd: root, stdio: "inherit" });
    const code = await new Promise((resolveExit, reject) => {
      child.once("error", reject);
      child.once("exit", (status, signal) => resolveExit(signal ? 1 : status ?? 1));
    });
    process.exitCode = code;
  } finally { rmSync(folder, { recursive: true, force: true }); }
}

async function main() {
  const args = process.argv.slice(2);
  const sourceOnly = args.includes("--check-source-ready-only");
  const readyOnly = args.includes("--check-ready-only");
  const continuing = args.includes("--continue");
  check([sourceOnly, readyOnly, continuing].filter(Boolean).length === 1,
    "Choose exactly one: --check-source-ready-only, --check-ready-only, or --continue.");
  const lock = authLock(!sourceOnly);
  const taskId = args.find((arg) => arg.startsWith("--managed-task-id="))?.slice("--managed-task-id=".length);
  if (continuing) {
    check(/^[A-Za-z0-9][A-Za-z0-9._-]{3,79}$/.test(taskId ?? ""), "Main-managed task ID required.");
    check(taskId === lock.managedTaskId, "CLI task ID differs from pinned managedTaskId.");
  }
  const cacheUnit = cacheLogicSelfTest();
  const retainedFailures = priorLeadFailureEvidence();
  const generated = deriveRuntime();
  compileDerived(generated);
  if (sourceOnly) {
    await runDerived(["--check-source-ready-only"], generated);
    if (!process.exitCode) console.log(JSON.stringify({
      cacheAwareRunnerReady: true, browserLaunched: false, sourceOnlyGatePassed: true,
      remainingRunnerSha256: shaFile(import.meta.filename), priorRemainingRunnerSha256: shaFile(baseRunnerPath),
      cacheLogicSelfTest: cacheUnit, retainedPriorLeadsFailures: retainedFailures,
      note: "Main must pin cacheAwareRemainingRunnerSha256 and managedTaskId before browser launch.",
    }, null, 2));
    return;
  }
  await runDerived(readyOnly ? ["--check-ready-only"] : ["--continue", `--managed-task-id=${taskId}`], generated);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
