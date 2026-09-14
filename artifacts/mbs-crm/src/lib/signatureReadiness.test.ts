import test from "node:test";
import assert from "node:assert/strict";
import { getSignatureReadiness, serializeDrawnSignature } from "./signatureReadiness.ts";

test("draw serialization uses the live canvas and reports failures explicitly", () => {
  assert.equal(serializeDrawnSignature({
    toDataURL: (type) => `data:${type};base64,AAAA`,
  }), "data:image/png;base64,AAAA");
  assert.throws(
    () => serializeDrawnSignature({ toDataURL: () => { throw new Error("canvas failed"); } }),
    /Unable to serialize drawn signature/,
  );
});

test("draw readiness transitions from missing to ready and back after clear", () => {
  assert.deepEqual(getSignatureReadiness("draw", "", false), {
    ready: false,
    error: "Drawn signature is required.",
  });
  assert.deepEqual(getSignatureReadiness("draw", "", true), { ready: true, error: null });
  assert.deepEqual(getSignatureReadiness("draw", "", false), {
    ready: false,
    error: "Drawn signature is required.",
  });
});

test("typed readiness requires at least two trimmed characters", () => {
  assert.equal(getSignatureReadiness("type", "A", false).ready, false);
  assert.equal(getSignatureReadiness("type", " A ", false).ready, false);
  assert.equal(getSignatureReadiness("type", "AB", false).ready, true);
});