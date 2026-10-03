import { chromium } from "@playwright/test";
import lighthouse from "lighthouse";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { startSandbox } from "./sandbox.mjs";

const phase = process.argv[2] ?? "before";
if (!["before", "after"].includes(phase)) throw new Error("Use before or after.");
const output = `reports/web-visual-refresh/${phase}/lighthouse`;
await mkdir(output, { recursive: true });
const profile = await mkdtemp(`${tmpdir()}/visual-lighthouse-`);
const sandbox = await startSandbox(phase === "before" ? {
  build: false,
  webRoot: resolve(process.env.VISUAL_BASELINE_WEB_ROOT ?? ".cache/visual-refresh-baseline/artifacts/mbs-crm/dist/public"),
} : { build: false });
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH ?? "/repl/tools/bin/chromium",
  headless: true, args: ["--remote-debugging-port=9224"], viewport: { width: 1440, height: 900 },
});
const summary = [];
try {
  const page = await context.newPage();
  await sandbox.login(page);
  for (const width of [390,1440]) for (const [name,path] of [["pipeline","/deals"],["lead-detail","/leads/1"]]) {
    for (let repeat = 1; repeat <= 3; repeat++) {
      const result = await lighthouse(sandbox.url + path, {
        port: 9224, output: ["json","html"], logLevel: "error", onlyCategories: ["performance","accessibility"],
        disableStorageReset: true, formFactor: width === 390 ? "mobile" : "desktop",
        screenEmulation: { mobile: width === 390, width, height: 900, deviceScaleFactor: 1, disabled: false },
        throttlingMethod: "simulate",
        throttling: { rttMs: 150, throughputKbps: 1638.4, requestLatencyMs: 562.5, downloadThroughputKbps: 1474.56, uploadThroughputKbps: 675, cpuSlowdownMultiplier: 4 },
      });
      if (!result || !result.lhr.finalDisplayedUrl?.endsWith(path)) throw new Error("Lighthouse did not measure the protected route.");
      const stem = `${output}/${name}-${width}-run${repeat}`;
      await writeFile(`${stem}.json`, result.report[0]);
      await writeFile(`${stem}.html`, result.report[1]);
      const scores = { page: name, width, repeat, performance: result.lhr.categories.performance.score * 100, accessibility: result.lhr.categories.accessibility.score * 100 };
      summary.push(scores);
      console.log(phase, JSON.stringify(scores));
    }
  }
  await writeFile(`${output}/summary.json`, JSON.stringify({
    method: "Production build, real development Clerk authentication, identical synthetic fixtures, 3 serial runs; simulated 4x CPU/150ms RTT/1638.4Kbps; 900px height/1x device scale; no storage reset",
    results: summary,
  }, null, 2));
} finally {
  await context.close();
  await sandbox.close();
  await rm(profile, { recursive: true, force: true });
}