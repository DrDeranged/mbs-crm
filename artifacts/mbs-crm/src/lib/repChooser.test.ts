import test from "node:test";
import assert from "node:assert/strict";
import { canonicalRepSlug, repChooserAttribution, RAY_IDENTITY_REQUEST } from "./repChooser.ts";

test("Ray Settings action sends the complete canonical identity payload", () => {
  assert.deepEqual(RAY_IDENTITY_REQUEST, { newSlug: "ray", displayName: "Ray Davis" });
});

test("retired chooser response drives canonical attribution", () => {
  const retired = { name: "Ray Davis", phone: null, slug: "ray" };
  assert.equal(canonicalRepSlug(retired, "rahmare"), "ray");
  assert.equal(repChooserAttribution(retired, "rahmare"), "ray");
});

test("unknown chooser response stays unpersonalized", () => {
  const fallback = { name: null, phone: null, slug: null };
  assert.equal(repChooserAttribution(fallback, "not-real"), "");
});