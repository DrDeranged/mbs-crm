import test from "node:test";
import assert from "node:assert/strict";
import { netGmAfterReferralSplit, partnerMatchGroup } from "./partnerFlows";

test("broker-out matches are grouped as super-broker options", () => {
  assert.equal(partnerMatchGroup("broker_out"), "super_broker");
  assert.equal(partnerMatchGroup("direct_lender"), "lender");
});

test("broker-in split math exposes gross, referral, and net GM", () => {
  assert.deepEqual(netGmAfterReferralSplit(10_000, 25), {
    grossGm: 10_000,
    referralAmount: 2_500,
    netGm: 7_500,
  });
});

test("split math clamps malformed percentages", () => {
  assert.equal(netGmAfterReferralSplit(100, 140).netGm, 0);
  assert.equal(netGmAfterReferralSplit(100, -5).netGm, 100);
});

test("missing referral data produces a numeric zero instead of NaN", () => {
  assert.deepEqual(netGmAfterReferralSplit(0, null), {
    grossGm: 0,
    referralAmount: 0,
    netGm: 0,
  });
});