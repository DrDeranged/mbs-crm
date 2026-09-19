import assert from "node:assert/strict";
import test from "node:test";
import { calculateRatePoints } from "./ratePoints";

test("server rate points calculation matches Maxim fixture", () => {
  const result = calculateRatePoints({ advance: 28080, payment: 1735.69, term: 24, timing: "arrears", buyNominalRate: 0.18 });
  assert.ok(result);
  assert.equal((result.nominalRate * 100).toFixed(4), "41.1534");
  assert.equal((result.effectiveRate * 100).toFixed(4), "49.8755");
  assert.equal((result.simpleRate * 100).toFixed(4), "24.1748");
  assert.equal(result.totalCommission.toFixed(2), "8011.71");
  assert.equal(result.points.toFixed(1), "28.5");
});

test("server calculation accounts for payment in advance", () => {
  const result = calculateRatePoints({ advance: 28080, payment: 1735.69, term: 24, timing: "advance", buyNominalRate: 0.18 });
  assert.ok(result);
  assert.equal((result.nominalRate * 100).toFixed(4), "45.4216");
});