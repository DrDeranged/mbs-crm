import assert from "node:assert/strict";
import test from "node:test";
import { formatFailedLine } from "./process";

test("failure lines are single-line, named, and never undefined", () => {
  assert.equal(formatFailedLine("DB CLONE", undefined), "DB CLONE FAILED: unknown error");
  assert.equal(
    formatFailedLine("MIGRATION REHEARSAL", new Error("first\nsecond")),
    "MIGRATION REHEARSAL FAILED: first second",
  );
  assert.equal(
    formatFailedLine("DB DIVERGENCE", new AggregateError([new Error("snapshot failed"), undefined])),
    "DB DIVERGENCE FAILED: snapshot failed",
  );
});