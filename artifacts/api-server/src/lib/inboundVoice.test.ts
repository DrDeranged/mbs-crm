import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildInboundVoiceTwiML, isWithinVoiceHours, selectRingTargets } from "./inboundVoice";

const hours = {
  voiceHoursStart: "08:00", voiceHoursEnd: "18:00",
  voiceBusinessDays: [1, 2, 3, 4, 5],
  voiceHolidays: [] as string[],
};

describe("New York inbound business hours", () => {
  it("respects weekdays, exact boundaries, DST and holidays", () => {
    assert.equal(isWithinVoiceHours(hours, new Date("2026-09-24T12:00:00Z")), true);
    assert.equal(isWithinVoiceHours(hours, new Date("2026-09-24T22:00:00Z")), false);
    assert.equal(isWithinVoiceHours(hours, new Date("2026-09-26T15:00:00Z")), false);
    assert.equal(isWithinVoiceHours(hours, new Date("2026-01-05T13:00:00Z")), true);
    assert.equal(isWithinVoiceHours({ ...hours, voiceHolidays: ["2026-09-24"] }, new Date("2026-09-24T15:00:00Z")), false);
  });
});

describe("inbound routing targets", () => {
  const reps = [
    { id: 1, forwardingNumber: "+16022455425", isActive: true, role: "rep" },
    { id: 2, forwardingNumber: "+19173996578", isActive: true, role: "rep" },
    { id: 3, forwardingNumber: null, isActive: true, role: "rep" },
    { id: 4, forwardingNumber: "+17146977039", isActive: false, role: "rep" },
    { id: 5, forwardingNumber: "+16022455425", isActive: true, role: "admin" },
  ];
  it("rings a known caller's assigned active rep only", () => {
    assert.deepEqual(selectRingTargets(reps, 2, "assigned-rep-first").map((r) => r.id), [2]);
  });
  it("rings active forwarding reps for unknown callers or ring-all mode", () => {
    assert.deepEqual(selectRingTargets(reps, null, "assigned-rep-first").map((r) => r.id), [1, 2]);
    assert.deepEqual(selectRingTargets(reps, 2, "ring-all").map((r) => r.id), [1, 2]);
  });
  it("returns a simultaneous 20-second dial for known and unknown callers", () => {
    const options = {
      baseUrl: "https://example.com",
      greeting: "Leave a message", afterHoursGreeting: "Closed; leave a message",
      open: true, callerId: "+19088608507", callSid: "CA00000000000000000000000000000000",
    };
    const known = buildInboundVoiceTwiML({ ...options, targets: selectRingTargets(reps, 2, "assigned-rep-first") });
    assert.match(known, /<Dial[^>]*timeout="20"/);
    assert.match(known, /<Dial[^>]*record="record-from-answer"/);
    assert.match(known, /recordingStatusCallback="https:\/\/example.com\/api\/twilio\/voice\/recording"/);
    assert.match(known, /<Number[^>]*>\+19173996578<\/Number>/);
    assert.match(known, /<Client[^>]*>user_2<\/Client>/);
    assert.doesNotMatch(known, /\+16022455425/);
    const unknown = buildInboundVoiceTwiML({ ...options, targets: selectRingTargets(reps, null, "assigned-rep-first") });
    assert.match(unknown, /\+16022455425/);
    assert.match(unknown, /\+19173996578/);
    assert.match(unknown, /voice\/dial-result/);
  });
  it("skips dialing after hours and records with the closed greeting", () => {
    const xml = buildInboundVoiceTwiML({
      baseUrl: "https://example.com", greeting: "Leave a message",
      afterHoursGreeting: "Closed; leave a message", open: false,
      targets: selectRingTargets(reps, 2, "assigned-rep-first"),
      callerId: "+19088608507", callSid: "CA00000000000000000000000000000000",
    });
    assert.doesNotMatch(xml, /<Dial/);
    assert.match(xml, /Polly.Joanna/);
    assert.match(xml, /Closed; leave a message/);
    assert.match(xml, /<Record[^>]*maxLength="120"/);
    assert.match(xml, /transcribe="true"/);
  });
});