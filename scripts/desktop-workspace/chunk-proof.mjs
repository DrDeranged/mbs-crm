import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { startSandbox } from "../visual-refresh/sandbox.mjs";

const output = "reports/desktop-workspace-release";
const sandbox = await startSandbox({ build: false, port: 4360 });
const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
const page = await context.newPage();
try {
  await mkdir(output, { recursive: true });
  await sandbox.login(page);
  await page.goto(`${sandbox.url}/dashboard`, { waitUntil: "networkidle" });
  await expect(page.locator("h1")).toContainText("Dashboard");
  const buildId = await page.locator('meta[name="mbs-build-id"]').getAttribute("content");
  assert.ok(buildId);
  let documents = 0;
  const failedChunks = [];
  page.on("request", request => { if (request.resourceType() === "document") documents++; });
  await page.route("**/assets/settings-*.js", async route => {
    if (!failedChunks.length) {
      failedChunks.push(route.request().url());
      await route.abort("failed");
    } else await route.continue();
  });
  await page.evaluate(() => {
    const observe = new MutationObserver(() => {
      if ([...document.querySelectorAll("h2")].some(el => el.textContent === "Something went wrong")) {
        sessionStorage.setItem("chunk-proof-boundary-seen", "1");
      }
    });
    observe.observe(document.body, { childList: true, subtree: true });
    history.pushState(null, "", "/settings");
  });
  await expect(page.locator("h1")).toContainText("Settings", { timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  assert.equal(failedChunks.length, 1, "A real lazy import must actually fail");
  assert.equal(documents, 1, "Exactly one guarded document reload");
  const recovered = await page.evaluate(build => ({
    guard: sessionStorage.getItem(`mbs-chunk-reload:${build}`),
    errorBoundarySeen: sessionStorage.getItem("chunk-proof-boundary-seen"),
  }), buildId);
  assert.equal(recovered.guard, "1");
  assert.equal(recovered.errorBoundarySeen, null);
  await page.screenshot({ path: `${output}/chunk-recovered-settings.png` });
  // Another uncached route fails on the same build. Its guard must prevent
  // a second reload; the ordinary error boundary remains available.
  const beforeRepeat = documents;
  const repeatedChunks = [];
  await page.route("**/assets/leads-*.js", async route => {
    repeatedChunks.push(route.request().url());
    await route.abort("failed");
  });
  await page.evaluate(() => history.pushState(null, "", "/leads"));
  await expect(page.getByRole("heading", { name: "Something went wrong", exact: true })).toBeVisible({ timeout: 30_000 });
  assert.ok(repeatedChunks.length > 0);
  assert.equal(documents, beforeRepeat);
  await page.screenshot({ path: `${output}/chunk-repeat-guarded.png` });
  await writeFile(`${output}/chunk-recovery-proof.json`, JSON.stringify({
    passed: true, buildId, injectedFailure: "Actual production lazy-route JavaScript request aborted by browser transport",
    failedChunks: failedChunks.map(url => new URL(url).pathname),
    firstFailure: { reloads: 1, recoveredRoute: "/settings", errorBoundarySeen: false, sessionGuard: recovered.guard },
    repeatedChunks: repeatedChunks.map(url => new URL(url).pathname),
    repeatSameBuild: { additionalReloads: 0, errorBoundaryAvailable: true },
    differentBuildAndNonChunkErrors: "Covered by src/lib/chunkRecovery.test.ts; separate guard per build, non-chunk failures do not reload",
  }, null, 2));
  console.log("BUILT CHUNK RECOVERY PASS — one reload recovers; repeat failure cannot loop");
} finally {
  await context.close();
  await browser.close();
  await sandbox.close();
}