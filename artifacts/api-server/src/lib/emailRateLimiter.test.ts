import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node's strip-types test runner resolves explicit .ts imports.
import { canReserveEmailRateSlot } from "./emailRateLimiterPolicy.ts";

test("shared limiter rejects the reservation that would exceed the cap", () => {
  assert.equal(canReserveEmailRateSlot(59, 60), true);
  assert.equal(canReserveEmailRateSlot(60, 60), false);
  assert.equal(canReserveEmailRateSlot(600, 60), false);
});

test("limiter normalizes invalid capacities to safe bounds", () => {
  assert.equal(canReserveEmailRateSlot(0, 0), true);
  assert.equal(canReserveEmailRateSlot(999, 5000), true);
  assert.equal(canReserveEmailRateSlot(1000, 1000), false);
});