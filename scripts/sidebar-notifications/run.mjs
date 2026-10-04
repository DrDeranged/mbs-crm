import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";

// Uses existing production builds, a disposable schema-only database and
// synthetic Clerk users. Delivery credentials are removed by the sandbox.
const root = resolve(import.meta.dirname, "../..");
for (const [script, report, nested] of [
  ["keyboard-controls.mjs", "keyboard-results.json", false],
  ["finish-remaining.mjs", "final-results.json", true],
]) {
  const result = spawnSync(process.execPath, [join(import.meta.dirname, script)], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  const evidence = JSON.parse(await readFile(join(root, "reports/sidebar-notifications", report), "utf8"));
  const run = nested ? evidence.finalRun : evidence;
  if (!run.checks?.length || run.checks.some(check => !check.pass) || run.runnerErrors.length) {
    console.error(`Sidebar regression checks failed: ${report}`);
    process.exit(1);
  }
}
console.log("Sidebar and notification regression checks passed.");