import assert from "node:assert/strict";
import test from "node:test";
import { createVoicemailPlaybackToken, verifyVoicemailPlaybackToken } from "./voicemail";

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