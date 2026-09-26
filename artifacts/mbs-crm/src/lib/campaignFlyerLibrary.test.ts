import assert from "node:assert/strict";
import test from "node:test";
import {
  FLYER_AUDIENCES, FLYER_CATEGORIES, FLYER_VERTICALS,
  normalizeFlyerLabel, requestFlyerUploadUrls,
} from "./campaignFlyerLibrary.ts";

test("flyer metadata options use the API's exact enum values", () => {
  assert.deepEqual(FLYER_CATEGORIES.map(([value]) => value), ["equipment_financing", "working_capital"]);
  assert.deepEqual(FLYER_VERTICALS.map(([value]) => value), ["yellow_iron", "trucking", "restaurants", "amusement", "general"]);
  assert.deepEqual(FLYER_AUDIENCES.map(([value]) => value), ["end_user", "vendor"]);
});

test("legacy representative labels are normalized for display and registration", () => {
  assert.equal(normalizeFlyerLabel("Rahmare — RAHMARE's flyer"), "Ray Davis — Ray Davis's flyer");
  assert.equal(normalizeFlyerLabel("Ray Davis — trucking"), "Ray Davis — trucking");
});

test("upload URL requests reject more than 50 files before sending", () => {
  const file = { originalFilename: "flyer.pdf", size: 120, contentType: "application/pdf" } as const;
  assert.throws(() => requestFlyerUploadUrls(Array.from({ length: 51 }, () => file)), /between 1 and 50/);
  assert.throws(() => requestFlyerUploadUrls([]), /between 1 and 50/);
});