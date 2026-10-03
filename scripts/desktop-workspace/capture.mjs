import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { startSandbox } from "../visual-refresh/sandbox.mjs";
import { waitForPage } from "../visual-refresh/readiness.mjs";

const output = "reports/desktop-workspace-release";
const baselineRoot = resolve(".local/certification-2af927c/baselines/target-2af927c");
const pages = [["dashboard", "/dashboard"], ["leads", "/leads"], ["lead-detail", "/leads/1"], ["pipeline", "/deals"], ["apply", "/apply"], ["settings", "/settings"]];
const widths = [390, 768, 1024, 1280, 1440];
const snapshots = {};
const onlyPhase = process.argv.includes("--baseline-only") ? "baseline" : process.argv.includes("--target-only") ? "target" : null;
if (onlyPhase) {
  const previous = JSON.parse(await readFile(`${output}/structure-and-screenshots.json`));
  const retained = onlyPhase === "baseline" ? "target" : "baseline";
  snapshots[retained] = {
    controls: JSON.parse(await readFile(`${output}/${retained}/role-controls.json`)),
    exemptions: JSON.parse(await readFile(`${output}/${retained}/exempt-controls.json`)),
    screenshots: previous[`${retained}Screenshots`],
  };
}
const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", headless: true });
// One fixture server for both frozen baseline and target: identical consent,
// ownership, authentication and clock. No API responses are mocked.
const sandbox = await startSandbox({ build: false, port: 4320 });
const errors = [];
try {
  for (const phase of onlyPhase ? [onlyPhase] : ["baseline", "target"]) {
    await mkdir(`${output}/${phase}`, { recursive: true });
    const controls = {}, exemptions = {}, screenshots = [];
    for (const role of ["admin", "manager", "rep"]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", reducedMotion: "reduce", serviceWorkers: "block" });
      if (phase === "baseline") {
        // Serve the exact retained baseline bytes, with the same isolated API.
        await context.route("**/*", async route => {
          const url = new URL(route.request().url());
          if (url.origin !== sandbox.url || url.pathname.startsWith("/api/")) return route.continue();
          // The app's update detector fetches "/" as HTML independently of
          // document navigation. It must see the retained build ID too.
          const isHtml = route.request().resourceType() === "document" || route.request().headers().accept?.includes("text/html");
          if (!isHtml && !/\.(?:js|css|woff2?|png|svg|webp|ico|jpg|json|webmanifest)$/.test(url.pathname)) return route.continue();
          const path = isHtml ? "index.html" : decodeURIComponent(url.pathname).replace(/^\//, "");
          if (path.split("/").includes("..")) throw new Error("Unsafe baseline path");
          try {
            const bytes = await readFile(`${baselineRoot}/${path}`);
            const ext = path.split(".").pop();
            const types = { html: "text/html", js: "application/javascript", css: "text/css", svg: "image/svg+xml", png: "image/png", ico: "image/x-icon", woff2: "font/woff2", jpg: "image/jpeg", webp: "image/webp", json: "application/json", webmanifest: "application/manifest+json" };
            await route.fulfill({ status: 200, contentType: types[ext] || "application/octet-stream", body: bytes });
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
            await route.fulfill({ status: 404, contentType: "text/plain", body: `Missing retained baseline asset: ${path}` });
          }
        });
      }
      const page = await context.newPage();
      page.on("pageerror", error => errors.push({ phase, role, message: error.message }));
      await sandbox.login(page, role);
      for (const width of phase === "baseline" || role !== "admin" ? [390, 768] : widths) {
        await page.setViewportSize({ width, height: 900 });
        for (const [name, path] of pages) {
          if (width >= 1024 && name === "apply") continue;
          await page.goto(sandbox.url + path, { waitUntil: "networkidle" });
          await waitForPage(page, name);
          const key = `${name}-${width}-${role}`;
          if (width < 1024) {
            const captured = await page.locator("button,a,input,select,textarea,[role=combobox],[contenteditable=true]").evaluateAll(elements => {
              const describe = el => ({
                tag: el.tagName, role: el.getAttribute("role"), type: el.getAttribute("type"),
                name: el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.textContent?.trim().replace(/\s+/g, " "),
                href: el.getAttribute("href"), disabled: el.hasAttribute("disabled"),
              });
              const exempt = el => !!el.closest("[data-appearance-control],nav[aria-label='Record actions']");
              return { controls: elements.filter(el => !exempt(el)).map(describe), exemptions: elements.filter(exempt).map(describe) };
            });
            controls[key] = captured.controls;
            exemptions[key] = captured.exemptions;
          }
          if (role === "admin" && name !== "apply") {
            const file = `${name}-${width}-light.png`;
            await page.screenshot({ path: `${output}/${phase}/${file}` });
            screenshots.push(file);
          }
          console.log(`${phase} ${key}`);
        }
      }
      if (role === "admin") {
        await page.goto(`${sandbox.url}/settings`);
        await waitForPage(page, "settings");
        await page.getByLabel("Appearance theme").selectOption("dark");
        for (const width of phase === "baseline" ? [390, 768] : widths) {
          await page.setViewportSize({ width, height: 900 });
          for (const [name, path] of pages.filter(([name]) => name !== "apply")) {
            await page.goto(sandbox.url + path, { waitUntil: "networkidle" });
            await waitForPage(page, name);
            assert.equal(await page.locator("html").getAttribute("data-appearance"), "dark");
            const file = `${name}-${width}-dark.png`;
            await page.screenshot({ path: `${output}/${phase}/${file}` });
            screenshots.push(file);
          }
        }
      }
      await context.close();
    }
    snapshots[phase] = { controls, exemptions, screenshots };
    await writeFile(`${output}/${phase}/role-controls.json`, JSON.stringify(controls, null, 2));
    await writeFile(`${output}/${phase}/exempt-controls.json`, JSON.stringify(exemptions, null, 2));
  }
  const certified = JSON.parse(await readFile("reports/structural-certification-2026-10-03/after/role-controls.json"));
  const certifiedExempt = JSON.parse(await readFile("reports/structural-certification-2026-10-03/after/exempt-controls.json"));
  const comparisons = Object.keys(snapshots.baseline.controls).map(key => ({
    key,
    controlsEqual: JSON.stringify(snapshots.baseline.controls[key]) === JSON.stringify(snapshots.target.controls[key]),
    exemptionsEqual: JSON.stringify(snapshots.baseline.exemptions[key]) === JSON.stringify(snapshots.target.exemptions[key]),
    certifiedInventoryEqual: JSON.stringify(certified[key]) === JSON.stringify(snapshots.target.controls[key]),
    certifiedExemptionsEqual: JSON.stringify(certifiedExempt[key]) === JSON.stringify(snapshots.target.exemptions[key]),
  }));
  const baselineIndex = await readFile(`${baselineRoot}/index.html`);
  await writeFile(`${output}/structure-and-screenshots.json`, JSON.stringify({
    baselineRevision: "2af927ca2830926bf325cef2eecfffc24ab5c110",
    baselineIndexSha256: createHash("sha256").update(baselineIndex).digest("hex"),
    comparisons, newExceptions: [], widths, height: 900,
    targetScreenshots: snapshots.target.screenshots, baselineScreenshots: snapshots.baseline.screenshots,
    errors, authentication: "Real development Clerk ticket, not password/SSO certification",
    fixtures: "Identical disposable schema-only test clone, synthetic records; live delivery credentials removed",
  }, null, 2));
  assert.equal(comparisons.length, 36);
  assert.ok(comparisons.every(row => row.controlsEqual && row.exemptionsEqual && row.certifiedInventoryEqual && row.certifiedExemptionsEqual), "Strict mobile control mismatch; no new exemptions allowed");
  assert.equal(snapshots.target.screenshots.length, 50);
  assert.equal(snapshots.baseline.screenshots.length, 20);
  assert.deepEqual(errors, []);
  console.log("STRUCTURE PASS 36/36 — exact certified inventory and fresh matched baseline; SCREENSHOTS PASS 50 target + 20 baseline");
} finally {
  await browser.close();
  await sandbox.close();
}