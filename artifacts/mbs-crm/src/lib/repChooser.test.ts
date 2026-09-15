import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalRepSlug,
  repChooserApplyHref,
  repChooserAttribution,
  repChooserSubtext,
  RAY_IDENTITY_REQUEST,
} from "./repChooser.ts";

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

test("chooser subtext uses only the representative first name", () => {
  assert.equal(
    repChooserSubtext({ name: "Ray Davis", phone: null }),
    "Ray will personally handle your application.",
  );
  assert.equal(repChooserSubtext({ name: "  Ray   Davis ", phone: null }), "Ray will personally handle your application.");
  assert.equal(repChooserSubtext({ name: null, phone: null }), null);
});

test("chooser Continue href uses the canonical slug without a type query", () => {
  const retired = { name: "Ray Davis", phone: null, slug: "ray" };
  const href = repChooserApplyHref(retired, "rahmare", "/mbs-crm/");
  assert.equal(href, "/mbs-crm/apply?rep=ray");
  assert.equal(href.includes("type="), false);
});