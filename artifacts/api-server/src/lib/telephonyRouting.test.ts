import assert from "node:assert/strict";
import test from "node:test";
import { isOwnedInboundNumber, selectSmsSender, selectVoiceCallerId } from "./telephonyRouting";

test("browser calls use the configured voice caller ID", () => {
  assert.equal(selectVoiceCallerId("+15550000001", "client:user_7"), "+15550000001");
});

test("browser call caller ID falls back to the client identity when unset", () => {
  assert.equal(selectVoiceCallerId("", "client:user_7"), "client:user_7");
});

test("SMS replies use the owned inbound number for the existing thread", () => {
  assert.equal(
    selectSmsSender("+15550000002", "+15550000001", new Set(["+15550000001", "+15550000002"])),
    "+15550000001",
  );
});

test("both owned numbers are valid inbound destinations", () => {
  const owned = new Set(["+15550000001", "+15550000002"]);
  assert.equal(isOwnedInboundNumber("+15550000001", owned), true);
  assert.equal(isOwnedInboundNumber("+15550000002", owned), true);
  assert.equal(isOwnedInboundNumber("+15559999999", owned), false);
});

test("new SMS and unowned inbound threads use the configured sender", () => {
  const owned = new Set(["+15550000001"]);
  assert.equal(selectSmsSender("+15550000002", undefined, owned), "+15550000002");
  assert.equal(selectSmsSender("+15550000002", "+15559999999", owned), "+15550000002");
});