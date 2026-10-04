import { chromium } from "../../node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs";
import { startSandbox } from "../visual-refresh/sandbox.mjs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

const root = resolve(import.meta.dirname, "../..");
const reportDir = join(root, "reports/sidebar-notifications");
const frozen = join(tmpdir(), `sidebar-notifications-keyboard-${process.pid}`);
const unpinOnly = process.argv.includes("--unpin-transition");
const checks = [], runnerErrors = [];
const check = (name, pass, detail = "") => checks.push({ name, pass: !!pass, detail });
await mkdir(reportDir, { recursive: true });
let sandbox, browser, context, page;
try {
  await cp(join(root, "artifacts/mbs-crm/dist/public"), frozen, { recursive: true });
  sandbox = await startSandbox({ build: false, webRoot: frozen, port: 4370 });
  browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", headless: true });
  context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  page = await context.newPage();
  await sandbox.login(page, "admin");
  await page.goto(`${sandbox.url}/dashboard`);
  const aside = page.locator('[data-testid="desktop-sidebar"]');
  await aside.waitFor({ state: "visible", timeout: 20000 });
  if (unpinOnly) {
    await page.mouse.move(25, 240);
    await page.waitForTimeout(180);
    check("hover opens sidebar before shortcut transition", await aside.getAttribute("data-open") === "true");
    await page.keyboard.press("Control+b");
    await page.waitForFunction(() => document.querySelector('[data-testid="desktop-sidebar"]')?.getAttribute("data-pinned") === "true");
    await page.mouse.move(800, 500);
    await page.waitForTimeout(350);
    await page.keyboard.press("Control+b");
    await page.waitForFunction(() => document.querySelector('[data-testid="desktop-sidebar"]')?.getAttribute("data-pinned") === "false");
    await page.waitForFunction(() => document.querySelector('[data-testid="desktop-sidebar"]')?.getAttribute("data-open") === "false", { timeout: 3000 });
    const closedState = await aside.evaluate(el => {
      const expanded = el.querySelector('[data-sidebar-surface="expanded"]');
      const main = document.querySelector("main");
      const rect = main?.getBoundingClientRect();
      const point = rect ? document.elementFromPoint(rect.left + 200, rect.top + 200) : null;
      return {
        pinned: el.getAttribute("data-pinned"),
        open: el.getAttribute("data-open"),
        expandedHidden: expanded?.hasAttribute("hidden"),
        expandedInert: expanded?.hasAttribute("inert"),
        mainUnobstructed: !!point?.closest("main"),
      };
    });
    check("hover-open Ctrl+B pin, outside dwell, Ctrl+B unpin closes overlay",
      closedState.pinned === "false" && closedState.open === "false"
        && closedState.expandedHidden && closedState.expandedInert && closedState.mainUnobstructed,
      JSON.stringify(closedState));
    await page.mouse.move(25, 240);
    await page.waitForTimeout(180);
    const expandedPin = aside.locator('[data-sidebar-surface="expanded"]').getByRole("button", { name: "Pin sidebar open" });
    await expandedPin.focus();
    await page.keyboard.press("Enter");
    await aside.locator('[data-sidebar-surface="expanded"]').getByRole("button", { name: "Unpin sidebar" }).waitFor({ state: "visible" });
    const focusedPin = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    check("keyboard pin-button ownership still restores focus", focusedPin === "Unpin sidebar", focusedPin ?? "no aria-label");
  } else {
    const railBell = page.getByRole("button", { name: "Notifications" }).first();
    await railBell.click();
    await page.getByText("Notifications", { exact: true }).last().waitFor({ state: "visible", timeout: 10000 });
    await page.screenshot({ path: join(reportDir, "keyboard-notification-layer.png") });
    await page.keyboard.press("Control+b");
    check("Ctrl+B leaves rail-owned notification layer open and sidebar unpinned",
      await page.getByText("Notifications", { exact: true }).last().isVisible().catch(() => false)
        && await aside.getAttribute("data-pinned") === "false");
    await page.keyboard.press("Escape");
    await page.mouse.move(25, 240);
    await page.waitForTimeout(180);
    const pin = page.getByRole("button", { name: "Pin sidebar open" }).last();
    await pin.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Unpin sidebar" }).waitFor({ state: "visible", timeout: 5000 });
    const focusedPin = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    check("keyboard pin activation restores focus to expanded pin control",
      focusedPin === "Unpin sidebar", `document.activeElement aria-label=${focusedPin}`);
    await page.getByRole("button", { name: "Open user menu" }).click();
    await page.getByText("Rep Quickstart").waitFor({ state: "visible", timeout: 5000 });
    await page.screenshot({ path: join(reportDir, "keyboard-account-menu-layer.png") });
    await page.keyboard.press("Control+b");
    check("Ctrl+B leaves account-menu layer mounted and sidebar pinned",
      await page.getByText("Rep Quickstart").isVisible().catch(() => false)
        && await aside.getAttribute("data-pinned") === "true");
  }
} catch (error) {
  runnerErrors.push({ message: String(error), stack: error?.stack });
} finally {
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await sandbox?.close().catch(() => {});
  await rm(frozen, { recursive: true, force: true }).catch(() => {});
  const result = {
    buildReadyMarker: unpinOnly ? "/tmp/sidebar-unpin-build-ready" : "/tmp/sidebar-notifications-keyboard-build-ready",
    startedAt: new Date().toISOString(),
    checks, runnerErrors,
    summary: { passed: checks.filter(x => x.pass).length, failed: checks.filter(x => !x.pass).length, runnerErrors: runnerErrors.length },
  };
  await writeFile(join(reportDir, unpinOnly ? "unpin-results.json" : "keyboard-results.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result.summary));
  for (const item of checks.filter(x => !x.pass)) console.log(`ASSERTION FAILURE: ${item.name} — ${item.detail}`);
  for (const error of runnerErrors) console.log(`HARNESS/RUNNER ERROR: ${error.message}`);
}