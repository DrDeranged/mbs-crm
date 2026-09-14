import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node's strip-types test runner resolves explicit .ts imports.
import { isLeadStale } from "./staleLeadPredicate.ts";

const NOW = Date.parse("2025-01-08T00:00:00.000Z");

test("stale display boundary is a strict less-than comparison", () => {
  const threshold = 7;
  const boundary = new Date(NOW - threshold * 24 * 60 * 60 * 1000);
  assert.equal(isLeadStale(12, boundary, threshold, NOW), false);
  assert.equal(isLeadStale(12, new Date(boundary.getTime() - 1), threshold, NOW), true);
  assert.equal(isLeadStale(null, new Date("2020-01-01T00:00:00.000Z"), threshold, NOW), false);
});