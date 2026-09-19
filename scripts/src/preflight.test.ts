import assert from "node:assert/strict";
import test from "node:test";
import { checks, runPreflight } from "./preflight";

test("preflight keeps migration safety gates explicit and ordered", () => {
  const scripts = checks.map((check) => check.script);
  const required = [
    "lint:migration-dependencies",
    "db:clone-prod",
    "migrate:rehearse",
    "db:divergence",
  ];
  assert.deepEqual(
    scripts.filter((script) => required.includes(script)),
    required,
  );
});

test("preflight stops at a failed migration safety gate", async () => {
  const called: string[] = [];
  await assert.rejects(
    () => runPreflight(async (_command, args) => {
      const script = args.at(-1)!;
      called.push(script);
      if (script === "migrate:rehearse") throw new Error("blocked");
    }),
    /blocked/,
  );
  assert.equal(called.includes("db:divergence"), false);
});