import path from "node:path";
import { run } from "./process";

export const checks: ReadonlyArray<{ label: string; script: string }> = [
  { label: "schema path guard", script: "guard:schema-path" },
  { label: "recovery guard", script: "recovery:guard" },
  { label: "typecheck", script: "typecheck" },
  { label: "full suite", script: "test" },
  { label: "migration lint", script: "lint:migrations" },
  { label: "built-app smoke", script: "smoke" },
  { label: "migration dependency lint", script: "lint:migration-dependencies" },
  { label: "production database clone", script: "db:clone-prod" },
  { label: "migration rehearsal", script: "migrate:rehearse" },
  { label: "database divergence", script: "db:divergence" },
];

export async function runPreflight(
  execute: typeof run = run,
): Promise<void> {
  for (const [index, check] of checks.entries()) {
    console.log(`PREFLIGHT ${index + 1}/${checks.length}: ${check.label}`);
    await execute("pnpm", ["-w", "run", check.script]);
  }
  console.log("PREFLIGHT PASS");
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try {
    await runPreflight();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error("PREFLIGHT FAIL");
    process.exitCode = 1;
  }
}