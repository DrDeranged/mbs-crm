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

test("application estimated score band is used only when actual score is absent", () => {
  const evaluation = evaluateLender(
    { name: "Test", minCreditScore: 650 },
    { applicationType: "working_capital", creditScore: null, requestedAmount: null, existingPositions: null },
    null,
    { estCreditScore: "650_699" },
  );
  assert.equal(evaluation.eligible, true);
  assert.match(
    evaluation.criteriaBreakdown.find((criterion) => criterion.criterion === "Credit Score")?.detail ?? "",
    /estimated band minimum/,
  );
});

test("actual lead credit score overrides application estimated score", () => {
  const evaluation = evaluateLender(
    { name: "Test", minCreditScore: 650 },
    { applicationType: "working_capital", creditScore: 600, requestedAmount: null, existingPositions: null },
    null,
    { estCreditScore: "700_plus" },
  );
  assert.equal(evaluation.eligible, false);
  assert.match(
    evaluation.criteriaBreakdown.find((criterion) => criterion.criterion === "Credit Score")?.detail ?? "",
    /^Score 600 is below minimum 650$/,
  );
});

test("application business start month supplies time in business when company data is absent", () => {
  const start = new Date();
  start.setUTCMonth(start.getUTCMonth() - 24);
  const month = String(start.getUTCMonth() + 1).padStart(2, "0");
  const year = start.getUTCFullYear();
  const evaluation = evaluateLender(
    { name: "Test", minTimeInBusinessMonths: 24 },
    { applicationType: "working_capital", creditScore: null, requestedAmount: null, existingPositions: null },
    null,
    { businessStartDate: `${month}/${year}` },
  );
  assert.equal(evaluation.eligible, true);
  assert.equal(evaluation.criteriaBreakdown.find((criterion) => criterion.criterion === "Time in Business")?.passed, true);
});

test("company time in business overrides application business start date", () => {
  const evaluation = evaluateLender(
    { name: "Test", minTimeInBusinessMonths: 24 },
    { applicationType: "working_capital", creditScore: null, requestedAmount: null, existingPositions: null },
    { timeInBusinessMonths: 6 },
    { businessStartDate: "01/2000" },
  );
  assert.equal(evaluation.eligible, false);
  assert.deepEqual(
    evaluation.criteriaBreakdown.find((criterion) => criterion.criterion === "Time in Business"),
    {
      criterion: "Time in Business",
      passed: false,
      detail: "6 months is below minimum 24 months",
    },
  );
});