import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TELEPHONY_NUMBER,
  resolveTelephonySettings,
} from "./telephonySettings";

test("uses a valid TWILIO_PHONE_NUMBER fallback when settings are unset", () => {
  assert.deepEqual(
    resolveTelephonySettings(undefined, { TWILIO_PHONE_NUMBER: "+15551234567" }),
    { voiceCallerId: "+15551234567", smsSenderNumber: "+15551234567" },
  );
});

test("uses the business default when the environment fallback is absent or invalid", () => {
  assert.deepEqual(
    resolveTelephonySettings(undefined, { TWILIO_PHONE_NUMBER: "not-a-number" }),
    { voiceCallerId: DEFAULT_TELEPHONY_NUMBER, smsSenderNumber: DEFAULT_TELEPHONY_NUMBER },
  );
});

test("persisted numbers override the environment fallback independently", () => {
  assert.deepEqual(
    resolveTelephonySettings(
      { voiceCallerId: "+15550000001", smsSenderNumber: null },
      { TWILIO_PHONE_NUMBER: "+15551234567" },
    ),
    { voiceCallerId: "+15550000001", smsSenderNumber: "+15551234567" },
  );
});