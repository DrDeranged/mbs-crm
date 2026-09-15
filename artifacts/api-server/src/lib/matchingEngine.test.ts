import test from "node:test";
import assert from "node:assert/strict";
import {
  EXISTING_LENDER_UPDATES,
  NEW_LENDER_SEEDS,
  applyExistingLenderUpdate,
  newLenderSeedToInsertValues,
  type ExistingLenderUpdate,
  type ExistingLenderMatchingBaseline,
} from "./newLenderSeeds";
import {
  evaluateLender,
  PACKET_TRUCKING_INDUSTRY_GATING_SUPPORTED,
} from "./matchingEligibility";

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

test("an equipment trucking lead matches only lenders allowed by structured criteria", () => {
  const fixture = {
    applicationType: "equipment",
    requestedAmount: 60_000,
    creditScore: 560,
    existingPositions: null,
    company: {
      industry: "trucking",
      timeInBusinessMonths: 18,
      state: "NY",
    },
  };

  const seedRow = (name: string) => {
    const seed = NEW_LENDER_SEEDS.find((candidate) => candidate.name === name);
    assert.ok(seed, `missing canonical seed ${name}`);
    return newLenderSeedToInsertValues(seed);
  };

  // KEF, Navitas, and Channel are production seed rows, not test copies.
  const kef = seedRow("Keystone Equipment Finance Corp (KEF)");
  const navitas = seedRow("Navitas Credit Corp");
  const channel = seedRow("Channel Partners Capital");

  const afgUpdate = EXISTING_LENDER_UPDATES.find(
    (update) => update.name === "Alliance Funding Group (AFG)",
  );
  const yesUpdate = EXISTING_LENDER_UPDATES.find(
    (update) => update.name === "Y.E.S. Leasing",
  );
  assert.ok(afgUpdate);
  assert.ok(yesUpdate);

  // These two packet targets predate NEW_LENDER_SEEDS. Keep only their
  // canonical matching fields here, then apply the same pure update helper
  // production maintenance uses.
  const matchingRow = (name: string, matchingBaseline: ExistingLenderMatchingBaseline) => ({
    id: 0,
    name,
    ...matchingBaseline,
    notes: null,
    isActive: true,
  });
  const afg = applyExistingLenderUpdate(
    matchingRow(afgUpdate.name, afgUpdate.matchingBaseline),
    afgUpdate,
  );
  const yes = applyExistingLenderUpdate(
    matchingRow(yesUpdate.name, yesUpdate.matchingBaseline),
    yesUpdate,
  );

  // This flag documents the schema boundary; notes below are evidence for
  // human underwriting only and are never parsed for eligibility.
  assert.equal(PACKET_TRUCKING_INDUSTRY_GATING_SUPPORTED, false);

  const lenderRows = [kef, yes, navitas, channel, afg];
  const matchingCriteria = (lender: (typeof lenderRows)[number]) => ({
    name: lender.name,
    programTypes: lender.programTypes,
    minAmount: lender.minAmount,
    maxAmount: lender.maxAmount,
    minCreditScore: lender.minCreditScore,
    minTimeInBusinessMonths: lender.minTimeInBusinessMonths,
    acceptedIndustries: lender.acceptedIndustries,
    acceptedStates: lender.acceptedStates,
  });
  assert.deepEqual(matchingCriteria(afg), {
    name: afgUpdate.name,
    ...afgUpdate.matchingBaseline,
  });
  assert.deepEqual(matchingCriteria(yes), {
    name: yesUpdate.name,
    ...yesUpdate.matchingBaseline,
  });
  assert.deepEqual(matchingCriteria(kef), {
    name: kef.name,
    programTypes: kef.programTypes,
    minAmount: kef.minAmount,
    maxAmount: kef.maxAmount,
    minCreditScore: kef.minCreditScore,
    minTimeInBusinessMonths: kef.minTimeInBusinessMonths,
    acceptedIndustries: kef.acceptedIndustries,
    acceptedStates: kef.acceptedStates,
  });
  assert.deepEqual(matchingCriteria(navitas), {
    name: navitas.name,
    programTypes: navitas.programTypes,
    minAmount: navitas.minAmount,
    maxAmount: navitas.maxAmount,
    minCreditScore: navitas.minCreditScore,
    minTimeInBusinessMonths: navitas.minTimeInBusinessMonths,
    acceptedIndustries: navitas.acceptedIndustries,
    acceptedStates: navitas.acceptedStates,
  });
  assert.deepEqual(matchingCriteria(channel), {
    name: channel.name,
    programTypes: channel.programTypes,
    minAmount: channel.minAmount,
    maxAmount: channel.maxAmount,
    minCreditScore: channel.minCreditScore,
    minTimeInBusinessMonths: channel.minTimeInBusinessMonths,
    acceptedIndustries: channel.acceptedIndustries,
    acceptedStates: channel.acceptedStates,
  });
  assert.equal(yes.minTimeInBusinessMonths, 0);

  const matchedNames = lenderRows
    .filter((lender) => evaluateLender(lender, fixture, fixture.company).eligible)
    .map((lender) => lender.name);

  assert.deepEqual(matchedNames, [
    "Keystone Equipment Finance Corp (KEF)",
    "Y.E.S. Leasing",
  ]);
  assert.equal(matchedNames.includes("Navitas Credit Corp"), false);
  assert.equal(matchedNames.includes("Channel Partners Capital"), false);
  assert.equal(matchedNames.includes("Alliance Funding Group (AFG)"), false);

  // Notes retain packet guidance for human underwriting; they are not parsed
  // or used as an eligibility shortcut by the evaluator.
  assert.match(
    NEW_LENDER_SEEDS.find((lender) => lender.name === "Navitas Credit Corp")!.notes,
    /TRUCKING LONG-DISTANCE/,
  );
  assert.match(
    NEW_LENDER_SEEDS.find((lender) => lender.name === "Channel Partners Capital")!.notes,
    /TRANSPORTATION:/,
  );
  assert.match(
    EXISTING_LENDER_UPDATES.find((update) => update.name === "Alliance Funding Group (AFG)")!.notes,
    /transportation cautionary/,
  );
  assert.match(
    NEW_LENDER_SEEDS.find((lender) => lender.name === "Luminar Capital")!.notes,
    /trucking\/transportation minimum 3 years TIB/,
  );
});