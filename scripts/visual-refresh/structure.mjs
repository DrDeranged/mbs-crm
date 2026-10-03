import { chromium } from "@playwright/test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { startSandbox } from "./sandbox.mjs";
import { waitForPage } from "./readiness.mjs";
import { compareApproved } from "./structure-comparison.mjs";
const phase = process.argv[2] ?? "before";
if (!["before","after"].includes(phase)) throw new Error("Use before or after.");
const output = process.env.STRUCTURE_REPORT_DIR ?? "reports/structural-certification-2026-10-03";
const manifest = JSON.parse(await readFile(new URL("./approved-structure-exceptions.json", import.meta.url), "utf8"));
const sandbox = await startSandbox(phase === "before"
  ? { build: false, webRoot: resolve(process.env.STRUCTURE_BASELINE_WEB_ROOT ?? ".local/certification-2af927c/baselines/pre-contact-2993f17") }
  : { build: false, ...(process.env.STRUCTURE_TARGET_WEB_ROOT ? { webRoot: resolve(process.env.STRUCTURE_TARGET_WEB_ROOT) } : {}) });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH ?? "/repl/tools/bin/chromium", headless: true });
const pages = [["dashboard","/dashboard"],["leads","/leads"],["lead-detail","/leads/1"],["pipeline","/deals"],["apply","/apply"],["settings","/settings"]];
const inventories = {}, exemptions = {}, comparisons = [];
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
        const captured = await page.locator("button,a,input,select,textarea,[role=combobox],[contenteditable=true]").evaluateAll(elements => {
          const describe = el => ({
            tag: el.tagName, role: el.getAttribute("role"), type: el.getAttribute("type"),
            name: el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.textContent?.trim().replace(/\s+/g," "),
            href: el.getAttribute("href"), disabled: el.hasAttribute("disabled"),
          });
          const isExempt = el => !!el.closest("[data-appearance-control],nav[aria-label='Record actions']");
          return { controls: elements.filter(el => !isExempt(el)).map(describe), exemptions: elements.filter(isExempt).map(describe) };
        });
        inventories[key] = captured.controls;
        exemptions[key] = captured.exemptions;
        console.log(phase, key, inventories[key].length);
      }
    }
    await context.close();
  }
  await mkdir(`${output}/${phase}`, { recursive: true });
  await writeFile(`${output}/${phase}/role-controls.json`, JSON.stringify(inventories, null, 2));
  await writeFile(`${output}/${phase}/exempt-controls.json`, JSON.stringify(exemptions, null, 2));
  if (phase === "after") {
    const baseline = JSON.parse(await readFile(`${output}/before/role-controls.json`, "utf8"));
    const baselineExempt = JSON.parse(await readFile(`${output}/before/exempt-controls.json`, "utf8"));
    const expectedKeys = Object.keys(manifest.keys).sort();
    if (JSON.stringify(Object.keys(baseline).sort()) !== JSON.stringify(expectedKeys) ||
        JSON.stringify(Object.keys(inventories).sort()) !== JSON.stringify(expectedKeys)) throw new Error("Structural matrix must contain exactly the 36 approved page/width/role keys.");
    for (const [key,items] of Object.entries(inventories)) {
      comparisons.push(compareApproved(key, baseline[key], items, baselineExempt[key], exemptions[key], manifest));
    }
    await writeFile(`${output}/structural-comparison.json`, JSON.stringify(comparisons, null, 2));
    console.log(`STRUCTURE ${comparisons.filter(item=>item.passed).length}/36`);
    if (comparisons.some(item => !item.passed)) throw new Error("Structural comparison failed; see structural-comparison.json.");
    console.log("STRUCTURE PASS — only the documented, exact approved exceptions");
  }
} finally { await browser.close(); await sandbox.close(); }