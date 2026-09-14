import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node's strip-types test runner resolves explicit .ts imports.
import { getSafeUserId } from "./requestAuth.ts";

test("safe auth lookup preserves an initialized user id", () => {
  assert.equal(getSafeUserId(() => ({ userId: "user_123" })), "user_123");
});

test("safe auth lookup does not mask an earlier request error", () => {
  assert.equal(getSafeUserId(() => {
    throw new Error("clerk state unavailable");
  }), null);
});