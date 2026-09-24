import assert from "node:assert/strict";
import test from "node:test";
import { hasRecordedSmsConsent } from "./softphoneConsent.ts";

test("Text is disabled when consent is not fully recorded", () => {
  assert.equal(hasRecordedSmsConsent({ smsConsent: true, smsConsentAt: null, smsConsentIp: "198.51.100.10" }), false);
  assert.equal(hasRecordedSmsConsent({ smsConsent: true, smsConsentAt: "2026-01-01T00:00:00Z", smsConsentIp: null }), false);
  assert.equal(hasRecordedSmsConsent({ smsConsent: false, smsConsentAt: "2026-01-01T00:00:00Z", smsConsentIp: "198.51.100.10" }), false);
});

test("Text is enabled only with consent, timestamp, and IP", () => {
  assert.equal(hasRecordedSmsConsent({
    smsConsent: true,
    smsConsentAt: "2026-01-01T00:00:00Z",
    smsConsentIp: "198.51.100.10",
  }), true);
});