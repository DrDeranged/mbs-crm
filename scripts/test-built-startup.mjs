import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

// Use the same immutable built entry as publishing, not a TS source import.
// Jobs/migrations are disabled by the measurement harness: this is read-only
// against the development schema, not a customer mutation or external send.
const output = execFileSync(process.execPath, [
  "scripts/measure-api-cold-boot.mjs",
  "artifacts/api-server/dist/index.mjs",
  "built-startup-regression",
], { encoding: "utf8", timeout: 110_000, env: process.env });
const measurements = JSON.parse(output);
assert.ok(measurements.first200Ms < 1000, `Liveness took ${measurements.first200Ms}ms`);
assert.equal(measurements.failedAfterFirst200, 0, "Liveness stalled during runtime imports");
assert.ok(measurements.applicationReadyMs !== null, "Runtime never became ready");
console.log(output.trim());
console.log("BUILT STARTUP LIVENESS PASS");