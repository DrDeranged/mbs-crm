import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types test runner resolves explicit .ts imports.
import { runProductionCloseout } from "./productionCloseout.ts";

test("production closeout executes operations in the required order", async () => {
  const calls: string[] = [];
  const result = await runProductionCloseout({
    ownership: async () => { calls.push("ownership"); return { changed: 21 }; },
    slugs: async () => { calls.push("slugs"); return { changed: 3 }; },
    templates: async () => { calls.push("templates"); return { templatesCreated: 9 }; },
    lenders: async () => { calls.push("lenders"); return { created: 2 }; },
  });

  assert.deepEqual(calls, ["ownership", "slugs", "templates", "lenders"]);
  assert.equal(result.status, "succeeded");
  assert.equal(result.overallStatus, "succeeded");
  assert.deepEqual(result.results.map((item) => [item.operation, item.status]), [
    ["ownership", "succeeded"],
    ["slugs", "succeeded"],
    ["templates", "succeeded"],
    ["lenders", "succeeded"],
  ]);
});

test("production closeout stops on the first failure and reports skipped operations", async () => {
  const calls: string[] = [];
  const result = await runProductionCloseout({
    ownership: async () => { calls.push("ownership"); return { changed: 0 }; },
    slugs: async () => { calls.push("slugs"); throw new Error("slug conflict"); },
    templates: async () => { calls.push("templates"); return {}; },
    lenders: async () => { calls.push("lenders"); return {}; },
  });

  assert.deepEqual(calls, ["ownership", "slugs"]);
  assert.equal(result.status, "failed");
  assert.equal(result.overallStatus, "failed");
  assert.deepEqual(result.results, [
    { operation: "ownership", status: "succeeded", details: { changed: 0 } },
    { operation: "slugs", status: "failed", details: { error: "slug conflict" } },
    { operation: "templates", status: "skipped", details: { reason: "Skipped after slugs failed" } },
    { operation: "lenders", status: "skipped", details: { reason: "Skipped after slugs failed" } },
  ]);
});