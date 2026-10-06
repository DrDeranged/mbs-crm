import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile, access, readdir, stat, cp, rename } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";

const workspace = resolve(import.meta.dirname, "../..");
const reportRoot = join(workspace, "reports/predeploy-c6fc40f");
const sourceRoot = join(workspace, ".local/predeploy-c6fc40f-source");
const expectedCommit = "c6fc40fa76880972ad2d8b1226ef0fb45c5890ca";
const sourcePinPath = join(reportRoot, "source-pin.json");
const pinned = (path) => join(sourceRoot, path);
const sha1Blob = (bytes) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const parse = async (path) => JSON.parse(await readFile(path, "utf8"));
const checks = [];
function check(ok, name, actual = null) {
  checks.push({ name, passed: Boolean(ok), actual });
  if (!ok) throw new Error(`${name}: ${JSON.stringify(actual)}`);
}
function replaceOnce(text, oldText, newText, label) {
  const at = text.indexOf(oldText);
  if (at < 0 || text.indexOf(oldText, at + oldText.length) >= 0) {
    throw new Error(`Pinned harness drift; refusing unsafe adaptation: ${label}`);
  }
  return text.slice(0, at) + newText + text.slice(at + oldText.length);
}
async function treeFingerprint(root) {
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  await walk(root);
  files.sort();
  const hash = createHash("sha256");
  for (const file of files) {
    const relative = file.slice(root.length + 1).split("\\").join("/");
    hash.update(relative).update("\0").update(await readFile(file)).update("\0");
  }
  return { sha256: hash.digest("hex"), fileCount: files.length };
}
async function verifyFrozenBuilds(source) {
  const absent = [
    { artifact: "frozen pinned API dist", root: null, present: false },
    { artifact: "frozen pinned web dist/public", root: null, present: false },
  ];
  try {
    const pointer = await parse(join(reportRoot, "frozen-builds/current.json"));
    const snapshotRoot = resolve(reportRoot, pointer.snapshot);
    const frozenParent = resolve(reportRoot, "frozen-builds") + "/";
    if (!snapshotRoot.startsWith(frozenParent)) throw new Error("frozen snapshot path escapes report root");
    const manifest = await parse(join(snapshotRoot, "build-provenance.json"));
    if (manifest.targetCommit !== expectedCommit || manifest.sourceTree !== source.pin.tree
      || manifest.snapshot !== pointer.snapshot) throw new Error("frozen manifest does not match pinned source receipt");
    const builds = [
      { artifact: "frozen pinned API dist", key: "api", root: join(snapshotRoot, "api") },
      { artifact: "frozen pinned web dist/public", key: "web", root: join(snapshotRoot, "web-public") },
    ];
    for (const build of builds) {
      const expected = manifest.artifacts?.[build.key];
      const sourceFingerprint = manifest.sourceFingerprints?.[build.key];
      const fingerprint = await treeFingerprint(build.root);
      if (!expected || !sourceFingerprint
        || expected.sha256 !== sourceFingerprint.sha256
        || expected.fileCount !== sourceFingerprint.fileCount
        || expected.sha256 !== fingerprint.sha256 || expected.fileCount !== fingerprint.fileCount) {
        throw new Error(`${build.artifact} fingerprint does not match build provenance`);
      }
      Object.assign(build, fingerprint, { present: true, mtime: (await stat(build.root)).mtime.toISOString() });
    }
    return { verified: true, status: "VERIFIED", snapshot: pointer.snapshot, manifest, artifacts: builds };
  } catch (error) {
    return { verified: false, status: "MISSING_OR_INVALID", error: String(error?.message ?? error), artifacts: absent };
  }
}

async function validatePinnedEvidence() {
  const pin = await parse(sourcePinPath);
  check(pin.requestedCommit === expectedCommit && pin.observedMain === expectedCommit
    && pin.root === sourceRoot && pin.verifiedBlobCount === 1580, "exact pinned GitHub source receipt", {
    requestedCommit: pin.requestedCommit, observedMain: pin.observedMain, tree: pin.tree, verifiedBlobCount: pin.verifiedBlobCount,
  });
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: sourceRoot, encoding: "utf8" });
  const tree = spawnSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: sourceRoot, encoding: "utf8" });
  check(head.status === 0 && head.stdout.trim() === expectedCommit
    && tree.status === 0 && tree.stdout.trim() === pin.tree, "restored source Git metadata matches commit/tree",
  { head: head.stdout.trim(), tree: tree.stdout.trim() });
  const approval = await parse(pinned("reports/opt-in-recertification/approval-manifest.json"));
  const structuralRoot = pinned("reports/structural-certification-2026-10-03/after");
  const baseline = await parse(join(structuralRoot, "role-controls.json"));
  const exemptions = await parse(join(structuralRoot, "exempt-controls.json"));
  const caseKeys = Object.keys(baseline).sort();
  check(caseKeys.length === 36 && JSON.stringify(caseKeys) === JSON.stringify(Object.keys(exemptions).sort()),
    "archived baseline has exactly matching original control/exemption cases", { caseCount: caseKeys.length });
  check(approval.existingExemptions?.archivedInventory ===
    "reports/structural-certification-2026-10-03/after/exempt-controls.json"
    && approval.strictRemainder?.caseCount === 36 && approval.strictRemainder?.anyOtherDifferenceFails === true,
    "pinned approval manifest binds strict 36-case baseline", approval.strictRemainder);
  for (const path of [
    "reports/opt-in-recertification/approval-manifest.json",
    "reports/structural-certification-2026-10-03/after/role-controls.json",
    "reports/structural-certification-2026-10-03/after/exempt-controls.json",
    "scripts/nate-workflows/capture-certification.mjs",
    "scripts/visual-refresh/sandbox.mjs",
    "scripts/visual-refresh/readiness.mjs",
  ]) {
    const entry = pin.files.find((file) => file.path === path);
    check(Boolean(entry), `source receipt includes ${path}`);
    const bytes = await readFile(pinned(path));
    check(sha1Blob(bytes) === entry.sha, `pinned Git blob verifies ${path}`, { gitBlob: entry.sha });
  }
  return { pin, approval, baseline, exemptions };
}

async function readiness() {
  const source = await validatePinnedEvidence();
  const preflight = join(reportRoot, "preflight.raw.log");
  const requires = createRequire(pinned("package.json"));
  const hasPreflight = await access(preflight).then(() => true, () => false);
  const preflightText = hasPreflight ? await readFile(preflight, "utf8") : "";
  const preflightStatus = /\bPREFLIGHT FAIL\b/.test(preflightText) || /AUTHORITATIVE_COMMAND_EXIT=[1-9]/.test(preflightText)
    ? "FAIL" : /\bPREFLIGHT PASS\b/.test(preflightText) && /AUTHORITATIVE_COMMAND_EXIT=0/.test(preflightText)
      ? "PASS" : hasPreflight ? "RUNNING_OR_INCOMPLETE" : "NOT_STARTED";
  const frozen = await verifyFrozenBuilds(source);
  const deps = (() => { try { return Boolean(requires.resolve("@playwright/test")); } catch { return false; } })();
  const secretConfigured = process.env.CLERK_SECRET_KEY?.startsWith("sk_test_") === true;
  const databaseConfigured = Boolean(process.env.DATABASE_URL);
  const browserReady = frozen.verified && deps && secretConfigured && databaseConfigured;
  const record = {
    targetCommit: expectedCommit, sourceTree: source.pin.tree, verifiedBlobCount: source.pin.verifiedBlobCount,
    archivedBaselineCases: Object.keys(source.baseline).length, candidateBuilds: frozen.artifacts,
    buildFreezeStatus: frozen.status, buildFreezeError: frozen.error ?? null,
    frozenSnapshot: frozen.snapshot ?? null, pinnedPlaywrightDependencyAvailable: deps, preflightStatus,
    testClerkCredentialConfigured: secretConfigured, developmentDatabaseConfigured: databaseConfigured,
    browserExecutionPermitted: browserReady,
  };
  await writeFile(join(reportRoot, "readiness.json"), JSON.stringify(record, null, 2));
  if (process.argv.includes("--check-ready-only")) {
    console.log(JSON.stringify(record, null, 2));
    return { ...source, record };
  }
  check(frozen.verified, "immutable pinned API/web build snapshots are present and fingerprint-verified",
    { status: frozen.status, error: frozen.error, snapshot: frozen.snapshot });
  check(deps, "pinned Playwright dependency is available");
  check(secretConfigured && databaseConfigured, "isolated fixture prerequisites are configured without printing secret values");
  return { ...source, record };
}

async function freezeBuildsOnly() {
  const source = await validatePinnedEvidence();
  const sourceApi = pinned("artifacts/api-server/dist");
  const sourceWeb = pinned("artifacts/mbs-crm/dist/public");
  check(await access(join(sourceApi, "index.mjs")).then(() => true, () => false)
    && await access(join(sourceWeb, "index.html")).then(() => true, () => false),
  "Main's pinned API/web smoke-build outputs exist");
  const sourceFingerprints = {
    api: await treeFingerprint(sourceApi),
    web: await treeFingerprint(sourceWeb),
  };
  const id = `c6fc40f-${new Date().toISOString().replaceAll(":", "-")}`;
  const relativeSnapshot = `frozen-builds/${id}`;
  const snapshotRoot = join(reportRoot, relativeSnapshot);
  await mkdir(join(reportRoot, "frozen-builds"), { recursive: true });
  await mkdir(snapshotRoot, { recursive: false });
  await cp(sourceApi, join(snapshotRoot, "api"), { recursive: true, errorOnExist: true });
  await cp(sourceWeb, join(snapshotRoot, "web-public"), { recursive: true, errorOnExist: true });
  const artifacts = {
    api: await treeFingerprint(join(snapshotRoot, "api")),
    web: await treeFingerprint(join(snapshotRoot, "web-public")),
  };
  check(artifacts.api.sha256 === sourceFingerprints.api.sha256
    && artifacts.api.fileCount === sourceFingerprints.api.fileCount
    && artifacts.web.sha256 === sourceFingerprints.web.sha256
    && artifacts.web.fileCount === sourceFingerprints.web.fileCount,
  "frozen API/web copies exactly match the pinned smoke-build outputs", { sourceFingerprints, artifacts });
  const manifest = {
    targetCommit: expectedCommit, sourceTree: source.pin.tree, snapshot: relativeSnapshot,
    frozenAt: new Date().toISOString(), immutableByPolicy: true,
    sourceBuildRoots: { api: sourceApi, web: sourceWeb },
    sourceBuildRootMtimes: {
      api: (await stat(sourceApi)).mtime.toISOString(),
      web: (await stat(sourceWeb)).mtime.toISOString(),
    },
    sourceFingerprints, artifacts,
  };
  await writeFile(join(snapshotRoot, "build-provenance.json"), JSON.stringify(manifest, null, 2));
  const pointerPath = join(reportRoot, "frozen-builds/current.json");
  await mkdir(dirname(pointerPath), { recursive: true });
  const nextPointer = `${pointerPath}.next`;
  await writeFile(nextPointer, JSON.stringify({ snapshot: relativeSnapshot, frozenAt: manifest.frozenAt }, null, 2));
  await rename(nextPointer, pointerPath);
  console.log(JSON.stringify({ status: "FROZEN_PINNED_BUILDS", ...manifest }, null, 2));
}

async function prepareNateHarness(runRoot, source) {
  const evidence = join(runRoot, "reports/nate-workflows");
  const before = join(evidence, "before");
  await mkdir(before, { recursive: true });
  const navNames = new Set([
    "Dashboard", "Leads", "Deals", "Rate & Points", "Documents", "Campaigns",
    "Email Templates", "Drip Sequences", "Partners", "Flyer Templates", "Stale Leads",
    "Credit Compliance", "Data Governance", "Workflow Rules", "System Health",
    "USFA Intake", "Settings", "Apply",
  ]);
  const navigation = Object.fromEntries(Object.entries(source.baseline).map(([key, controls]) => [
    key, controls.filter((control) => control.tag === "A" && navNames.has(control.name)),
  ]));
  for (const [name, data] of Object.entries({
    "controls.json": source.baseline,
    "role-controls.json": source.baseline,
    "exempt-controls.json": source.exemptions,
    "navigation-controls.json": navigation,
  })) await writeFile(join(before, name), JSON.stringify(data, null, 2));

  let code = await readFile(pinned("scripts/nate-workflows/capture-certification.mjs"), "utf8");
  code = replaceOnce(code, 'import { chromium } from "@playwright/test";',
    `import { createRequire } from "node:module";\nconst require = createRequire(${JSON.stringify(pinned("package.json"))});\nconst { chromium } = require("@playwright/test");`,
    "Playwright resolution");
  code = replaceOnce(code, 'import { startSandbox } from "../visual-refresh/sandbox.mjs";',
    `const { startSandbox } = await import(${JSON.stringify(pathToFileURL(pinned("scripts/visual-refresh/sandbox.mjs")).href)});`,
    "pinned sandbox import");
  code = replaceOnce(code, 'import { waitForPage } from "../visual-refresh/readiness.mjs";',
    `const { waitForPage } = await import(${JSON.stringify(pathToFileURL(pinned("scripts/visual-refresh/readiness.mjs")).href)});`,
    "pinned readiness import");
  const retryControl = '{ tag: "BUTTON", role: null, type: "button", name: "Retry", href: null, disabled: false }';
  const helper = `function allowedStructuralRemoval(screen, control) {
  return ${JSON.stringify(source.approval.removals[0].cases)}.includes(screen)
    && JSON.stringify(control) === JSON.stringify(${retryControl});
}\n\n`;
  code = replaceOnce(code, "function compareInventories(before, after, assertionResult) {",
    `${helper}function compareInventories(before, after, assertionResult) {`, "strict Retry exception helper");
  const oldCheck = `check(assertionResult, \`structure \${key} allows only expected additions\`, removed.length === 0 && unexpectedAdded.length === 0 && allowed.length === expectedCount,
      { removed, allowed, unexpectedAdded, expectedAddition, expectedCount });
    const retained = right.filter(control => !allowedStructuralAddition(key, control));
    check(assertionResult, \`structure \${key} preserves exact retained control order\`,
      JSON.stringify(left) === JSON.stringify(retained), { baseline: left, retained });`;
  const newCheck = `const approvedRemoved = removed.filter(control => allowedStructuralRemoval(key, control));
    const unexpectedRemoved = removed.filter(control => !allowedStructuralRemoval(key, control));
    const expectedRemovalCount = ${JSON.stringify(source.approval.removals[0].cases)}.includes(key) ? 1 : 0;
    check(assertionResult, \`structure \${key} allows only exact approved additions/removals\`,
      unexpectedRemoved.length === 0 && approvedRemoved.length === expectedRemovalCount
        && unexpectedAdded.length === 0 && allowed.length === expectedCount,
      { removed, approvedRemoved, unexpectedRemoved, allowed, unexpectedAdded, expectedAddition, expectedCount, expectedRemovalCount });
    const retained = right.filter(control => !allowedStructuralAddition(key, control));
    const retainedBaseline = left.filter(control => !allowedStructuralRemoval(key, control));
    check(assertionResult, \`structure \${key} preserves exact retained control order\`,
      JSON.stringify(retainedBaseline) === JSON.stringify(retained), { baseline: retainedBaseline, retained });`;
  code = replaceOnce(code, oldCheck, newCheck, "archived-baseline comparison with exact Retry removal");
  code = replaceOnce(code,
    "const result = { screens: priorScreens, navigationScreens: priorNavigationScreens, assertions: {}, failures: [], campaignId: null, forbiddenRequests: [], pageErrors: [], fixture: null, behaviorComplete: false };",
    "const result = { screens: priorScreens, navigationScreens: priorNavigationScreens, assertions: {}, failures: [], campaignId: null, campaignListRoutes: [], forbiddenRequests: [], pageErrors: [], httpErrors: [], consoleErrors: [], fixture: null, behaviorComplete: false };",
    "HTTP/console evidence arrays");
  code = replaceOnce(code,
    '      page.on("pageerror", error => result.pageErrors.push(`${role}: ${error.message}`));',
    `      page.on("pageerror", error => result.pageErrors.push(\`\${role}: \${error.message}\`));
      page.on("console", message => { if (message.type() === "error") result.consoleErrors.push({ role, text: message.text() }); });
      page.on("response", response => {
        const status = response.status();
        if (status >= 400) {
          const url = new URL(response.url());
          result.httpErrors.push({ context: "role-route", role, route: new URL(page.url()).pathname, status, method: response.request().method(), path: url.pathname });
        }
      });`,
    "role route response/error instrumentation");
  const oldFinalChecks = `    check(result, \`\${label} makes no prohibited provider/delivery API requests\`, result.forbiddenRequests.length === 0, result.forbiddenRequests);
    check(result, \`\${label} has no uncaught browser page errors\`, result.pageErrors.length === 0, result.pageErrors);`;
  const newFinalChecks = `    const unexpectedHttpErrors = result.httpErrors.filter(item => item.context !== "behavior-api" && !(item.status === 503 && /twilio/i.test(item.path)));
    check(result, \`\${label} captures only approved fixture Twilio 503 errors\`, unexpectedHttpErrors.length === 0, result.httpErrors);
    check(result, \`\${label} has no browser console errors\`, result.consoleErrors.length === 0, result.consoleErrors);
    await writeFile(\`\${out}/http-errors.ndjson\`, result.httpErrors.map(item => JSON.stringify(item)).join("\\n") + (result.httpErrors.length ? "\\n" : ""));
    check(result, \`\${label} makes no prohibited provider/delivery API requests\`, result.forbiddenRequests.length === 0, result.forbiddenRequests);
    check(result, \`\${label} has no uncaught browser page errors\`, result.pageErrors.length === 0, result.pageErrors);`;
  code = replaceOnce(code, oldFinalChecks, newFinalChecks, "HTTP error allowlist and console assertion");
  code = replaceOnce(code,
    "      prohibitedRequests: result.forbiddenRequests,\n      sourceSearchDiagnostic:",
    "      prohibitedRequests: result.forbiddenRequests,\n      httpErrors: result.httpErrors,\n      consoleErrors: result.consoleErrors,\n      sourceSearchDiagnostic:",
    "HTTP/console assertion evidence serialization");
  const identitySweep = `async function runDealIdentityVisualSweep(page, sandbox, fixture, result, out) {
  const lead = fixture.sourceRows[0];
  const dealId = fixture.deals.usfaOpenA;
  const expectedDealPaths = ["/deals/" + fixture.deals.usfaOpenA, "/deals/" + fixture.deals.usfaOpenB];
  const expectedDealAnchors = async (scope) => {
    const anchors = await scope.locator('a[href^="/deals/"]').evaluateAll(elements =>
      elements.map(anchor => ({ href: new URL(anchor.href).pathname, label: (anchor.innerText || "").trim() })));
    return anchors.filter(anchor => expectedDealPaths.includes(anchor.href));
  };
  const hasOrdinalLabel = (text) => /\\bDeal\\s*#?\\s*\\d+\\b/i.test(text);
  const expected = lead.first + " Equipment LLC — " + lead.first + " Fixture01";
  if (!args.includes("--resume-identity-only")) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(sandbox.url + "/deals");
    await page.getByRole("heading", { name: "Deals" }).waitFor({ timeout: 20000 });
    await page.getByRole("button", { name: "Table", exact: true }).click();
    const listLinks = await expectedDealAnchors(page);
    const listText = await page.locator("body").innerText();
    check(result, "deal naming UI: list renders both explicit fixture deal links as Company — Customer",
      listLinks.length === 2 && expectedDealPaths.every(href => listLinks.filter(link => link.href === href && link.label === expected).length === 1)
        && listLinks.every(link => !hasOrdinalLabel(link.label)) && !hasOrdinalLabel(listText),
      { expected, fixtureDealPaths: expectedDealPaths, matchingLinks: listLinks, ordinalLabel: hasOrdinalLabel(listText) });
    await page.screenshot({ path: out + "/identity-deals-list.png", fullPage: true });

    await page.getByRole("button", { name: "Kanban", exact: true }).click();
    await page.getByTestId("deals-board-desktop").waitFor({ timeout: 15000 });
    const cardLinks = await expectedDealAnchors(page.getByTestId("deals-board-desktop"));
    const cardsText = await page.getByTestId("deals-board-desktop").innerText();
    check(result, "deal naming UI: Pipeline/Kanban renders both explicit fixture deal links as Company — Customer",
      cardLinks.length === 2 && expectedDealPaths.every(href => cardLinks.filter(link => link.href === href && link.label === expected).length === 1)
        && cardLinks.every(link => !hasOrdinalLabel(link.label)) && !hasOrdinalLabel(cardsText),
      { expected, fixtureDealPaths: expectedDealPaths, matchingLinks: cardLinks, ordinalLabel: hasOrdinalLabel(cardsText) });
    await page.screenshot({ path: out + "/identity-pipeline-cards.png", fullPage: true });

    await page.goto(sandbox.url + "/deals/" + dealId);
    await page.getByRole("heading").first().waitFor({ timeout: 20000 });
    const headerText = await page.locator("body").innerText();
    check(result, "deal naming UI: deal header renders Company — Customer",
      headerText.includes(expected) && !hasOrdinalLabel(headerText), { expected, found: headerText.includes(expected), ordinalLabel: hasOrdinalLabel(headerText) });
    await page.screenshot({ path: out + "/identity-deal-header.png", fullPage: true });
  }

  await page.goto(sandbox.url + "/leads/" + fixture.leads.usfaOpen);
  const referralPanel = page.getByTestId("panel-referred-records");
  await referralPanel.waitFor({ timeout: 20000 });
  const referralText = await referralPanel.innerText();
  const referralLinks = await expectedDealAnchors(referralPanel);
  check(result, "deal naming UI: referral panel renders both explicit fixture deal links with the required Company — Customer label",
    referralLinks.length === 2 && expectedDealPaths.every(href => referralLinks.filter(link => link.href === href && link.label === expected).length === 1)
      && referralLinks.every(link => !hasOrdinalLabel(link.label)) && !hasOrdinalLabel(referralText),
    { expected, fixtureDealPaths: expectedDealPaths, matchingLinks: referralLinks, ordinalLabel: hasOrdinalLabel(referralText) });
  await page.screenshot({ path: out + (args.includes("--resume-identity-only") ? "/resume-identity-referral-panel.png" : "/identity-referral-panel.png"), fullPage: true });

  await page.goto(sandbox.url + "/deals");
  await page.getByRole("button", { name: "Open command palette" }).click();
  const search = page.getByPlaceholder("Search pages, leads, deals, lenders, partners, and actions…");
  await search.fill(lead.first);
  const resultItem = page.getByRole("option").filter({ hasText: expected }).first();
  await resultItem.waitFor({ timeout: 15000 });
  const commandText = await resultItem.innerText();
  check(result, "deal naming UI: ⌘K deal search result renders Company — Customer",
    commandText.includes(expected) && !hasOrdinalLabel(commandText), { expected, commandText, ordinalLabel: hasOrdinalLabel(commandText) });
  await page.screenshot({ path: out + "/identity-cmdk-result.png", fullPage: true });

  const rule = await api(page, sandbox, "POST", "/workflow-rules", {
    name: "Predeploy identity notification fixture",
    triggerStatus: "contacted",
    actionType: "send_notification",
    actionConfig: { title: "Deal update — " + expected, body: expected },
    isActive: true,
  });
  check(result, "notification fixture created through workflow API", rule.status === 201, { status: rule.status });
  const changed = await api(page, sandbox, "PUT", "/leads/" + fixture.leads.usfaOpen,
    { status: "contacted", repId: 1 });
  check(result, "notification fixture generated by real lead update workflow",
    changed.status === 200, { status: changed.status });
  await page.getByRole("button", { name: "Notifications" }).click();
  await page.getByText("Deal update — " + expected, { exact: true }).waitFor({ timeout: 15000 });
  const notifications = await api(page, sandbox, "GET", "/notifications?page=1&limit=20");
  const notificationRows = notifications.body?.data ?? [];
  const actualNotification = notificationRows.find(row => row.title === "Deal update — " + expected && row.body === expected);
  check(result, "notification API and visible UI contain Company — Customer fixture data",
    notifications.status === 200 && Boolean(actualNotification) && !hasOrdinalLabel(actualNotification?.title ?? "")
      && !hasOrdinalLabel(actualNotification?.body ?? ""),
    { status: notifications.status, matched: Boolean(actualNotification), count: notificationRows.length });
  await page.screenshot({ path: out + "/identity-notification.png", fullPage: true });
}

`;
  code = replaceOnce(code, "async function capture(label, webRoot) {", `${identitySweep}async function capture(label, webRoot) {`,
    "deal identity UI sweep helper");
  code = replaceOnce(code,
    "      await runBehaviorAssertions(behaviorPage, sandbox, result.fixture, result, out);",
    "      await runBehaviorAssertions(behaviorPage, sandbox, result.fixture, result, out);\n      await runDealIdentityVisualSweep(behaviorPage, sandbox, result.fixture, result, out);",
    "visual identity sweep runs after real behavior fixture setup");
  const campaignListInjection = `      if (args.includes("--resume-campaign-list")) {
        await page.setViewportSize({ width: 390, height: 900 });
        await page.goto(sandbox.url + "/campaigns");
        const expectedHeading = role === "rep" ? "Manager Access Required" : "Campaigns";
        const listHeading = page.getByRole("heading", { name: expectedHeading, exact: true });
        await listHeading.waitFor({ timeout: 15000 });
        const campaignTitle = "Nate workflow " + label + " disposable";
        if (role !== "rep") await page.getByRole("link", { name: campaignTitle, exact: true }).waitFor({ timeout: 15000 });
        const routePath = new URL(page.url()).pathname;
        const headingText = await listHeading.innerText();
        check(result, "resume " + role + " /campaigns list route renders its API-created fixture campaign",
          routePath === "/campaigns" && headingText === expectedHeading,
          { role, route: routePath, heading: headingText, campaignTitle });
        result.campaignListRoutes.push({ role, route: routePath, heading: headingText, campaignTitle });
        await page.screenshot({ path: out + "/campaigns-list-" + role + ".png", fullPage: true });
      }
      for (const width of widths) {`;
  code = replaceOnce(code, "      await sandbox.login(page, role);\n      for (const width of widths) {",
    `      await sandbox.login(page, role);\n${campaignListInjection}`, "resume /campaigns list route for each role");
  code = replaceOnce(code,
    "      await sandbox.login(behaviorPage, \"admin\");",
    `      await sandbox.login(behaviorPage, "admin");
      behaviorPage.on("pageerror", error => result.pageErrors.push("admin behavior: " + error.message));
      behaviorPage.on("console", message => { if (message.type() === "error") result.consoleErrors.push({ role: "admin", route: new URL(behaviorPage.url()).pathname, text: message.text() }); });
      behaviorPage.on("response", response => {
        const status = response.status();
        if (status >= 400) {
          const url = new URL(response.url());
          result.httpErrors.push({ context: "behavior-api", role: "admin", route: new URL(behaviorPage.url()).pathname, status, method: response.request().method(), path: url.pathname });
        }
      });`,
    "resume behavior request/console error instrumentation");
  code = replaceOnce(code,
    "      campaignAudienceSelected: selectedRouteNames.has(\"campaign-audience\"),",
    "      campaignAudienceSelected: !behaviorOnly && selectedRouteNames.has(\"campaign-audience\"),\n      resumeOnly: args.includes(\"--resume-only\"),\n      campaignListRoutes: result.campaignListRoutes,",
    "resume capture metadata and campaign list route evidence");
  code = replaceOnce(code,
    "      routes: routeCases.filter(([name]) => selectedRouteNames.has(name)).map(([name, path]) => ({ name, path })),",
    "      routes: behaviorOnly ? [] : routeCases.filter(([name]) => selectedRouteNames.has(name)).map(([name, path]) => ({ name, path })),",
    "resume route-capture metadata reflects skipped route sweep");
  const resumeExit = `if (args.includes("--resume-only")) {
  const behavior = JSON.parse(await readFile(evidenceRoot + "/after/assertions.json", "utf8"));
  const resumeReport = {
    verdict: failures.length ? "FAIL" : "PASS",
    mode: "behavior-identity-resume-only",
    routeCapturePerformed: false,
    preservedFullRouteEvidence: "runs/core-final/reports/nate-workflows/after",
    behaviorComplete: behavior.behaviorComplete,
    assertionCount: Object.keys(behavior.assertions ?? {}).length,
    failureCount: failures.length,
    failures,
    campaignListRoutes: behavior.assertions
      ? Object.entries(behavior.assertions).filter(([name]) => name.startsWith("resume ") && name.includes("/campaigns list")).map(([name, value]) => ({ name, ...value }))
      : [],
    httpErrors: behavior.httpErrors,
    consoleErrors: behavior.consoleErrors,
    screenshots: ["campaigns-list-admin.png", "campaigns-list-manager.png", "campaigns-list-rep.png",
      "resume-identity-referral-panel.png", "identity-cmdk-result.png", "identity-notification.png"],
  };
  await writeFile(evidenceRoot + "/core-resume-summary.json", JSON.stringify(resumeReport, null, 2));
  console.log(JSON.stringify(resumeReport, null, 2));
  if (failures.length) throw new Error(failures.join("\\n"));
  process.exit(0);
}
`;
  code = replaceOnce(code,
    'const before = JSON.parse(await readFile(`${evidenceRoot}/before/controls.json`, "utf8"));',
    `${resumeExit}const before = JSON.parse(await readFile(\`\${evidenceRoot}/before/controls.json\`, "utf8"));`,
    "resume-only report exits before structural recapture/comparison");
  const derived = join(runRoot, "nate-workflows-pinned-derived.mjs");
  await writeFile(derived, code);
  return { evidence, derived };
}

async function prepareSendSandbox(runRoot) {
  let helper = await readFile(pinned("scripts/visual-refresh/sandbox.mjs"), "utf8");
  helper = replaceOnce(helper, 'import { createReadStream, existsSync, statSync } from "node:fs";',
    'import { createReadStream, existsSync, statSync, readFileSync, writeFileSync } from "node:fs";',
    "fixture launch-gate fs imports");
  helper = replaceOnce(helper, 'const root = resolve(import.meta.dirname, "../..");',
    `const root = ${JSON.stringify(sourceRoot)};`, "fixture source root");
  helper = replaceOnce(helper,
    'await cp(join(root, "artifacts/api-server/dist"), apiSnapshot, { recursive: true });',
    'await cp(process.env.PREDEPLOY_FROZEN_API_DIST ?? join(root, "artifacts/api-server/dist"), apiSnapshot, { recursive: true });',
    "frozen API build source");
  const oldBlock = String.raw`if (/\/(?:twilio\/(?:call|sms)|email\/send|credit\/pull|campaigns\/[^/]+\/launch)/.test(req.url) && req.method !== "GET") {
          res.writeHead(403, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "External delivery prohibited by test runner" }));
        }`;
  const newBlock = String.raw`const actionUrl = new URL(req.url, "http://fixture.local");
        const launchPost = /^\/api\/campaigns\/\d+\/launch$/.test(actionUrl.pathname) && req.method === "POST";
        if (/\/twilio\/(?:call|sms)|\/email\/send|\/credit\/pull/.test(actionUrl.pathname) && req.method !== "GET") {
          res.writeHead(403, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "External delivery prohibited by test runner" }));
        }
        if (launchPost) {
          let gate = null, transport = null, provider = null;
          try { gate = JSON.parse(readFileSync(process.env.FOCUSED_LAUNCH_GATE_FILE, "utf8")); } catch {}
          try { transport = JSON.parse(readFileSync(process.env.FOCUSED_SENDGRID_READY_PATH, "utf8")); } catch {}
          try { provider = JSON.parse(readFileSync(process.env.FOCUSED_PROVIDER_READY_PATH, "utf8")); } catch {}
          const remaining = gate?.allowedPaths?.[actionUrl.pathname];
          const allowed = Number.isInteger(remaining) && remaining > 0
            && transport?.ready === true && transport?.inboundParseSecretUnset === true
            && provider?.ready === true && provider?.status === 202 && provider?.maxRequests === 14;
          if (!allowed) {
            res.writeHead(403, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ error: "Launch is restricted to Campaigns 1 and 5, with a 14-request maximum and local 202 transport capture" }));
          }
          gate.allowedPaths[actionUrl.pathname]--; gate.lastConsumedAt = new Date().toISOString();
          writeFileSync(process.env.FOCUSED_LAUNCH_GATE_FILE, JSON.stringify(gate, null, 2) + String.fromCharCode(10));
        }`;
  helper = replaceOnce(helper, oldBlock, newBlock, "campaign ID allowlist and bounded transport gate");
  const helperPath = join(runRoot, "pinned-sandbox-campaign-gated.mjs");
  await writeFile(helperPath, helper);
  const syntax = spawnSync(process.execPath, ["--check", helperPath], { encoding: "utf8" });
  check(syntax.status === 0, "report-local pinned sandbox derivative parses", syntax.stderr);
  return helperPath;
}

async function runCore(phase) {
  check(process.env.PREDEPLOY_MANAGED_RUN === "1", "browser phase requires Main's managed-task authorization");
  const ready = await readiness();
  const id = process.env.PREDEPLOY_RUN_ID ?? new Date().toISOString().replaceAll(":", "-");
  await mkdir(join(reportRoot, "runs"), { recursive: true });
  const runRoot = join(reportRoot, `runs/${id}`);
  await mkdir(runRoot, { recursive: false });
  const { evidence, derived } = await prepareNateHarness(runRoot, ready);
  const frozenApi = ready.record.candidateBuilds.find((build) => build.artifact === "frozen pinned API dist").root;
  const frozenWeb = ready.record.candidateBuilds.find((build) => build.artifact === "frozen pinned web dist/public").root;
  const args = [
    derived,
    "--phases=after",
    "--roles=admin,manager,rep",
    `--widths=${phase === "core-resume" ? "390" : "390,768"}`,
    "--routes=dashboard,leads,lead-detail,pipeline,deal-detail,new-deal,credit-compliance,apply,settings,campaign-audience",
    "--no-desktop",
    ...(phase === "core-resume" ? [
      "--behavior-only", "--resume-only", "--resume-identity-only", "--resume-campaign-list",
    ] : []),
    ...(phase === "structure" ? ["--skip-behavior"] : []),
  ];
  const env = {
    ...process.env,
    PREDEPLOY_FROZEN_API_DIST: frozenApi,
    NATE_CANDIDATE_WEB_ROOT: frozenWeb,
    NATE_BASELINE_WEB_ROOT: frozenWeb,
    PLAYWRIGHT_CHROMIUM_PATH: "/repl/tools/bin/chromium",
  };
  const result = spawnSync(process.execPath, args, { cwd: runRoot, env, encoding: "utf8", stdio: "inherit" });
  await writeFile(join(runRoot, "launcher-result.json"), JSON.stringify({
    phase, targetCommit: expectedCommit, archivedBaseline: "pinned structural-certification-2026-10-03/after/role-controls.json",
    approvalManifest: "pinned opt-in-recertification/approval-manifest.json",
    preflightStatusAtLaunch: ready.record.preflightStatus,
    routeCaptureRepeated: phase === "core-resume" ? false : null,
    resumedFullRouteEvidence: phase === "core-resume" ? "runs/core-final/reports/nate-workflows/after" : null,
    evidenceDirectory: evidence, derivedHarness: derived,
    childExitCode: result.status, childSignal: result.signal, appSourceModified: false, published: false,
  }, null, 2));
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}

async function runCampaignSend(phase = "campaign-send") {
  const campaign5Only = phase === "campaign-five";
  check(process.env.PREDEPLOY_MANAGED_RUN === "1", "campaign-send phase requires Main's managed-task authorization");
  const ready = await readiness();
  const productionRecord = await parse(join(reportRoot, "campaign-5-production-readonly.json"));
  const schemaContainsSentCount = productionRecord.columns?.success === true
    && productionRecord.columns.output.split(/\r?\n/).some((line) => line === "campaign_launches,campaign_id")
    && productionRecord.columns.output.split(/\r?\n/).some((line) => line === "campaign_launches,sent_count");
  const aggregateRow = productionRecord.result?.output.split(/\r?\n/).find((line) => line.startsWith("5,"));
  const [aggregateId, aggregateName, aggregateStatus, aggregateSent] = (aggregateRow ?? "").split(",");
  check(schemaContainsSentCount && productionRecord.result?.success === true
    && aggregateId === "5" && aggregateName === "Vendors — Heavy Equipment"
    && aggregateStatus === "completed" && Number(aggregateSent) === 13,
  "fixture seed inputs match sanitized read-only Campaign 5 aggregate and sent_count schema",
  { aggregateId, aggregateName, aggregateStatus, aggregateSent, schemaContainsSentCount });
  const id = process.env.PREDEPLOY_RUN_ID ?? `${campaign5Only ? "campaign-five" : "campaign-send"}-${new Date().toISOString().replaceAll(":", "-")}`;
  const runRoot = join(reportRoot, `runs/${id}`);
  await mkdir(join(reportRoot, "runs"), { recursive: true });
  await mkdir(runRoot, { recursive: false });
  const helperPath = await prepareSendSandbox(runRoot);

  const evidence = join(runRoot, "campaign5-fixture.json");
  const transportLog = join(runRoot, "sendgrid-transport.ndjson");
  const readyPath = join(runRoot, "sendgrid-interceptor-ready.json");
  const providerReadyPath = join(runRoot, "provider-ready.json");
  const gatePath = join(runRoot, "campaign-launch-allowlist.json");
  const maxProviderRequests = 14;
  const calls = [];
  const provider = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      let payload = null;
      try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch {}
      const call = { method: req.method, path: req.url, payload, responseStatus: 202 };
      call.responseStatus = req.method === "POST" && req.url === "/v3/mail/send"
        ? (calls.length < maxProviderRequests ? 202 : 429) : 404;
      calls.push(call);
      res.writeHead(call.responseStatus, { "x-message-id": "predeploy-local-transport-202" });
      res.end();
    });
  });
  await new Promise((resolvePromise) => provider.listen(0, "127.0.0.1", resolvePromise));
  const providerPort = provider.address().port;
  await writeFile(providerReadyPath, JSON.stringify({
    ready: true, status: 202, host: "127.0.0.1", port: providerPort, maxRequests: maxProviderRequests,
  }, null, 2));
  const envKeys = ["FOCUSED_SENDGRID_PORT", "FOCUSED_SENDGRID_READY_PATH", "FOCUSED_SENDGRID_TRANSPORT_LOG",
    "FOCUSED_PROVIDER_READY_PATH", "FOCUSED_LAUNCH_GATE_FILE", "PUBLIC_APP_URL", "NODE_OPTIONS",
    "PREDEPLOY_FROZEN_API_DIST"];
  const priorEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const preload = join(workspace, "reports/focused-final-8622188/sendgrid-transport-interceptor.cjs");
  process.env.FOCUSED_SENDGRID_PORT = String(providerPort);
  process.env.FOCUSED_SENDGRID_READY_PATH = readyPath;
  process.env.FOCUSED_SENDGRID_TRANSPORT_LOG = transportLog;
  process.env.FOCUSED_PROVIDER_READY_PATH = providerReadyPath;
  process.env.FOCUSED_LAUNCH_GATE_FILE = gatePath;
  process.env.PREDEPLOY_FROZEN_API_DIST =
    ready.record.candidateBuilds.find((build) => build.artifact === "frozen pinned API dist").root;
  const pinnedBrand = await readFile(join(sourceRoot, "artifacts/api-server/src/lib/brand.ts"), "utf8");
  const canonicalOrigin = pinnedBrand.match(/export const CANONICAL_APP_ORIGIN = "([^"]+)";/)?.[1];
  check(Boolean(canonicalOrigin), "fixture outbound origin derives from the verified pinned production URL policy");
  process.env.PUBLIC_APP_URL = canonicalOrigin;
  process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ""} --require=${preload}`.trim();
  let fixture, browser, report = {
    phase, campaign5Only, targetCommit: expectedCommit, oneRecipientAudience: 1,
    campaign5SyntheticAudience: 13, maxProviderRequests,
    fixtureSeedMethod: "actual API handlers", preflightStatusAtLaunch: ready.record.preflightStatus,
    parseSecretsSet: false, realProviderCalls: false,
  };
  try {
    const { startSandbox } = await import(pathToFileURL(helperPath).href);
    fixture = await startSandbox({
      build: false,
      webRoot: ready.record.candidateBuilds.find((build) => build.artifact === "frozen pinned web dist/public").root,
      port: Number(process.env.PREDEPLOY_FIXTURE_PORT ?? 4410),
    });
    const intercept = await parse(readyPath);
    check(intercept.ready === true && intercept.inboundParseSecretUnset === true
      && intercept.fakeApiKeyInstalled === true, "preload confirms fake key and Parse unset before API import", intercept);
    const requirePinned = createRequire(pinned("package.json"));
    const { chromium } = requirePinned("@playwright/test");
    browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
    const page = await context.newPage();
    await fixture.login(page, "admin");
    const callApi = async (method, path, body) => {
      const token = await page.evaluate(() => window.Clerk?.session?.getToken());
      const result = await page.evaluate(async ({ method, path, body, token }) => {
        const response = await fetch(`/api${path}`, {
          method, credentials: "include",
          headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const text = await response.text();
        let json = null; try { json = JSON.parse(text); } catch {}
        return { status: response.status, body: json, text };
      }, { method, path, body, token });
      return result;
    };
    const settings = await callApi("PUT", "/settings/email-delivery", {
      emailSendingEnabled: true, bulkEmailPerMinute: 20, bulkEmailPerDay: 20,
    });
    check(settings.status === 200 && settings.body?.emailSendingEnabled === true,
      "email sending enabled only in disposable fixture", settings);
    const singleRecipient = "contact@example.invalid";
    const singleReplyTo = "single-campaign-replies@example.invalid";
    const singleCreated = await callApi("POST", "/campaigns", {
      name: "Predeploy one-recipient Reply-To regression",
      channel: "email", emailTemplateId: 1, audienceRules: { pickedLeadIds: [1] },
      replyToEmail: singleReplyTo, flyerDeliveryMode: "attach",
    });
    const singleCampaignId = singleCreated.body?.id;
    check(singleCreated.status === 201 && singleCampaignId === 1,
      "one-recipient regression campaign is the first API-created campaign", singleCreated);

    const syntheticLeads = [];
    for (let index = 1; index <= 13; index++) {
      const email = `campaign5.recipient.${String(index).padStart(2, "0")}@example.invalid`;
      const createdLead = await callApi("POST", "/leads", {
        firstName: "Campaign5 Fixture", lastName: `Recipient ${String(index).padStart(2, "0")}`,
        email, phone: `+1202558${String(index).padStart(4, "0")}`,
        companyName: `Vendors — Heavy Equipment Fixture ${String(index).padStart(2, "0")}`,
        applicationType: "equipment", requestedAmount: 50000, leadSource: "manual",
      });
      check(createdLead.status === 201 && Number.isInteger(createdLead.body?.id),
        `Campaign 5 synthetic lead ${index} created through API`, { status: createdLead.status });
      if (createdLead.status === 201) syntheticLeads.push({ id: createdLead.body.id, email });
    }
    check(syntheticLeads.length === 13, "Campaign 5 synthetic fixture has exactly 13 API-created leads",
      { count: syntheticLeads.length });
    for (let index = 2; index <= 4; index++) {
      const sequenceCampaign = await callApi("POST", "/campaigns", {
        name: `Predeploy synthetic campaign sequence ${index}`, channel: "email",
        emailTemplateId: 1, audienceRules: {},
      });
      check(sequenceCampaign.status === 201 && sequenceCampaign.body?.id === index,
        `campaign fixture sequence slot ${index} created by API`, { status: sequenceCampaign.status, id: sequenceCampaign.body?.id });
    }
    const campaign5ReplyTo = "synthetic-replies@example.invalid";
    const created = await callApi("POST", "/campaigns", {
      name: "Vendors — Heavy Equipment",
      description: "Synthetic fixture derived from the sanitized read-only Campaign 5 aggregate.",
      channel: "email", emailTemplateId: 1,
      audienceRules: { pickedLeadIds: syntheticLeads.map((lead) => lead.id) },
      replyToEmail: campaign5ReplyTo, flyerDeliveryMode: "attach",
    });
    const campaignId = created.body?.id;
    check(created.status === 201 && campaignId === 5 && created.body?.name === "Vendors — Heavy Equipment",
      "Campaign 5 synthetic record created through campaign API with aggregate-derived identity", created);
    await writeFile(gatePath, JSON.stringify({
      allowedPaths: {
        "/api/campaigns/1/launch": campaign5Only ? 0 : 2,
        "/api/campaigns/5/launch": 2,
      },
      maxProviderRequests: 14,
    }, null, 2));

    let oneRecipientFailure = null;
    if (!campaign5Only) {
      const singlePreview = await callApi("POST", `/campaigns/${singleCampaignId}/preview`, {});
      check(singlePreview.status === 200 && singlePreview.body?.eligible?.length === 1
        && singlePreview.body.eligible[0]?.target === singleRecipient
        && singlePreview.body?.counts?.eligible === 1,
      "one-recipient campaign preview has exactly one eligible audience member", singlePreview.body);
      const singleDraftGuard = await callApi("POST", `/campaigns/${singleCampaignId}/launch`, {
        idempotencyKey: "predeploy-single-recipient-draft-guard", mode: "live",
      });
      check(singleDraftGuard.status === 409 && calls.length === 0,
        "one-recipient draft guard rejects before any provider transport", {
          status: singleDraftGuard.status, localProviderCalls: calls.length,
        });
      const singleApproval = await callApi("POST", `/campaigns/${singleCampaignId}/approve`, {
        approvalType: "content_and_audience", previewToken: singlePreview.body.previewToken, claimsAffirmed: true,
      });
      check(singleApproval.status === 200 && singleApproval.body?.status === "approved",
        "one-recipient campaign preview approved", singleApproval);
      const singleLaunch = await callApi("POST", `/campaigns/${singleCampaignId}/launch`, {
        idempotencyKey: "predeploy-approved-single-recipient", mode: "live",
      });
      const singleLaunchPassed = [200, 201].includes(singleLaunch.status)
        && singleLaunch.body?.sent === 1 && singleLaunch.body?.failed === 0;
      const singleResults = await callApi("GET", `/campaigns/${singleCampaignId}/results`);
      const singleDb = JSON.parse(fixture.query(`SELECT json_build_object(
        'campaign', (SELECT json_build_object('id',c.id,'status',c.status) FROM campaigns c WHERE c.id=${singleCampaignId}),
        'launches', COALESCE((SELECT json_agg(json_build_object(
          'id',l.id,'status',l.status,'eligibleCount',l.eligible_count,'excludedCount',l.excluded_count,
          'sentCount',l.sent_count,'failedCount',l.failed_count
        ) ORDER BY l.id) FROM campaign_launches l WHERE l.campaign_id=${singleCampaignId}), '[]'::json),
        'recipients', COALESCE((SELECT json_agg(json_build_object(
          'status',r.status,'channel',r.channel,'exclusionReason',r.exclusion_reason,
          'emailSendId',r.email_send_id,'emailStatus',e.status,'failureReason',e.failure_reason,
          'deliveryKind',e.delivery_kind
        ) ORDER BY r.id) FROM campaign_recipients r LEFT JOIN email_sends e ON e.id=r.email_send_id
          WHERE r.launch_id IN (SELECT id FROM campaign_launches WHERE campaign_id=${singleCampaignId})), '[]'::json),
        'activities', COALESCE((SELECT json_agg(json_build_object(
          'action',a.action,'fromStatus',a.from_status,'toStatus',a.to_status,
          'reason',a.details->>'reason','errorMessage',a.details->>'errorMessage',
          'failureCode',a.details->>'failureCode','errorCode',a.details->>'errorCode'
        ) ORDER BY a.id) FROM campaign_audit_events a WHERE a.campaign_id=${singleCampaignId}), '[]'::json)
      )`));
      const scrubDiagnosticText = (value) => String(value ?? "")
        .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redacted]")
        .replace(/(api[_-]?key|secret|token|signed[_ -]?url)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
        .replace(/https?:\/\/[^\s"'<>]+/gi, "[URL redacted]").slice(0, 400);
      const sanitize = (value) => ({
        ...value,
        recipients: (value.recipients ?? []).map((row) => ({
          ...row, failureReason: scrubDiagnosticText(row.failureReason),
          exclusionReason: scrubDiagnosticText(row.exclusionReason),
        })),
        activities: (value.activities ?? []).map((row) => ({
          ...row, reason: scrubDiagnosticText(row.reason), errorMessage: scrubDiagnosticText(row.errorMessage),
        })),
      });
      const sanitizedLedger = sanitize(singleDb);
      const providerCallsForSingle = calls.map((call) => ({
        method: call.method, path: call.path, responseStatus: call.responseStatus,
        recipientCount: call.payload?.personalizations?.flatMap((item) => item.to ?? []).length ?? 0,
        configuredReplyToPresent: call.payload?.reply_to?.email === singleReplyTo,
      }));
      let transportLogPresent = false;
      try { await readFile(transportLog, "utf8"); transportLogPresent = true; } catch {}
      const safeLaunchApi = {
        status: singleLaunch.status,
        launch: singleLaunch.body?.launch && {
          id: singleLaunch.body.launch.id, campaignId: singleLaunch.body.launch.campaignId,
          status: singleLaunch.body.launch.status, eligibleCount: singleLaunch.body.launch.eligibleCount,
          excludedCount: singleLaunch.body.launch.excludedCount, sentCount: singleLaunch.body.launch.sentCount,
          failedCount: singleLaunch.body.launch.failedCount,
        },
        sent: singleLaunch.body?.sent, failed: singleLaunch.body?.failed,
        error: scrubDiagnosticText(singleLaunch.body?.error),
      };
      const launchDiagnostic = {
        phase: "one-recipient", launchPassed: singleLaunchPassed,
        launchApi: safeLaunchApi,
        resultsApi: {
          status: singleResults.status, counts: singleResults.body?.counts,
          launches: (singleResults.body?.launches ?? []).map(({ id, status, eligibleCount, excludedCount, sentCount, failedCount }) =>
            ({ id, status, eligibleCount, excludedCount, sentCount, failedCount })),
        },
        fixtureLedger: sanitizedLedger, localTransport: providerCallsForSingle,
        transportLogPresent,
        parseSecretUnset: intercept.inboundParseSecretUnset, realProviderUsed: false,
      };
      await writeFile(join(runRoot, "one-recipient-campaign-diagnostic.json"), JSON.stringify(launchDiagnostic, null, 2));
      if (!singleLaunchPassed) {
        oneRecipientFailure = `one-recipient launch returned sent=${singleLaunch.body?.sent ?? "unknown"}, failed=${singleLaunch.body?.failed ?? "unknown"}`;
        await writeFile(join(runRoot, "one-recipient-campaign.json"), JSON.stringify({
          verdict: "FAIL", campaignId: singleCampaignId, audienceCount: 1,
          launchApi: launchDiagnostic.launchApi, diagnosticFile: "one-recipient-campaign-diagnostic.json",
          resultsApi: launchDiagnostic.resultsApi, fixtureLedger: sanitizedLedger,
          localTransport: providerCallsForSingle, realProviderUsed: false,
        }, null, 2));
        report.oneRecipientCampaign = { verdict: "FAIL", diagnosticFile: "one-recipient-campaign-diagnostic.json" };
      } else {
        check(true, "one-recipient campaign launch records exactly one successful send", singleLaunch);
        const singleCall = calls[0];
        const singleTo = singleCall?.payload?.personalizations?.flatMap((item) => item.to ?? []).map((item) => item.email);
        const singleCapturedReplyTo = singleCall?.payload?.reply_to?.email;
        check(calls.length === 1 && singleCall?.responseStatus === 202
          && singleCall?.method === "POST" && singleCall?.path === "/v3/mail/send"
          && singleTo?.length === 1 && singleTo[0] === singleRecipient
          && singleCapturedReplyTo === singleReplyTo,
        "one-recipient raw transport proves audience=1, Sent=1, exact target, and configured Reply-To",
        { providerCalls: calls.length, sentTo: singleTo, replyTo: singleCapturedReplyTo, configuredReplyTo: singleReplyTo });
        check(singleResults.status === 200 && singleResults.body?.counts?.sent === 1
          && singleResults.body?.launches?.[0]?.sentCount === 1
          && sanitizedLedger.campaign?.status === "completed"
          && sanitizedLedger.launches?.[0]?.status === "completed"
          && Number(sanitizedLedger.launches?.[0]?.sentCount) === 1
          && sanitizedLedger.recipients?.filter((row) => row.status === "sent").length === 1,
        "one-recipient campaign actual results API and disposable ledger each report Sent=1",
        { results: singleResults.body, ledger: sanitizedLedger });
        await writeFile(join(runRoot, "one-recipient-campaign.json"), JSON.stringify({
          verdict: "PASS", campaignId: singleCampaignId, audienceCount: 1,
          launchStatus: singleLaunch.status, launchApi: launchDiagnostic.launchApi,
          sentCount: singleLaunch.body?.sent, configuredReplyTo: singleReplyTo,
          providerCalls: calls.length, providerResponseStatus: calls[0]?.responseStatus,
          parseSecretUnset: intercept.inboundParseSecretUnset, realProviderUsed: false,
          resultsApi: singleResults.body?.counts, fixtureLedger: sanitizedLedger,
        }, null, 2));
      }
    } else {
      report.oneRecipientCampaign = { verdict: "NOT_RUN", reason: "campaign-five phase does not launch Campaign 1" };
    }

    const preview = await callApi("POST", `/campaigns/${campaignId}/preview`, {});
    const previewEmails = preview.body?.eligible?.map((entry) => entry.target).sort();
    check(preview.status === 200 && preview.body?.eligible?.length === 13
      && JSON.stringify(previewEmails) === JSON.stringify(syntheticLeads.map((lead) => lead.email).sort())
      && preview.body?.counts?.eligible === 13,
    "Campaign 5 preview resolves exactly 13 API-created synthetic recipients", preview.body);
    const draftGuard = await callApi("POST", `/campaigns/${campaignId}/launch`, {
      idempotencyKey: "predeploy-campaign5-draft-guard", mode: "live",
    });
    const expectedCallsBeforeCampaign5 = calls.length;
    check(draftGuard.status === 409 && calls.length === expectedCallsBeforeCampaign5, "Campaign 5 draft guard rejects before any additional provider transport", {
      status: draftGuard.status, localProviderCalls: calls.length,
    });
    const approval = await callApi("POST", `/campaigns/${campaignId}/approve`, {
      approvalType: "content_and_audience", previewToken: preview.body.previewToken, claimsAffirmed: true,
    });
    check(approval.status === 200 && approval.body?.status === "approved", "current Campaign 5 preview approved in fixture", approval);
    const launched = await callApi("POST", `/campaigns/${campaignId}/launch`, {
      idempotencyKey: "predeploy-campaign5-approved-thirteen", mode: "live",
    });
    check([200, 201].includes(launched.status) && launched.body?.sent === 13 && launched.body?.failed === 0,
      "separate Campaign 5 synthetic launch sends its 13-recipient audience through the campaign API handler", launched);
    const campaign5Calls = calls.slice(expectedCallsBeforeCampaign5);
    const sentRows = campaign5Calls.flatMap((call) => call.payload?.personalizations?.flatMap((item) => item.to ?? []) ?? []);
    const sentEmails = sentRows.map((entry) => entry.email).sort();
    const replyTos = campaign5Calls.map((call) => call.payload?.reply_to?.email);
    const expectedTotalCalls = expectedCallsBeforeCampaign5 + 13;
    check(calls.length === expectedTotalCalls && calls.length <= 14 && calls.every((call) => call.responseStatus === 202
      && call.method === "POST" && call.path === "/v3/mail/send"),
    campaign5Only ? "Campaign 5-only phase makes exactly 13 simulated SDK requests (hard maximum 14)"
      : "Campaign 5 makes exactly 13 additional simulated SDK requests (hard maximum 14 total)",
    { calls: calls.length, oneRecipientCalls: campaign5Only ? 0 : 1, campaign5Calls: campaign5Calls.length });
    check(JSON.stringify(sentEmails) === JSON.stringify(syntheticLeads.map((lead) => lead.email).sort())
      && campaign5Calls.length === 13
      && campaign5Calls.every((call) => (call.payload?.personalizations?.flatMap((item) => item.to ?? []) ?? []).length === 1)
      && replyTos.length === 13 && replyTos.every((value) => value === campaign5ReplyTo),
    "Campaign 5 SDK payloads independently contain exactly its 13 synthetic recipients and configured Reply-To",
    { sentEmails, replyTos });
    const dbState = JSON.parse(fixture.query(`SELECT row_to_json(q) FROM (
      SELECT c.id,c.status,l.status AS launch_status,l.sent_count,
        (SELECT count(*) FROM campaign_recipients r WHERE r.campaign_id=c.id AND r.status='sent') AS sent_recipients
      FROM campaigns c JOIN campaign_launches l ON l.campaign_id=c.id WHERE c.id=${campaignId}
    ) q`));
    check(dbState.status === "completed" && dbState.launch_status === "completed"
      && Number(dbState.sent_count) === 13 && Number(dbState.sent_recipients) === 13,
    "synthetic Campaign 5 ledger records exactly 13 completed sends using sent_count", dbState);
    const resultsApi = await callApi("GET", `/campaigns/${campaignId}/results`);
    check(resultsApi.status === 200 && resultsApi.body?.counts?.sent === 13
      && resultsApi.body?.launches?.[0]?.sentCount === 13,
    "separate Campaign 5 actual results API reports Sent=13", resultsApi.body);
    await page.goto(`${fixture.url}/campaigns/${campaignId}`);
    await page.getByRole("heading", { name: "Vendors — Heavy Equipment" }).waitFor({ timeout: 20000 });
    await page.getByRole("tab", { name: "Results", exact: true }).click();
    await page.getByText("Campaign Results", { exact: true }).waitFor({ timeout: 15000 });
    const sentValue = page.locator("div.rounded-lg").filter({ hasText: "Sent" }).getByText("13", { exact: true }).first();
    await sentValue.waitFor({ timeout: 15000 });
    const visibleSentValue = await sentValue.innerText();
    const campaignUiText = await page.locator("body").innerText();
    check(visibleSentValue.trim() === "13" && await sentValue.isVisible(), "Campaign 5 fixture UI displays Campaign Results Sent=13",
      campaignUiText.includes("Campaign Results") && campaignUiText.includes("Sent")
        && visibleSentValue.trim() === "13", { campaignId, sentText: visibleSentValue });
    await page.screenshot({ path: join(runRoot, "campaign5-fixture-results-sent-13.png"), fullPage: true });
    report = {
      ...report, verdict: oneRecipientFailure ? "FAIL" : "PASS", campaignId, campaignName: created.body.name,
      previewStatus: preview.status, previewEligible: preview.body.counts.eligible, approvalStatus: approval.status,
      launchStatus: launched.status, configuredReplyTo: campaign5ReplyTo, recipientCount: sentRows.length,
      capturedReplyTos: [...new Set(replyTos)],
      ...(oneRecipientFailure ? { oneRecipientFailure } : {}),
      oneRecipientCampaign: report.oneRecipientCampaign?.verdict === "FAIL"
        ? report.oneRecipientCampaign
        : (campaign5Only ? report.oneRecipientCampaign : {
          evidence: "one-recipient-campaign.json", campaignId: singleCampaignId, audienceCount: 1,
          sentCount: 1, configuredReplyTo: singleReplyTo,
          capturedReplyTo: calls[0]?.payload?.reply_to?.email,
        }),
      transport: {
        calls: calls.length, maxRequests: maxProviderRequests,
        campaignIdsAllowed: [1, 5], allStatus202: calls.every((call) => call.responseStatus === 202),
        destination: "127.0.0.1", realProviderUsed: false,
      },
      parseSecretUnset: intercept.inboundParseSecretUnset, fixtureLedger: dbState,
      resultsApi: resultsApi.body.counts,
      productionAggregate: { id: Number(aggregateId), name: aggregateName, status: aggregateStatus, sent: Number(aggregateSent) },
      fixtureVersusProduction: "synthetic fixture completed via candidate APIs + loopback transport; production value read-only",
      screenshots: ["campaign5-fixture-results-sent-13.png"],
    };
    await writeFile(evidence, JSON.stringify(report, null, 2));
    await writeFile(join(runRoot, "sendgrid-captured-body.json"), JSON.stringify({
      campaign1OneRecipient: campaign5Only ? [] : calls.slice(0, 1).map((call) => call.payload),
      campaign5SyntheticThirteen: campaign5Calls.map((call) => call.payload),
    }, null, 2));
    console.log(JSON.stringify(report, null, 2));
    await context.close();
    if (oneRecipientFailure) process.exitCode = 1;
  } catch (error) {
    report.verdict = "FAIL";
    report.failure = String(error?.stack ?? error);
    await writeFile(evidence, JSON.stringify(report, null, 2));
    throw error;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (fixture) await fixture.close().catch(() => {});
    await new Promise((resolvePromise) => provider.close(resolvePromise));
    for (const key of envKeys) {
      if (priorEnv[key] === undefined) delete process.env[key]; else process.env[key] = priorEnv[key];
    }
  }
}

async function prepareOnly() {
  const source = await validatePinnedEvidence();
  const id = `prepare-${new Date().toISOString().replaceAll(":", "-")}`;
  await mkdir(join(reportRoot, "runs"), { recursive: true });
  const runRoot = join(reportRoot, `runs/${id}`);
  await mkdir(runRoot, { recursive: false });
  const { evidence, derived } = await prepareNateHarness(runRoot, source);
  const syntax = spawnSync(process.execPath, ["--check", derived], { encoding: "utf8" });
  const sendSandbox = await prepareSendSandbox(runRoot);
  const sendSmoke = spawnSync(process.execPath, ["--check", sendSandbox], { encoding: "utf8" });
  const preparation = {
    status: syntax.status === 0 ? "PREPARED_NO_BROWSER" : "HARNESS_SYNTAX_FAILURE",
    targetCommit: expectedCommit, archivedCases: Object.keys(source.baseline).length,
    sourcePinTree: source.pin.tree, approvalManifest: "pinned reports/opt-in-recertification/approval-manifest.json",
    archivedControls: "pinned reports/structural-certification-2026-10-03/after/role-controls.json",
    archivedExemptions: "pinned reports/structural-certification-2026-10-03/after/exempt-controls.json",
    derivedHarness: derived, evidenceDirectory: evidence, browserLaunched: false,
    syntaxExitCode: syntax.status, syntaxError: syntax.stderr || null,
    sendSandboxDerivative: sendSandbox, sendSandboxSyntaxExitCode: sendSmoke.status,
    sendSandboxSyntaxError: sendSmoke.stderr || null,
  };
  await writeFile(join(runRoot, "preparation-proof.json"), JSON.stringify(preparation, null, 2));
  console.log(JSON.stringify(preparation, null, 2));
  if (syntax.status !== 0 || sendSmoke.status !== 0) process.exitCode = 1;
}

const phase = process.argv.find((arg) => arg.startsWith("--phase="))?.split("=")[1];
if (process.argv.includes("--check-ready-only")) {
  await readiness();
} else if (process.argv.includes("--freeze-builds-only")) {
  await freezeBuildsOnly();
} else if (process.argv.includes("--prepare-only")) {
  await prepareOnly();
} else if (phase === "structure" || phase === "core" || phase === "core-resume") {
  await runCore(phase);
} else if (phase === "campaign-send" || phase === "campaign-five") {
  await runCampaignSend(phase);
} else {
  console.log("Usage: node reports/predeploy-c6fc40f/run-predeploy.mjs --check-ready-only | --freeze-builds-only | --prepare-only | --phase=structure|core|core-resume|campaign-send|campaign-five");
  process.exitCode = 2;
}
