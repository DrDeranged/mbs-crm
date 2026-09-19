import { run } from "./process";

const checks: Array<{ label: string; script: string }> = [
  { label: "typecheck", script: "typecheck" },
  { label: "full suite", script: "test" },
  { label: "migration lint", script: "lint:migrations" },
  { label: "schema parity", script: "check:schema" },
  { label: "built-app smoke", script: "smoke" },
  { label: "migration rehearsal", script: "migrate:rehearse" },
];

try {
  for (const [index, check] of checks.entries()) {
    console.log(`PREFLIGHT ${index + 1}/${checks.length}: ${check.label}`);
    await run("pnpm", ["-w", "run", check.script]);
  }
  console.log("PREFLIGHT PASS");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("PREFLIGHT FAIL");
  process.exitCode = 1;
}