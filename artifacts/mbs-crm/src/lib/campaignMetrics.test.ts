import assert from "node:assert/strict";
import test from "node:test";
import { METRIC_ROWS, formatTracked, referralFromIds, referrerPayload } from "./campaignMetrics.ts";

test("null tracking fields render as not tracked while zero stays zero", () => {
  assert.equal(formatTracked(null), "Not tracked");
  assert.equal(formatTracked(0), "0");
});
test("referrer payload sets exactly one typed id and clears both", () => {
  assert.deepEqual(referrerPayload({ type: "lead", id: 4 }), { referredByLeadId: 4, referredByPartnerId: null });
  assert.deepEqual(referrerPayload({ type: "partner", id: 9 }), { referredByLeadId: null, referredByPartnerId: 9 });
  assert.deepEqual(referrerPayload(null), { referredByLeadId: null, referredByPartnerId: null });
  assert.deepEqual(referralFromIds(null, 9), { type: "partner", id: 9 });
  assert.equal(referralFromIds(null, null), null);
});
test("metric rows label opens as approximate and money rows as referred deals", () => {
  assert.ok(METRIC_ROWS.some((r) => /approximate/.test(r.label)));
  assert.ok(METRIC_ROWS.filter((r) => /\$|points/.test(r.label)).every((r) => /referred/.test(r.label)));
});
