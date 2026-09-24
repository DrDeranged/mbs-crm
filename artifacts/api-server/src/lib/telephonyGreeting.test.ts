import test from "node:test";
import assert from "node:assert/strict";
import { createGreetingUploadGrant, isValidGreetingMp3, verifyGreetingUploadGrant } from "./telephonyGreeting";

test("audio upload grants bind the file, greeting, administrator and expiry", () => {
  const path = "/objects/telephony/greetings/staging/550e8400-e29b-41d4-a716-446655440000.mp3";
  const grant = createGreetingUploadGrant(path, "business", 7);
  assert.equal(verifyGreetingUploadGrant(grant, path, "business", 7), true);
  assert.equal(verifyGreetingUploadGrant(grant, path, "after-hours", 7), false);
  assert.equal(verifyGreetingUploadGrant(grant, path, "business", 8), false);
  assert.equal(verifyGreetingUploadGrant(grant + "x", path, "business", 7), false);
});

test("greeting accepts only an MP3 signature under 2 MB", () => {
  assert.equal(isValidGreetingMp3(Buffer.from("ID3audio"), "audio/mpeg"), true);
  assert.equal(isValidGreetingMp3(Buffer.from("not mp3"), "audio/mpeg"), false);
  assert.equal(isValidGreetingMp3(Buffer.from("ID3audio"), "audio/wav"), false);
  assert.equal(isValidGreetingMp3(Buffer.concat([Buffer.from("ID3"), Buffer.alloc(2 * 1024 * 1024)]), "audio/mpeg"), false);
});