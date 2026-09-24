import assert from "node:assert/strict";
import test from "node:test";
import {
  createIntegrationHealthProbe,
  buildTelephonyNumberHealth,
  getTwilioFailureReason,
} from "./integrationHealth";

const complete = {
  TWILIO_ACCOUNT_SID: "AC" + "a".repeat(32),
  TWILIO_AUTH_TOKEN: "auth",
  TWILIO_API_KEY: "SK" + "b".repeat(32),
  TWILIO_API_SECRET: "secret",
  TWILIO_TWIML_APP_SID: "AP" + "c".repeat(32),
  TWILIO_PHONE_NUMBER: "+15551234567",
  SENDGRID_API_KEY: "key",
  SENDGRID_FROM_EMAIL: "from@example.com",
  SENDGRID_FROM_NAME: "MBS",
  SENDGRID_WEBHOOK_VERIFICATION_KEY: "webhook",
};

test("names the first missing or invalid Twilio setting", () => {
  assert.equal(getTwilioFailureReason({}), "missing:TWILIO_ACCOUNT_SID");
  assert.equal(
    getTwilioFailureReason({ ...complete, TWILIO_TWIML_APP_SID: "MGbad" }),
    "invalid:TWILIO_TWIML_APP_SID",
  );
  assert.equal(getTwilioFailureReason(complete), null);
});

test("reports detailed integration presence and caches token mint", async () => {
  let mints = 0;
  let now = 1;
  const probe = createIntegrationHealthProbe({
    env: () => complete,
    mint: () => { mints++; return "jwt"; },
    now: () => now,
  });
  const first: any = await probe();
  assert.equal(first.twilio.voiceToken, "ok");
  assert.equal(first.twilio.twimlAppSidFormat, "valid");
  assert.equal(first.sendgrid.providerOpenTracking, false);
  await probe();
  assert.equal(mints, 1);
  now += 600_001;
  await probe();
  assert.equal(mints, 2);
});

test("times out token mint with a safe reason", async () => {
  const probe = createIntegrationHealthProbe({
    env: () => complete,
    mint: () => new Promise(() => {}),
    timeoutMs: 5,
  });
  const result: any = await probe();
  assert.equal(result.twilio.voiceToken, "fail:timeout");
});

test("lists both owned numbers when both roles use the business line", () => {
  const result = buildTelephonyNumberHealth([
    { sid: "PN1", phoneNumber: "+19088608507", friendlyName: "Business" },
    { sid: "PN2", phoneNumber: "+19084987548", friendlyName: "Secondary" },
  ], { voiceCallerId: "+19088608507", smsSenderNumber: "+19088608507" });
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((number) => number.configuredRoles), [
    { voice: true, sms: true },
    { voice: false, sms: false },
  ]);
});

test("reports split configured roles across owned numbers", () => {
  const result = buildTelephonyNumberHealth([
    { sid: "PN1", phoneNumber: "+19088608507", friendlyName: "Voice" },
    { sid: "PN2", phoneNumber: "+19084987548", friendlyName: "SMS" },
  ], { voiceCallerId: "+19088608507", smsSenderNumber: "+19084987548" });
  assert.deepEqual(result.map((number) => number.configuredRoles), [
    { voice: true, sms: false },
    { voice: false, sms: true },
  ]);
});

test("keeps selected sender role visible when the sender is unowned", () => {
  const result = buildTelephonyNumberHealth([
    { sid: "PN1", phoneNumber: "+19088608507", friendlyName: "Voice" },
  ], { voiceCallerId: "+19088608507", smsSenderNumber: "+19084987548" });
  assert.equal(result[1].owned, false);
  assert.deepEqual(result[1].configuredRoles, { voice: false, sms: true });
});