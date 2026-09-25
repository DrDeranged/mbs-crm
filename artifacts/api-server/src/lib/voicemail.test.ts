import assert from "node:assert/strict";
import test from "node:test";
import { createVoicemailPlaybackToken, MISSED_CALL_TEXT, missedCallTextBackClaimKey, shouldSendMissedCallTextBack, verifyVoicemailPlaybackToken } from "./voicemail";
import { isWithinVoiceHours } from "./inboundVoice";

test("voicemail playback tokens round-trip and carry a document id", () => {
  const token = createVoicemailPlaybackToken(42, Date.now() + 60_000);
  assert.equal(verifyVoicemailPlaybackToken(token), 42);
});

test("voicemail playback tokens reject tampering and expiry", () => {
  const token = createVoicemailPlaybackToken(42, Date.now() - 1);
  assert.equal(verifyVoicemailPlaybackToken(token), null);
  const valid = createVoicemailPlaybackToken(42, Date.now() + 60_000);
  const [payload, signature] = valid.split(".");
  assert.equal(verifyVoicemailPlaybackToken(`${payload}.${signature.slice(0, -1)}x`), null);
});

test("missed-call text-back has the exact opt-out copy and uses the New York call date", () => {
  assert.equal(
    MISSED_CALL_TEXT,
    "Sorry we missed your call — a My Business Solutions rep will call you back shortly. Questions? Call (908) 860-8507 or email funding@my-business-solutions.com. Reply STOP to opt out.",
  );
  const beforeMidnight = new Date("2025-01-07T04:59:00.000Z");
  const afterMidnight = new Date("2025-01-07T05:01:00.000Z");
  assert.notEqual(missedCallTextBackClaimKey(7, beforeMidnight), missedCallTextBackClaimKey(7, afterMidnight));
  assert.equal(missedCallTextBackClaimKey(7, beforeMidnight), missedCallTextBackClaimKey(7, new Date("2025-01-07T04:30:00.000Z")));
});

test("missed-call text-back guard recognizes business hours and rejects after-hours", () => {
  const settings = { voiceHoursStart: "08:00", voiceHoursEnd: "18:00", voiceBusinessDays: [1, 2, 3, 4, 5], voiceHolidays: [] };
  assert.equal(isWithinVoiceHours(settings, new Date("2025-01-07T16:00:00.000Z")), true);
  assert.equal(isWithinVoiceHours(settings, new Date("2025-01-07T23:00:00.000Z")), false);
});

test("handleMissedCall text-back guard requires opt-in, consent, and an unanswered call", () => {
  const voiceSettings = { voiceHoursStart: "08:00", voiceHoursEnd: "18:00", voiceBusinessDays: [1, 2, 3, 4, 5], voiceHolidays: [] };
  const base = {
    enabled: true,
    hasRecording: false,
    callOutcome: null,
    callTime: new Date("2025-01-07T16:00:00.000Z"),
    voiceSettings,
    smsEligible: true,
    usfaBlocked: false,
    twilioConfigured: true,
  };
  assert.equal(shouldSendMissedCallTextBack(base), true);
  assert.equal(shouldSendMissedCallTextBack({ ...base, enabled: false }), false);
  assert.equal(shouldSendMissedCallTextBack({ ...base, smsEligible: false }), false);
  assert.equal(shouldSendMissedCallTextBack({ ...base, callTime: new Date("2025-01-07T23:00:00.000Z") }), false);
  assert.equal(shouldSendMissedCallTextBack({ ...base, hasRecording: true }), false);
  assert.equal(shouldSendMissedCallTextBack({ ...base, callOutcome: "voicemail" }), false);
  assert.equal(shouldSendMissedCallTextBack({ ...base, callOutcome: "connected" }), false);
});