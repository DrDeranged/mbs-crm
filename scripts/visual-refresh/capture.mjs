import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { startSandbox } from "./sandbox.mjs";
import { waitForPage } from "./readiness.mjs";

const phase = process.argv[2] ?? "before";
if (!["before", "after"].includes(phase)) throw new Error("Use before or after.");
const output = resolve("reports/web-visual-refresh", phase);
await mkdir(output, { recursive: true });
const sandbox = await startSandbox(phase === "before" ? { build: false, webRoot: "/tmp/mbs-visual-baseline/public" } : { build: false });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH ?? "/repl/tools/bin/chromium", headless: true });
const pages = [["dashboard","/dashboard"],["leads","/leads"],["lead-detail","/leads/1"],["pipeline","/deals"],["apply","/apply"],["settings","/settings"]];
const inventories = {}, errors = [];
try {
  for (const mode of ["light","dark"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: mode, reducedMotion: "reduce" });
    if (phase === "before") await context.addInitScript(dark => document.addEventListener("DOMContentLoaded", () => document.documentElement.classList.toggle("dark", dark)), mode === "dark");
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await sandbox.login(page);
    for (const width of [390,768,1280,1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const [name,path] of pages) {
        await page.goto(sandbox.url + path, { waitUntil: "networkidle" });
        await waitForPage(page, name);
        if (name !== "apply" && /sign-in/.test(page.url())) throw new Error(`${name} did not authenticate.`);
        await page.screenshot({ path: `${output}/${name}-${width}-${mode}.png` });
        if (mode === "light" && width <= 768) {
          inventories[`${name}-${width}-admin`] = await page.locator("button,a,input,select,textarea,[role=combobox],[contenteditable=true]").evaluateAll(elements =>
            elements.filter(el => !el.closest("[data-appearance-control]")).map(el => ({
              tag: el.tagName, role: el.getAttribute("role"), type: el.getAttribute("type"),
              name: el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.textContent?.trim().replace(/\s+/g," "),
              href: el.getAttribute("href"), id: el.id, disabled: el.hasAttribute("disabled"),
            })));
        }
        console.log(`${phase} ${name} ${width} ${mode}`);
      }
    }
    await context.close();
  }
  if (errors.length) throw new Error(`Browser errors: ${errors.join("; ")}`);
  await writeFile(`${output}/controls.json`, JSON.stringify(inventories, null, 2));
  await writeFile(`${output}/methodology.json`, JSON.stringify({
    authentication: "Real development Clerk ticket; no auth mocks", persistence: "Disposable schema-only clone; synthetic users/leads/deals",
    build: "production", height: 900, widths: [390,768,1280,1440], colorSchemes: ["light","dark"],
    baselineDark: phase === "before" ? "Existing dark class injected; baseline has no theme provider" : null,
    reducedMotion: "reduce", delivery: "Credentials stripped and delivery endpoints blocked", captures: 48,
  }, null, 2));
} finally {
  await browser.close();
  await sandbox.close();
}