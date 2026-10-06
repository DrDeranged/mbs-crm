import assert from "node:assert/strict";
import test from "node:test";
import { getBrowserTelephonyReadiness } from "./integrationHealth";

test("unconfigured browser telephony has an explicit successful readiness state", () => {
  assert.deepEqual(getBrowserTelephonyReadiness({}), {
    voiceConfigured: false, ownedNumbersConfigured: false,
  });
  assert.deepEqual(getBrowserTelephonyReadiness({ TWILIO_ACCOUNT_SID: `AC${"a".repeat(32)}`, TWILIO_AUTH_TOKEN: "   " }), {
    voiceConfigured: false, ownedNumbersConfigured: false,
  });
});

test("voice and owned-number configuration are independent and secret-free", () => {
  const owned = { TWILIO_ACCOUNT_SID: `AC${"a".repeat(32)}`, TWILIO_AUTH_TOKEN: "fixture" };
  assert.deepEqual(getBrowserTelephonyReadiness(owned), { voiceConfigured: false, ownedNumbersConfigured: true });
  assert.deepEqual(getBrowserTelephonyReadiness({
    ...owned, TWILIO_API_KEY: `SK${"b".repeat(32)}`, TWILIO_API_SECRET: "fixture", TWILIO_TWIML_APP_SID: `AP${"c".repeat(32)}`,
  }), { voiceConfigured: true, ownedNumbersConfigured: true });
});
