import assert from "node:assert/strict";
import test from "node:test";
import {
  applicationSmsConsentFields,
  evaluateLeadSmsEligibility,
} from "./smsEligibility";

test("unchecked SMS consent stays false and leaves timestamp and IP empty", () => {
  const fields = applicationSmsConsentFields(false, "203.0.113.10", new Date("2026-09-17T12:00:00.000Z"));
  assert.deepEqual(fields, {
    smsConsent: false,
    smsConsentAt: null,
    smsConsentIp: null,
  });
  assert.deepEqual(
    evaluateLeadSmsEligibility({ phone: "5551234567", isUnsubscribed: false }, fields),
    { eligible: false, reason: "application_sms_consent_required" },
  );
});

test("checked SMS consent records timestamp and IP and makes the lead eligible", () => {
  const capturedAt = new Date("2026-09-17T12:00:00.000Z");
  const fields = applicationSmsConsentFields(true, "203.0.113.10", capturedAt);
  assert.deepEqual(fields, {
    smsConsent: true,
    smsConsentAt: capturedAt,
    smsConsentIp: "203.0.113.10",
  });
  assert.deepEqual(
    evaluateLeadSmsEligibility({ phone: "5551234567", isUnsubscribed: false }, fields),
    { eligible: true, reason: "eligible" },
  );
});

test("legacy or incomplete consent records remain ineligible", () => {
  const lead = { phone: "5551234567", isUnsubscribed: false };
  assert.equal(evaluateLeadSmsEligibility(lead, null).eligible, false);
  assert.equal(evaluateLeadSmsEligibility(lead, {
    smsConsent: true,
    smsConsentAt: null,
    smsConsentIp: null,
  }).eligible, false);
});