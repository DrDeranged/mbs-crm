import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node's strip-types test runner resolves explicit .ts imports.
import { NEW_LENDER_SEEDS } from "./newLenderSeeds.ts";
// @ts-expect-error Node's strip-types test runner resolves explicit .ts imports.
import { evaluateLender } from "./matchingEligibility.ts";

const dexly = NEW_LENDER_SEEDS.find((seed) => seed.name === "Dexly Finance")!;
const thoro = NEW_LENDER_SEEDS.find((seed) => seed.name === "Thoro Corp")!;

const lead = (
  timeInBusinessMonths: number,
  requestedAmount = 250_000,
  monthlyRevenue = 120_000,
) => ({
  applicationType: "working_capital",
  requestedAmount,
  creditScore: 550,
  existingPositions: 1,
  // Documentation-only fixture context; evaluateLender intentionally ignores
  // this because revenue is not part of the existing lender schema.
  monthlyRevenue,
  company: {
    timeInBusinessMonths,
    industry: "professional services",
    state: "NY",
  },
});

test("an 8-month working-capital lead includes Thoro and excludes Dexly on TIB", () => {
  const fixture = lead(8, 250_000);
  const dexlyEvaluation = evaluateLender(dexly, fixture, fixture.company);
  const thoroEvaluation = evaluateLender(thoro, fixture, fixture.company);

  assert.equal(thoroEvaluation.eligible, true);
  assert.equal(dexlyEvaluation.eligible, false);
  assert.deepEqual(
    dexlyEvaluation.criteriaBreakdown.find((criterion) => criterion.criterion === "Time in Business"),
    {
      criterion: "Time in Business",
      passed: false,
      detail: "8 months is below minimum 12 months",
    },
  );
  assert.equal(
    dexlyEvaluation.criteriaBreakdown
      .filter((criterion) => !criterion.skipped)
      .some((criterion) => criterion.passed === false && criterion.criterion !== "Time in Business"),
    false,
  );
  assert.equal(fixture.monthlyRevenue, 120_000);
});

test("a 24-month, $250,000 working-capital lead includes Dexly", () => {
  const fixture = lead(24, 250_000, 250_000);
  const evaluation = evaluateLender(dexly, fixture, fixture.company);

  assert.equal(evaluation.eligible, true);
  assert.equal(
    evaluation.criteriaBreakdown.find((criterion) => criterion.criterion === "Requested Amount")?.passed,
    true,
  );
  assert.equal(fixture.monthlyRevenue, 250_000);
  assert.equal(
    evaluation.criteriaBreakdown.find((criterion) => criterion.criterion === "Time in Business")?.passed,
    true,
  );
});

test("missing criteria are skipped rather than excluding a lender", () => {
  const fixture = {
    applicationType: "working_capital",
    requestedAmount: 250_000,
    creditScore: null,
    existingPositions: null,
  };
  const evaluation = evaluateLender(thoro, fixture, null);
  assert.equal(evaluation.eligible, true);
  assert.equal(
    evaluation.criteriaBreakdown.find((criterion) => criterion.criterion === "Credit Score")?.skipped,
    true,
  );
});