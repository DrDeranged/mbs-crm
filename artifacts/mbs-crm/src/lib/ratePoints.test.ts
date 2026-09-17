import assert from "node:assert/strict";
import test from "node:test";
import { calculateRatePoints, parseDealRatePointsQuery, reverseFromPoints } from "./ratePoints.ts";

test("deal-linked query parsing reads the browser search string", () => {
  assert.deepEqual(parseDealRatePointsQuery("?dealId=42&advance=28080&payment=1735.69&term=24"), {
    dealId: 42, advance: "28080", payment: "1735.69", term: "24",
  });
  assert.equal(parseDealRatePointsQuery("?dealId=bad").dealId, null);
});

test("Maxim arrears fixture matches requested rates and commission", () => {
  const result = calculateRatePoints({ advance: 28080, payment: 1735.69, term: 24, timing: "arrears", buyNominalRate: 0.18 });
  assert.ok(result);
  assert.ok(Math.abs(result.nominalRate * 100 - 41.15343464813855) < 1e-10);
  assert.ok(Math.abs(result.effectiveRate * 100 - 49.87552891128293) < 1e-10);
  assert.equal((result.simpleRate * 100).toFixed(2), "24.17");
  assert.equal(result.totalCommission.toFixed(2), "8011.71");
  assert.equal(result.points.toFixed(1), "28.5");
});

test("one payment in advance changes the implied nominal rate", () => {
  const result = calculateRatePoints({ advance: 28080, payment: 1735.69, term: 24, timing: "advance", buyNominalRate: 0.18 });
  assert.ok(result);
  assert.equal((result.nominalRate * 100).toFixed(4), "45.4216");
});

test("reverse points produces the target commission and payment", () => {
  const result = reverseFromPoints({ advance: 28080, term: 24, timing: "arrears", buyNominalRate: 0.18, targetPoints: 28.5 });
  assert.ok(result);
  assert.equal(result.points.toFixed(1), "28.5");
  assert.equal(result.totalCommission.toFixed(2), "8002.80");
});

test("schedule conserves balance", () => {
  const result = calculateRatePoints({ advance: 28080, payment: 1735.69, term: 24, timing: "arrears", buyNominalRate: 0.18 });
  assert.ok(result);
  assert.equal(result.schedule.length, 24);
  assert.ok(Math.abs(result.schedule[0].openingBalance - 28080) < 1e-9);
  assert.ok(Math.abs(result.schedule.at(-1)!.closingBalance - 0) < 1e-9);
});