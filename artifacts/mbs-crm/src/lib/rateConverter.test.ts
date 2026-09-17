import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateAmortization, calculateMca } from "./rateConverter.ts";

test("converts nominal APR to effective APR, simple rate, and payment", () => {
  const res = calculateAmortization(12, 0.12, "nominalApr");
  assert.ok(res);
  assert.equal(Math.round(res.nominalApr * 10_000), 1200);
  assert.equal(Math.round(res.effectiveApr * 1_000_000), 126825);
  assert.equal(Math.round(res.monthlyPaymentPer10k * 100), 88849);
});

test("effective APR round-trips to nominal APR", () => {
  const nominal = calculateAmortization(36, 0.18, "nominalApr");
  assert.ok(nominal);
  const effective = calculateAmortization(36, nominal.effectiveApr, "effectiveApr");
  assert.ok(effective);
  assert.ok(Math.abs(effective.nominalApr - 0.18) < 1e-10);
  assert.ok(Math.abs(effective.monthlyPaymentPer10k - nominal.monthlyPaymentPer10k) < 1e-8);
});

test("simple-interest source preserves total payback and solves APR", () => {
  const res = calculateAmortization(24, 0.15, "simpleInterestRate");
  assert.ok(res);
  assert.equal(Math.round(res.totalPaybackPer10k), 13_000);
  assert.ok(res.nominalApr > 0);
  assert.ok(Math.abs(res.simpleInterestRate - 0.15) < 1e-8);
});

test("converts a 1.30 factor over 12 months to implied APR", () => {
  const res = calculateMca(12, "months", 1.3, "factor");
  assert.ok(res);
  assert.equal(res.totalPaybackPer10k, 13_000);
  assert.equal(Math.round(res.periodicPaymentPer10k * 100), 108333);
  assert.ok(res.impliedNominalApr > 0.5);
});

test("MCA factor and APR conversions round-trip for weekly offers", () => {
  const fromFactor = calculateMca(26, "weeks", 1.25, "factor");
  assert.ok(fromFactor);
  const fromApr = calculateMca(26, "weeks", fromFactor.impliedNominalApr, "apr");
  assert.ok(fromApr);
  assert.ok(Math.abs(fromApr.factor - 1.25) < 1e-8);
});

test("rejects invalid terms, rates, and factors", () => {
  assert.equal(calculateAmortization(-1, 0.12, "nominalApr"), null);
  assert.equal(calculateAmortization(12.5, 0.12, "nominalApr"), null);
  assert.equal(calculateAmortization(12, -0.01, "effectiveApr"), null);
  assert.equal(calculateMca(0, "weeks", 1.2, "factor"), null);
  assert.equal(calculateMca(6.5, "months", 1.2, "factor"), null);
  assert.equal(calculateMca(6, "months", 0.9, "factor"), null);
});

test("handles zero-cost financing without NaN or Infinity", () => {
  const res1 = calculateAmortization(12, 0, "nominalApr");
  assert.ok(res1);
  assert.equal(res1.monthlyPaymentPer10k, 10_000 / 12);
  assert.equal(res1.totalPaybackPer10k, 10_000);

  const res2 = calculateMca(12, "months", 1, "factor");
  assert.ok(res2);
  assert.equal(res2.impliedNominalApr, 0);
  assert.equal(res2.periodicPaymentPer10k, 10_000 / 12);
});
