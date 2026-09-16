import assert from "node:assert/strict";
import test from "node:test";
import {
  createIntegrationHealthProbe,
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