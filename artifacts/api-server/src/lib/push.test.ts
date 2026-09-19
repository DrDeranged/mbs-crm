import assert from "node:assert/strict";
import test from "node:test";
import { inferPushEvent, isPrunablePushError, pushPreferenceEnabled } from "./push";

test("CRM notification types map to their exact preference events", () => {
  assert.equal(inferPushEvent("application_received"), "new_application");
  assert.equal(inferPushEvent("lead_assigned"), "new_lead_assigned");
  assert.equal(inferPushEvent("sms_received"), "lead_replied");
  assert.equal(inferPushEvent("submission_status_changed"), "submission_status_changed");
  assert.equal(inferPushEvent("task_due"), "task_due");
  assert.equal(inferPushEvent("stale_lead"), "stale_lead");
});

test("generic status_changed notifications do not infer a browser event", () => {
  assert.equal(inferPushEvent("status_changed"), undefined);
});

test("push master-off suppresses web push while event preference remains independent", () => {
  assert.equal(pushPreferenceEnabled(false, true), false);
  assert.equal(pushPreferenceEnabled(true, true), true);
  assert.equal(pushPreferenceEnabled(true, false), false);
  assert.equal(pushPreferenceEnabled(false, false, true), true);
});

test("expired web-push responses are prunable, other failures are retained", () => {
  assert.equal(isPrunablePushError({ statusCode: 410 }), true);
  assert.equal(isPrunablePushError({ statusCode: 404 }), true);
  assert.equal(isPrunablePushError({ statusCode: 500 }), false);
  assert.equal(isPrunablePushError(new Error("network")), false);
});