// Independent, screenshots-only continuation. It never repeats role, Leads
// interaction, Campaign, structure, or 11-gate checks. Source-check mode is
// read-only and must not start Playwright, Clerk, or a fixture.
import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import {
  appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync,
} from "node:fs";
import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { startSandbox } from "../../scripts/visual-refresh/sandbox.mjs";

const root = resolve(import.meta.dirname, "../..");
const reportRoot = join(root, "reports/role-directory-certification");
const lockPath = join(reportRoot, "launch-authorization.json");
const bindingPath = join(reportRoot, "final-source-binding.json");
const authPath = resolve(root, "artifacts/mbs-crm/src/pages/leads.tsx");
const apiSourcePath = join(root, "artifacts/api-server/src");
const apiDistPath = join(root, "artifacts/api-server/dist");
const MOBILE_CARD_SELECTOR = '[class~="md:hidden"] > div.rounded-lg.border.bg-card';
const widths = [390, 768, 1280, 1440];
const themes = process.argv.includes("--dark-only") ? ["dark"] : ["light", "dark"];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const shaFile = (path) => sha256(readFileSync(path));
const check = (ok, message) => { if (!ok) throw new Error(message); };

async function shaTree(directory) {
  const hash = createHash("sha256");
  const treeRoot = directory;
  async function visit(folder, rel = "") {
    for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(rel, entry.name);
      if (entry.isDirectory()) await visit(join(folder, entry.name), path);
      else if (entry.isFile()) {
        hash.update(path); hash.update("\0"); hash.update(readFileSync(join(treeRoot, path))); hash.update("\0");
      }
    }
  }
  await visit(directory);
  return hash.digest("hex");
}

async function sourceReady() {
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  const binding = JSON.parse(readFileSync(bindingPath, "utf8"));
  const expected = {
    webSource: lock.candidateWebSourceTreeSha256,
    apiSource: lock.candidateApiSourceTreeSha256,
    webTree: lock.candidateWebTreeSha256,
    webIndex: lock.candidateIndexSha256,
    apiDist: lock.candidateApiDistSha256,
  };
  check(lock.sourceFinalized === true && lock.elevenGatePreflightExit === 0
    && lock.immutablePinsFrozen === true && lock.launchAuthorized === true,
  "Existing source authorization is not ready; this script will not run preflight.");
  check(binding.candidate === lock.targetRevision, "Frozen source-binding revision differs from launch authorization.");
  check(lock.preflightEvidence?.exitCode === 0
    && shaFile(resolve(root, lock.preflightEvidence.path)) === lock.preflightEvidence.sha256,
  "Previously passed 11-gate evidence is missing or changed; no gates were rerun.");
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  check(head.status === 0 && head.stdout.trim() === lock.localSnapshot,
    "Local source snapshot differs from the immutable launch authorization.");
  const webRoot = resolve(root, lock.candidateWebRoot);
  check(webRoot.startsWith(root + "/") && existsSync(join(webRoot, "index.html")), "Pinned frozen frontend build is missing.");
  const actual = {
    webSource: await shaTree(join(root, "artifacts/mbs-crm/src")),
    apiSource: await shaTree(apiSourcePath),
    webTree: await shaTree(webRoot),
    webIndex: shaFile(join(webRoot, "index.html")),
    apiDist: await shaTree(apiDistPath),
  };
  for (const key of Object.keys(expected)) check(actual[key] === expected[key], `${key} hash differs from the authorized frozen pin.`);
  const leadsSource = readFileSync(authPath, "utf8");
  check(leadsSource.includes('className="md:hidden space-y-3"')
    && leadsSource.includes("rounded-lg border bg-card p-4 space-y-2"),
  "Mobile lead-card markup no longer matches the inspected Leads source selector.");
  return { lock, binding, expected, actual, localSnapshot: head.stdout.trim() };
}

function safeUrl(raw) {
  try {
    const url = new URL(raw);
    url.search = ""; url.hash = "";
    url.pathname = url.pathname
      .replace(/(\/api\/(?:leads|deals|users|contacts)\/)[^/]+/gi, "$1[REDACTED_ID]")
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]");
    return `${url.origin}${url.pathname}`;
  } catch { return "[unparseable-url]"; }
}

function jsonFile(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

async function capture() {
  const ready = await sourceReady();
  const lock = ready.lock;
  const runName = `shots-only-${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`;
  const output = join(reportRoot, "continuation/runs", runName);
  const shots = join(output, "screenshots");
  mkdirSync(shots, { recursive: true });
  const network = [], cdpNetwork = [], consoleErrors = [], pageErrors = [], requestFailures = [];
  const screenshotProofs = [];
  let browser, fixture, context, page, cdp;
  let failure = null, fixtureClosed = false;
  const append = (name, record) => appendFileSync(join(output, name), `${JSON.stringify(record)}\n`);
  const safeText = (value) => String(value ?? "").replace(/[\r\n\t]+/g, " ").slice(0, 600);

  try {
    fixture = await startSandbox({
      build: false,
      webRoot: resolve(root, lock.candidateWebRoot),
      port: lock.port,
    });
    browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", headless: true });
    context = await browser.newContext({
      viewport: { width: 390, height: 900 }, colorScheme: "light",
      reducedMotion: "reduce", serviceWorkers: "block",
    });
    page = await context.newPage();
    page.setDefaultTimeout(15000);
    cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    cdp.on("Network.responseReceived", (event) => {
      const row = { type: "response", status: event.response.status, url: safeUrl(event.response.url), at: new Date().toISOString() };
      cdpNetwork.push(row); append("cdp-network-events.ndjson", row);
    });
    cdp.on("Network.loadingFailed", (event) => {
      const row = { type: "loadingFailed", error: safeText(event.errorText), canceled: !!event.canceled, at: new Date().toISOString() };
      cdpNetwork.push(row); append("cdp-network-events.ndjson", row);
    });
    page.on("response", (response) => {
      const row = { method: response.request().method(), status: response.status(), url: safeUrl(response.url()), at: new Date().toISOString() };
      network.push(row); append("pwr-response-events.ndjson", row);
    });
    page.on("console", (message) => {
      if (message.type() === "error") {
        const row = { text: safeText(message.text()), url: safeUrl(message.location().url), at: new Date().toISOString() };
        consoleErrors.push(row); append("console-errors.ndjson", row);
      }
    });
    page.on("pageerror", (error) => {
      const row = { text: safeText(error.message), at: new Date().toISOString() };
      pageErrors.push(row); append("page-errors.ndjson", row);
    });
    page.on("requestfailed", (request) => {
      const row = { method: request.method(), url: safeUrl(request.url()), error: safeText(request.failure()?.errorText), at: new Date().toISOString() };
      requestFailures.push(row); append("request-failures.ndjson", row);
    });

    // Real Clerk ticket auth, restricted to the disposable fixture's admin;
    // no role probes or application interaction journeys are executed.
    await fixture.login(page, "admin");
    await page.goto(`${fixture.url}/settings`);
    const themeControl = page.getByLabel("Appearance theme");
    await themeControl.waitFor({ state: "visible" });

    for (const theme of themes) {
      await page.goto(`${fixture.url}/settings`);
      await themeControl.selectOption(theme);
      await page.waitForFunction((value) => document.documentElement.getAttribute("data-appearance") === value, theme);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        const leadsResponsePromise = page.waitForResponse((response) =>
          response.request().method() === "GET" && new URL(response.url()).pathname === "/api/leads",
        { timeout: 20000 });
        await page.goto(`${fixture.url}/leads`);
        const leadsResponse = await leadsResponsePromise;
        check(leadsResponse.status() === 200, `GET /api/leads returned ${leadsResponse.status()} at ${width}px/${theme}.`);
        const heading = page.getByRole("heading", { level: 1, name: "Leads", exact: true });
        await heading.waitFor({ state: "visible" });
        const readiness = { h1: await heading.innerText(), viewportWidth: width, theme, apiStatus: leadsResponse.status() };

        if (width < 768) {
          // Derived from leads.tsx: mobile branch is md:hidden; each lead is
          // a direct child card with rounded-lg border bg-card classes.
          const cards = page.locator(MOBILE_CARD_SELECTOR);
          await cards.first().waitFor({ state: "visible" });
          const visibleCards = await cards.evaluateAll((els) => els.filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
          }).length);
          check(visibleCards > 0, `No visible mobile lead cards at ${width}px/${theme}.`);
          readiness.mobileCardSelector = MOBILE_CARD_SELECTOR;
          readiness.visibleCardCount = visibleCards;
        } else {
          // Tablet keeps the legacy table; only larger widths use the fit table.
          // Both render real lead anchors, unlike skeleton/empty-state rows.
          const rows = page.locator('table:visible tbody tr:has(a[href*="/leads/"])');
          await rows.first().waitFor({ state: "visible" });
          readiness.visibleDesktopRows = await rows.count();
          check(readiness.visibleDesktopRows > 0, `No visible desktop lead rows at ${width}px/${theme}.`);
        }
        check(await page.locator("html").getAttribute("data-appearance") === theme,
          `Requested ${theme} theme is not active at ${width}px.`);
        const geometry = await page.evaluate(() => ({
          viewport: { width: innerWidth, height: innerHeight },
          document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
        }));
        const filename = `leads-${width}-${theme}.png`;
        const imagePath = join(shots, filename);
        await page.screenshot({ path: imagePath, animations: "disabled" });
        const proof = {
          path: `screenshots/${filename}`, sha256: shaFile(imagePath), viewport: { width, height: 900 },
          theme, pageUrl: safeUrl(page.url()), apiUrl: safeUrl(leadsResponse.url()),
          apiStatus: leadsResponse.status(), readiness, geometry, capturedAt: new Date().toISOString(),
        };
        screenshotProofs.push(proof);
        append("screenshot-events.ndjson", proof);
      }
    }
    check(screenshotProofs.length === widths.length * themes.length,
      `Expected ${widths.length * themes.length} screenshots; captured ${screenshotProofs.length}.`);
    const imageFiles = screenshotProofs.map((shot) => join(output, shot.path));
    const galleryFigures = screenshotProofs.map((shot, index) => {
      const data = readFileSync(imageFiles[index]).toString("base64");
      return `<figure><img src="data:image/png;base64,${data}" alt="${shot.viewport.width}px ${shot.theme}"><figcaption>${shot.viewport.width} × ${shot.viewport.height} · ${shot.theme}<br><code>${shot.path}</code><br>SHA-256: <code>${shot.sha256}</code></figcaption></figure>`;
    }).join("\n");
    writeFileSync(join(output, "gallery.html"), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Leads responsive screenshots</title><h1>Leads — light/dark responsive captures</h1><p>Eight images are embedded in this standalone gallery. Schema-only isolated fixture; not production-data certification.</p><main>${galleryFigures}</main><style>body{font:16px system-ui;margin:2rem;background:#f6f7f9;color:#111}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem}figure{margin:0;padding:1rem;background:white;border:1px solid #bbb;border-radius:8px}img{display:block;max-width:100%;height:auto;border:1px solid #aaa}figcaption{font-size:12px;margin-top:.5rem;overflow-wrap:anywhere}</style>`);
    jsonFile(join(output, "screenshots-evidence.json"), {
      status: "passed", count: screenshotProofs.length, order: themes.flatMap((theme) => widths.map((width) => `${width}/${theme}`)),
      targetRevision: lock.targetRevision, localSnapshot: ready.localSnapshot,
      sourceAndBuildPins: { expected: ready.expected, actual: ready.actual },
      mobileCardSelector: MOBILE_CARD_SELECTOR, screenshots: screenshotProofs,
      noRoleChecks: true, noLeadsInteractionJourney: true, noCampaignChecks: true,
    });
  } catch (error) {
    failure = safeText(error.stack ?? error);
    jsonFile(join(output, "failure.json"), { status: "failed", message: failure, screenshotsCaptured: screenshotProofs.length, at: new Date().toISOString() });
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (fixture) {
      try { await fixture.close(); fixtureClosed = true; }
      catch (error) { failure ??= `Fixture cleanup failed: ${safeText(error.message)}`; }
    }
    jsonFile(join(output, "cleanup-verification.json"), {
      fixtureClosed, disposableSchemaDbAndClerkUsersRemovedBySandboxClose: fixtureClosed,
      at: new Date().toISOString(),
    });
    jsonFile(join(output, "network-summary.json"), {
      pwrResponses: network.length, pwrStatusCounts: Object.fromEntries([...new Set(network.map((x) => x.status))].sort().map((s) => [s, network.filter((x) => x.status === s).length])),
      cdpEvents: cdpNetwork.length, cdpStatusCounts: Object.fromEntries([...new Set(cdpNetwork.filter((x) => x.type === "response").map((x) => x.status))].sort().map((s) => [s, cdpNetwork.filter((x) => x.type === "response" && x.status === s).length])),
      consoleErrors: consoleErrors.length, pageErrors: pageErrors.length, requestFailures: requestFailures.length,
      safeUrlsOnly: true,
    });
  }
  if (failure) throw new Error(`${failure}\nEvidence directory: ${output}`);
  console.log(JSON.stringify({ status: "passed", evidenceDirectory: output, screenshots: screenshotProofs.length, gallery: join(output, "gallery.html") }, null, 2));
}

if (process.argv.includes("--check-source-ready-only")) {
  const ready = await sourceReady();
  console.log(JSON.stringify({
    status: "SOURCE_READY; no browser, fixture, auth, or output directory created",
    targetRevision: ready.lock.targetRevision,
    localSnapshot: ready.localSnapshot,
    hashes: ready.actual,
    runnerSha256: shaFile(join(reportRoot, "shots-only-runner.mjs")),
    exactPrepareCheckCommand: "node reports/role-directory-certification/shots-only-runner.mjs --check-source-ready-only",
    exactCaptureCommand: "node reports/role-directory-certification/shots-only-runner.mjs --capture",
  }, null, 2));
} else if (process.argv.includes("--capture")) {
  await capture();
} else {
  console.log("Usage: node reports/role-directory-certification/shots-only-runner.mjs --check-source-ready-only | --capture");
  process.exitCode = 2;
}
