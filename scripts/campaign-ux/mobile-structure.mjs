import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { startSandbox } from "../visual-refresh/sandbox.mjs";
import { waitForPage } from "../visual-refresh/readiness.mjs";

// The baseline is the verified GitHub main immediately preceding this change.
// Existing screens have NO new exceptions. Campaign navigation/lifecycle controls
// are exercised separately by the campaign lifecycle browser regression.
const [baselineRoot, candidateRoot] = process.argv.slice(2).map(p => resolve(p));
assert(baselineRoot && candidateRoot, "Supply baseline and candidate public builds");
const output = "reports/campaign-ux/mobile";
const routes = [["dashboard", "/dashboard"], ["leads", "/leads"],
  ["lead-detail", "/leads/1"], ["pipeline", "/deals"], ["apply", "/apply"], ["settings", "/settings"]];
const inventories = {};
await mkdir(output, { recursive: true });
for (const [phase, webRoot] of [["before", baselineRoot], ["after", candidateRoot]]) {
  const fixture = await startSandbox({ build: false, webRoot, port: 4390 });
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH ?? "/repl/tools/bin/chromium", headless: true,
  });
  inventories[phase] = {};
  try {
    for (const role of ["admin", "manager", "rep"]) {
      const context = await browser.newContext({ reducedMotion: "reduce", colorScheme: "light", serviceWorkers: "block" });
      const page = await context.newPage();
      await fixture.login(page, role);
      for (const width of [390, 768]) {
        await page.setViewportSize({ width, height: 900 });
        for (const [name, path] of routes) {
          await page.goto(`${fixture.url}${path}`);
          await waitForPage(page, name);
          await page.waitForTimeout(850);
          const key = `${name}-${width}-${role}`;
          inventories[phase][key] = await page.evaluate(() => {
            const describe = el => ({
              tag: el.tagName, role: el.getAttribute("role"), type: el.getAttribute("type"),
              name: el.getAttribute("aria-label") || el.getAttribute("placeholder") ||
                (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 200),
              href: el.getAttribute("href"), disabled: el.disabled === true,
            });
            return Array.from(document.querySelectorAll("button,input,select,textarea,a[href],[role=button],[role=combobox]"))
              .filter(el => !el.closest('[data-structural-shell="true"],[data-app-shell="true"],.cl-rootBox'))
              .map(describe);
          });
          assert(inventories[phase][key].length > 0, `${key}: empty inventory`);
          console.log(`${phase} ${key}: ${inventories[phase][key].length} controls`);
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
    await fixture.close();
  }
  await writeFile(`${output}/${phase}.json`, JSON.stringify(inventories[phase], null, 2));
}
const comparisons = Object.keys(inventories.before).map(key => ({
  key, passed: JSON.stringify(inventories.before[key]) === JSON.stringify(inventories.after[key]),
  beforeCount: inventories.before[key].length, afterCount: inventories.after[key]?.length,
}));
const passed = comparisons.length === 36 && comparisons.every(row => row.passed);
await writeFile(`${output}/comparison.json`, JSON.stringify({
  baselineCommit: "5177557c4d807cb08b7a77200e5f1bbe0de196da",
  passed, allowedNewExceptions: [], comparisons,
}, null, 2));
console.log(`MOBILE STRUCTURE ${comparisons.filter(row => row.passed).length}/36`);
assert(passed, "Existing mobile controls changed; inspect before/after inventories");
console.log("MOBILE STRUCTURE PASS — zero new exceptions on existing screens");
