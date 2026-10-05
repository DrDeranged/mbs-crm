import assert from "node:assert/strict";
import test from "node:test";
import { referrerKey } from "./campaignMetrics.ts";

test("referrer keys are typed", () => {
  assert.equal(referrerKey({ type: "partner", id: 3 }), "partner:3");
});
