import assert from "node:assert/strict";
import test from "node:test";
import { leadsFitHeight } from "./leadsFitHeight.ts";

test("Leads fits below the workspace header at a short laptop height", () => {
  assert.equal(leadsFitHeight(560, 56, 0), 504);
});
test("Leads accounts for its actual offset and the ancestor's bottom padding", () => {
  assert.equal(leadsFitHeight(560, 80, 12), 468);
});
test("Leads rounds down subpixel geometry without overflowing", () => {
  assert.equal(leadsFitHeight(560.5, 56.25, 0), 504);
});
test("Leads does not generate negative or nonfinite CSS heights", () => {
  assert.equal(leadsFitHeight(560, 600, 0), 0);
  assert.equal(leadsFitHeight(Number.NaN, 56, 0), 0);
});
