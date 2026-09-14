import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node's strip-types test runner resolves explicit .ts imports.
import { canAdvanceEmailStatus, classifySendGridEvent, normalizeEmail } from "./emailSafetyPredicates.ts";

test("suppression uses a canonical case-insensitive email", () => {
  assert.equal(normalizeEmail("  Jane@Example.COM "), "jane@example.com");
});

test("email engagement state never downgrades terminal statuses", () => {
  assert.equal(canAdvanceEmailStatus("clicked", "opened"), false);
  assert.equal(canAdvanceEmailStatus("bounced", "opened"), false);
  assert.equal(canAdvanceEmailStatus("unsubscribed", "delivered"), false);
  assert.equal(canAdvanceEmailStatus("delivered", "opened"), true);
});

test("all provider suppression events classify as suppressing", () => {
  for (const event of ["bounce", "blocked", "dropped", "spamreport", "complaint", "group_unsubscribe", "unsubscribe"]) {
    assert.equal(classifySendGridEvent(event).suppress, true, event);
  }
  assert.equal(classifySendGridEvent("open").status, "opened");
  assert.equal(classifySendGridEvent("click").status, "clicked");
  assert.equal(classifySendGridEvent("unknown").status, null);
});