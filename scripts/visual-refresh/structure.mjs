import { chromium } from "@playwright/test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { startSandbox } from "./sandbox.mjs";
import { waitForPage } from "./readiness.mjs";
const phase = process.argv[2] ?? "before";
const sandbox = await startSandbox(phase === "before"
  ? { build: false, webRoot: "/tmp/mbs-visual-baseline/public" }
  : { build: false });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH ?? "/repl/tools/bin/chromium", headless: true });
const pages = [["dashboard","/dashboard"],["leads","/leads"],["lead-detail","/leads/1"],["pipeline","/deals"],["apply","/apply"],["settings","/settings"]];
const inventories = {}, appearance = {}, comparisons = [];
try {
  for (const role of ["admin","manager","rep"]) {
    const context = await browser.newContext({ reducedMotion: "reduce", colorScheme: "light" });
    const page = await context.newPage();
    await sandbox.login(page, role);
    for (const width of [390,768]) {
      await page.setViewportSize({ width, height: 900 });
      for (const [name,path] of pages) {
        await page.goto(sandbox.url + path, { waitUntil: "networkidle" });
        await waitForPage(page, name);
        const key = `${name}-${width}-${role}`;
        inventories[key] = await page.locator("button,a,input,select,textarea,[role=combobox],[contenteditable=true]").evaluateAll(elements =>
          elements.filter(el => !el.closest("[data-appearance-control]")).map(el => ({
            tag: el.tagName, role: el.getAttribute("role"), type: el.getAttribute("type"),
            name: el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.textContent?.trim().replace(/\s+/g," "),
            href: el.getAttribute("href"), disabled: el.hasAttribute("disabled"),
          })));
        appearance[key] = await page.locator("[data-appearance-control] button,[data-appearance-control] select,[data-appearance-control] input").evaluateAll(elements => elements.map(el => ({
          tag: el.tagName, label: el.getAttribute("aria-label") ?? el.textContent?.trim(), role: el.getAttribute("role"),
        })));
        console.log(phase, key, inventories[key].length);
      }
    }
    await context.close();
  }
  await mkdir(`reports/web-visual-refresh/${phase}`, { recursive: true });
  await writeFile(`reports/web-visual-refresh/${phase}/role-controls.json`, JSON.stringify(inventories, null, 2));
  await writeFile(`reports/web-visual-refresh/${phase}/appearance-controls.json`, JSON.stringify(appearance, null, 2));
  if (phase === "after") {
    const baseline = JSON.parse(await readFile("reports/web-visual-refresh/before/role-controls.json", "utf8"));
    for (const [key,items] of Object.entries(inventories)) {
      const passed = JSON.stringify(items) === JSON.stringify(baseline[key]);
      const differences = passed ? [] : items.flatMap((item,index) => JSON.stringify(item) === JSON.stringify(baseline[key][index]) ? [] : [{index, before: baseline[key][index], after:item}]);
      comparisons.push({ key, passed, beforeCount: baseline[key].length, afterCount: items.length, differences });
    }
    await writeFile("reports/web-visual-refresh/structural-comparison.json", JSON.stringify(comparisons, null, 2));
    if (comparisons.some(item => !item.passed)) throw new Error("Structural comparison failed; see structural-comparison.json.");
  }
} finally { await browser.close(); await sandbox.close(); }