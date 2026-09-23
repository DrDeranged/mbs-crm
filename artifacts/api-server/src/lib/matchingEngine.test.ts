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
import { repFacingMatchDetails } from "./matchingEngine";

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
  const dexlyEvaluation = evaluateLender(dexly, fixture, fixture.company, {
    monthlyRevenueStated: 250_000,
  });
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
  const evaluation = evaluateLender(dexly, fixture, fixture.company, {
    monthlyRevenueStated: 250_000,
  });

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

test("missing required criteria exclude a lender", () => {
  const fixture = {
    applicationType: "working_capital",
    requestedAmount: 250_000,
    creditScore: null,
    existingPositions: null,
  };
  const evaluation = evaluateLender(thoro, fixture, null);
  assert.equal(evaluation.eligible, false);
  assert.equal(
    evaluation.criteriaBreakdown.find((criterion) => criterion.criterion === "Credit Score")?.passed,
    false,
  );
});

test("documented equipment restrictions exclude a conflicting equipment file", () => {
  const evaluation = evaluateLender(
    { name: "Structured equipment lender", equipmentRestrictions: ["aircraft"] },
    { applicationType: "equipment", requestedAmount: 250_000, creditScore: 720, existingPositions: 0 },
    { timeInBusinessMonths: 48, state: "TX", industry: "aviation" },
    { equipmentCategory: "other", equipmentDescription: "Used business aircraft" },
  );
  assert.equal(evaluation.eligible, false);
  assert.deepEqual(
    evaluation.criteriaBreakdown.find((criterion) => criterion.criterion === "Equipment Restriction"),
    {
      criterion: "Equipment Restriction",
      passed: false,
      detail: 'Equipment facts match documented restriction "aircraft"',
    },
  );
});

test("incomplete equipment facts cannot silently clear documented restrictions", () => {
  const evaluation = evaluateLender(
    { name: "Structured equipment lender", equipmentRestrictions: ["aircraft"] },
    { applicationType: "equipment", requestedAmount: 250_000, creditScore: 720, existingPositions: 0 },
    { timeInBusinessMonths: 48, state: "TX", industry: "aviation" },
    {},
  );
  assert.equal(evaluation.eligible, false);
  assert.equal(
    evaluation.criteriaBreakdown.find((criterion) => criterion.criterion === "Equipment Classification")?.passed,
    false,
  );
});

test("missing amount, TIB, state, and generic Other industry cannot clear structured gates", () => {
  const evaluation = evaluateLender(
    {
      name: "Strict packet lender",
      minAmount: 10_000,
      minCreditScore: 650,
      minTimeInBusinessMonths: 24,
      acceptedStates: ["CA"],
      restrictedIndustries: ["law firms"],
    },
    { applicationType: "working_capital", requestedAmount: null, creditScore: null, existingPositions: null },
    null,
    { industry: "Other" },
  );
  assert.equal(evaluation.eligible, false);
  assert.deepEqual(
    evaluation.criteriaBreakdown.filter((criterion) => !criterion.passed).map((criterion) => criterion.criterion),
    ["Requested Amount", "Credit Score", "Industry Classification", "Time in Business", "State"],
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
  // The production rows now enforce documented equipment restrictions. This
  // fixture is a local vocational/service truck, not a long-distance sleeper
  // or dry van, so the restriction evaluator has the facts it needs.
  const fixtureApplication = {
    equipmentCategory: "vocational" as const,
    equipmentDescription: "local vocational service truck",
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

  assert.equal(PACKET_TRUCKING_INDUSTRY_GATING_SUPPORTED, true);

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
    .filter((lender) => evaluateLender(lender, fixture, fixture.company, fixtureApplication).eligible)
    .map((lender) => lender.name);

  assert.deepEqual(matchedNames, [
    "Keystone Equipment Finance Corp (KEF)",
    "Y.E.S. Leasing",
  ]);
  assert.equal(matchedNames.includes("Navitas Credit Corp"), false);
  assert.equal(matchedNames.includes("Channel Partners Capital"), false);
  assert.equal(matchedNames.includes("Alliance Funding Group (AFG)"), false);

  // AFG's special gate is driven by the explicit equipment category, not
  // generic trucking text. Missing OTR facts are reported safely.
  const afgOtr = {
    name: afgUpdate.name,
    ...afgUpdate.matchingBaseline,
    ...afgUpdate.structuredPatch,
  };
  const otrEvaluation = evaluateLender(
    afgOtr,
    { ...fixture, creditScore: 679 },
    fixture.company,
    {
      industry: "trucking",
      timeInBusinessMonths: 59,
      trucksInFleet: 4,
      equipmentCategory: "otr_truck",
      isHomeowner: false,
    },
  );
  assert.equal(otrEvaluation.eligible, false);
  assert.deepEqual(
    otrEvaluation.criteriaBreakdown
      .filter((criterion) => criterion.criterion.startsWith("AFG OTR"))
      .map((criterion) => criterion.criterion),
    ["AFG OTR Time in Business", "AFG OTR Fleet", "AFG OTR FICO", "AFG OTR Homeownership"],
  );
  assert.match(
    otrEvaluation.criteriaBreakdown.find((criterion) => criterion.criterion === "AFG OTR FICO")!.detail,
    /below OTR minimum 680/,
  );
  assert.equal(evaluateLender(
    afgOtr,
    { ...fixture, creditScore: 640 },
    fixture.company,
    {
      industry: "trucking",
      timeInBusinessMonths: 24,
      equipmentCategory: "vocational",
    },
  ).eligible, true);

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
    /TRUCKING \/ TRANSPORTATION \(OTR\)/,
  );
  assert.match(
    NEW_LENDER_SEEDS.find((lender) => lender.name === "Luminar Capital")!.notes,
    /trucking\/transportation minimum 3 years TIB/,
  );
});

test("batch 2 startup, monthly revenue, industry, and financial-statement gates use structured criteria", () => {
  const seedRow = (name: string) => {
    const seed = NEW_LENDER_SEEDS.find((candidate) => candidate.name === name);
    assert.ok(seed, `missing canonical seed ${name}`);
    return newLenderSeedToInsertValues(seed);
  };
  const application = {
    industry: "trucking",
    timeInBusinessMonths: 18,
    monthlyRevenueStated: 100_000,
    trucksInFleet: 1,
    hasFinancialStatements: false,
    hasFactoring: false,
    industryExperienceMonths: 36,
  };
  const truckLead = {
    applicationType: "equipment",
    requestedAmount: 60_000,
    creditScore: 560,
    existingPositions: null,
    businessState: "CA",
  };

  assert.equal(evaluateLender(seedRow("North Mill Equipment Finance (NMEF)"), truckLead, null, application).eligible, false);
  assert.equal(evaluateLender(
    seedRow("North Mill Equipment Finance (NMEF)"),
    { ...truckLead, creditScore: 660 },
    null,
    application,
  ).eligible, true);
  assert.equal(evaluateLender(
    seedRow("North Mill Equipment Finance (NMEF)"),
    { ...truckLead, creditScore: 660, requestedAmount: 250_000 },
    null,
    application,
  ).eligible, false);
  assert.equal(evaluateLender(
    seedRow("North Mill Equipment Finance (NMEF)"),
    { ...truckLead, creditScore: 660 },
    null,
    { ...application, industryExperienceMonths: null },
  ).eligible, false);
  assert.equal(evaluateLender(seedRow("Navitas Credit Corp"), truckLead, null, application).eligible, false);
  assert.equal(evaluateLender(seedRow("Channel Partners Capital"), truckLead, null, application).eligible, false);

  const lowRevenueLead = {
    applicationType: "working_capital",
    requestedAmount: 50_000,
    creditScore: 520,
    existingPositions: null,
    businessState: "CA",
  };
  const lowRevenueApplication = {
    industry: "retail",
    timeInBusinessMonths: 14,
    monthlyRevenueStated: 12_000,
    hasFinancialStatements: false,
    hasFactoring: false,
  };
  const lowRevenueMatches = NEW_LENDER_SEEDS
    .filter((lender) => evaluateLender(
      newLenderSeedToInsertValues(lender),
      lowRevenueLead,
      null,
      lowRevenueApplication,
    ).eligible)
    .map((lender) => lender.name);
  assert.deepEqual(lowRevenueMatches, ["Luminar Capital"]);

  const highRevenueLead = {
    applicationType: "working_capital",
    requestedAmount: 250_000,
    creditScore: 700,
    existingPositions: null,
    businessState: "CA",
  };
  const highRevenueApplication = {
    industry: "law firm",
    timeInBusinessMonths: 30,
    monthlyRevenueStated: 1_200_000,
    hasFinancialStatements: false,
    hasFactoring: false,
  };
  assert.equal(evaluateLender(seedRow("Ophelia Capital Group"), highRevenueLead, null, highRevenueApplication).eligible, true);
  assert.equal(evaluateLender(seedRow("Dexly Finance"), highRevenueLead, null, highRevenueApplication).eligible, true);
  assert.equal(evaluateLender(seedRow("Luminar Capital"), highRevenueLead, null, highRevenueApplication).eligible, false);

  const capTechLead = {
    applicationType: "equipment",
    requestedAmount: 400_000,
    creditScore: 700,
    existingPositions: null,
    businessState: "CA",
  };
  assert.equal(evaluateLender(
    seedRow("CapTech Financial"),
    capTechLead,
    null,
    { ...application, hasFinancialStatements: true },
  ).eligible, true);
  assert.equal(evaluateLender(
    seedRow("CapTech Financial"),
    capTechLead,
    null,
    application,
  ).eligible, false);
});

test("product-scoped revenue gates and all-program industry restrictions apply correctly", () => {
  const seedRow = (name: string) => newLenderSeedToInsertValues(
    NEW_LENDER_SEEDS.find((candidate) => candidate.name === name)!,
  );
  const equipmentLead = {
    applicationType: "equipment",
    requestedAmount: 60_000,
    creditScore: 700,
    existingPositions: null,
    businessState: "CA",
  };
  const channelEquipment = {
    industry: "gambling",
    timeInBusinessMonths: 48,
    monthlyRevenueStated: 100_000,
  };
  assert.equal(evaluateLender(seedRow("Channel Partners Capital"), equipmentLead, null, channelEquipment).eligible, false);
  assert.equal(evaluateLender(
    seedRow("Channel Partners Capital"),
    { ...equipmentLead, applicationType: "working_capital" },
    null,
    channelEquipment,
  ).eligible, false);

  const afgUpdate = EXISTING_LENDER_UPDATES.find((update) => update.name === "Alliance Funding Group (AFG)")!;
  const afg = {
    name: afgUpdate.name,
    ...afgUpdate.matchingBaseline,
    ...afgUpdate.structuredPatch,
  };
  const afgApplication = {
    industry: "law offices",
    timeInBusinessMonths: 60,
    monthlyRevenueStated: 100_000,
  };
  assert.equal(evaluateLender(afg, equipmentLead, null, afgApplication).eligible, false);
  assert.equal(evaluateLender(
    afg,
    { ...equipmentLead, applicationType: "working_capital" },
    null,
    afgApplication,
  ).eligible, false);

  const navitasLead = { ...equipmentLead, requestedAmount: 20_000, creditScore: 660 };
  assert.equal(evaluateLender(
    seedRow("Navitas Credit Corp"),
    navitasLead,
    null,
    { industry: "trucking", timeInBusinessMonths: 24, equipmentCategory: "vocational", equipmentDescription: "local service truck" },
  ).eligible, true);
  assert.equal(evaluateLender(
    seedRow("Navitas Credit Corp"),
    navitasLead,
    null,
    { industry: "Long-Haul Trucking", timeInBusinessMonths: 24, equipmentCategory: "otr_truck", equipmentDescription: "long-distance sleeper" },
  ).eligible, false);
});

test("Section D Fenix and AFG packet scenarios use production seed rows and matcher", () => {
  const fenix = newLenderSeedToInsertValues(
    NEW_LENDER_SEEDS.find((seed) => seed.name === "Fenix Capital Funding")!,
  );
  const afgUpdate = EXISTING_LENDER_UPDATES.find(
    (update) => update.name === "Alliance Funding Group (AFG)",
  )!;
  const afg = {
    name: afgUpdate.name,
    ...afgUpdate.matchingBaseline,
    ...afgUpdate.structuredPatch,
  };
  const validFenixLead = {
    applicationType: "working_capital",
    requestedAmount: 25_000,
    creditScore: 520,
    existingPositions: 3,
    businessState: "NY",
  };
  const validFenixApplication = {
    industry: "professional services",
    timeInBusinessMonths: 18,
    monthlyRevenueStated: 25_000,
  };

  assert.equal(evaluateLender(
    fenix,
    validFenixLead,
    null,
    { ...validFenixApplication, industry: "trucking" },
  ).eligible, false);
  assert.equal(evaluateLender(
    fenix,
    validFenixLead,
    null,
    { ...validFenixApplication, industry: "merchant services", businessState: "CA" },
  ).eligible, false);
  assert.equal(evaluateLender(fenix, validFenixLead, null, validFenixApplication).eligible, true);

  const validAfgVocational = {
    applicationType: "equipment",
    requestedAmount: 60_000,
    creditScore: 640,
    existingPositions: 1,
    businessState: "NY",
  };
  assert.equal(evaluateLender(
    afg,
    validAfgVocational,
    null,
    { industry: "trucking", equipmentCategory: "vocational", timeInBusinessMonths: 24 },
  ).eligible, true);
  assert.equal(evaluateLender(
    afg,
    validAfgVocational,
    null,
    { industry: "tow truck", equipmentCategory: "vocational", timeInBusinessMonths: 24 },
  ).eligible, false);

  const otrApplication = {
    industry: "transportation",
    equipmentCategory: "otr_truck" as const,
    timeInBusinessMonths: 60,
    trucksInFleet: 5,
    isHomeowner: true,
  };
  assert.equal(evaluateLender(
    afg,
    { ...validAfgVocational, creditScore: 680 },
    null,
    otrApplication,
  ).eligible, true);
  for (const [field, value] of [
    ["timeInBusinessMonths", 59],
    ["trucksInFleet", 4],
    ["isHomeowner", false],
  ] as const) {
    assert.equal(evaluateLender(
      afg,
      { ...validAfgVocational, creditScore: 680 },
      null,
      { ...otrApplication, [field]: value },
    ).eligible, false, `${field} threshold must be enforced independently`);
  }
  assert.equal(evaluateLender(
    afg,
    { ...validAfgVocational, creditScore: 679 },
    null,
    otrApplication,
  ).eligible, false);
});

test("Maxim uses state/amount/TIB gates, ignores FICO, and requires collateral for WC", () => {
  const maxim = newLenderSeedToInsertValues(
    NEW_LENDER_SEEDS.find((seed) => seed.name === "Maxim Commercial Capital")!,
  );
  const equipmentLead = {
    applicationType: "equipment", requestedAmount: 50_000, creditScore: 540,
    existingPositions: null, businessState: "TX",
  };
  const app = {
    industry: "professional services",
    timeInBusinessMonths: 6,
    hasCollateral: false,
    equipmentCategory: "construction" as const,
    equipmentDescription: "standard commercial excavator",
  };
  assert.equal(evaluateLender(maxim, equipmentLead, null, app).eligible, true);
  for (const lender of [
    newLenderSeedToInsertValues(NEW_LENDER_SEEDS.find((seed) => seed.name === "Navitas Credit Corp")!),
    newLenderSeedToInsertValues(NEW_LENDER_SEEDS.find((seed) => seed.name === "Channel Partners Capital")!),
    { name: "Alliance Funding Group (AFG)", programTypes: ["equipment"], minAmount: 10_000, maxAmount: 500_000,
      minCreditScore: 600, minTimeInBusinessMonths: 48, acceptedStates: [], acceptedIndustries: [] },
  ]) {
    assert.equal(evaluateLender(lender, equipmentLead, null, app).eligible, false);
  }
  assert.equal(evaluateLender(maxim, { ...equipmentLead, businessState: "LA" }, null, app).eligible, false);
  assert.equal(evaluateLender(
    maxim, { ...equipmentLead, applicationType: "working_capital" }, null, app,
  ).eligible, false);
  assert.equal(evaluateLender(
    maxim, { ...equipmentLead, applicationType: "working_capital" }, null, { ...app, hasCollateral: true },
  ).eligible, true);
});

test("AFG vocational exceptions are scoped to equipment applications", () => {
  const afg = {
    name: "Alliance Funding Group (AFG)",
    minTimeInBusinessMonths: 48,
  };
  const evaluation = evaluateLender(
    afg,
    {
      applicationType: "working_capital",
      requestedAmount: 50_000,
      creditScore: 700,
      existingPositions: null,
    },
    { industry: "transportation", timeInBusinessMonths: 24 },
    { equipmentCategory: "vocational" },
  );

  assert.equal(evaluation.eligible, false);
  assert.equal(
    evaluation.criteriaBreakdown.find((criterion) => criterion.criterion === "Time in Business")?.passed,
    false,
  );
  assert.equal(
    evaluation.criteriaBreakdown.some((criterion) => criterion.criterion.startsWith("AFG OTR")),
    false,
  );
});

test("AFG tow-truck exclusion considers company and application signals", () => {
  const cases = [
    ["company industry", "company", "Towing"],
    ["company industry plural", "company", "Towing companies"],
    ["application industry", "application", "Towing business"],
    ["application industry plural", "application", "Towing businesses"],
    ["equipment description", "description", "Towing service"],
    ["equipment description plural", "description", "Towing services"],
    ["year/model", "model", "Towing operation"],
    ["year/model plural", "model", "Towing operations"],
    ["tow truck", "description", "2024 tow truck"],
    ["tow-truck", "model", "2024 tow-truck"],
    ["wrecker", "description", "Commercial wrecker"],
  ] as const;

  for (const [label, signal, value] of cases) {
    const evaluation = evaluateLender(
      { name: "Alliance Funding Group (AFG)" },
      {
        applicationType: "equipment",
        requestedAmount: 50_000,
        creditScore: 700,
        existingPositions: null,
      },
      {
        industry: signal === "company" ? value : "transportation",
        timeInBusinessMonths: 24,
      },
      {
        industry: signal === "application" ? value : "transportation",
        equipmentDescription: signal === "description" ? value : "Normal equipment",
        yearMakeModel: signal === "model" ? value : "2024 vehicle",
      },
    );

    assert.equal(evaluation.eligible, false, `${label} must exclude AFG`);
    assert.equal(
      evaluation.criteriaBreakdown.find((criterion) => criterion.criterion === "AFG Tow Trucks")?.passed,
      false,
      `${label} must emit the tow exclusion`,
    );
  }
});

test("AFG restricted trucking exceptions cannot be used by working-capital applications", () => {
  const afg = {
    name: "Alliance Funding Group (AFG)",
    restrictedIndustries: ["trucking"],
    minTimeInBusinessMonths: 48,
  };
  const lead = {
    applicationType: "working_capital",
    creditScore: 600,
    requestedAmount: 50_000,
    existingPositions: null,
  };
  const baseApplication = {
    industry: "OTR trucking",
    timeInBusinessMonths: 48,
    trucksInFleet: 1,
    isHomeowner: false,
  };

  for (const equipmentCategory of [undefined, "otr_truck"] as const) {
    const evaluation = evaluateLender(
      afg,
      lead,
      { industry: "OTR trucking" },
      { ...baseApplication, equipmentCategory },
    );
    assert.equal(evaluation.eligible, false, `category ${equipmentCategory ?? "omitted"} must remain restricted`);
    assert.equal(
      evaluation.criteriaBreakdown.find((criterion) => criterion.criterion === "Restricted Industry")?.passed,
      false,
    );
  }
});

test("AFG tow exclusion ignores incidental towing equipment language", () => {
  const evaluation = evaluateLender(
    { name: "Alliance Funding Group (AFG)" },
    {
      applicationType: "equipment",
      requestedAmount: 50_000,
      creditScore: 700,
      existingPositions: null,
    },
    { industry: "transportation", timeInBusinessMonths: 24 },
    {
      industry: "transportation",
      equipmentDescription: "Pickup with tow package",
      yearMakeModel: "2024 pickup with tow hitch",
    },
  );

  assert.equal(evaluation.eligible, true);
  assert.equal(
    evaluation.criteriaBreakdown.some((criterion) => criterion.criterion === "AFG Tow Trucks"),
    false,
  );
});

test("rep-facing DKW fixture ranks approval before points and speed", () => {
  const dkw = {
    applicationType: "equipment", requestedAmount: 60_000, creditScore: 560,
    existingPositions: 0, businessState: "NY",
  };
  const trucking = { industry: "trucking", timeInBusinessMonths: 12, equipmentCategory: "vocational" as const };
  const lenders = [
    { name: "Maxim Commercial Capital", minAmount: 20_000, maxAmount: 250_000, programTypes: ["equipment"] },
    { name: "Keystone Equipment Finance Corp (KEF)", minAmount: 10_000, maxAmount: 300_000, programTypes: ["equipment"], compensation: { type: "points" as const, min: 5, max: 10 } },
    { name: "Y.E.S. Leasing", minAmount: 10_000, maxAmount: 300_000, programTypes: ["equipment"] },
    { name: "Fenix Capital Funding", programTypes: ["equipment"], prohibitedIndustries: ["trucking"] },
  ];
  const evaluations = lenders.map((lender) => ({
    lender,
    evaluation: evaluateLender(lender, dkw, trucking, trucking),
  }));
  assert.deepEqual(evaluations.filter(({ evaluation }) => evaluation.eligible).map(({ lender }) => lender.name), [
    "Maxim Commercial Capital", "Keystone Equipment Finance Corp (KEF)", "Y.E.S. Leasing",
  ]);
  const fenix = evaluations.find(({ lender }) => lender.name.startsWith("Fenix"))!;
  assert.equal(fenix.evaluation.eligible, false);
  assert.match(fenix.evaluation.criteriaBreakdown.find((criterion) => !criterion.passed)!.detail, /prohibited/i);
  assert.equal(repFacingMatchDetails(fenix.evaluation, fenix.lender).verdict, "Excluded");
});

test("Godspeed approval evidence exposes Maxim C1 down-payment range and points", () => {
  const lender = {
    name: "Maxim Commercial Capital",
    programTypes: ["equipment"],
    compensation: { type: "points" as const, min: 5, max: 15 },
    pricing: { minDownPaymentPct: null },
    notes: "Heavy equipment commission: up to 15% ≤ $75,000; up to 12% $75,001–$250,000.",
  };
  const evaluation = evaluateLender(lender, {
    applicationType: "equipment", requestedAmount: 100_000, creditScore: 560,
  }, { industry: "trucking", timeInBusinessMonths: 24 }, { equipmentCategory: "vocational" });
  const details = repFacingMatchDetails(evaluation, lender, {
    requestedAmount: 100_000,
    equipmentCategory: "construction",
    capturedApproval: { tier: "C1", downPayment: "25–35%" },
  });
  assert.equal(details.points, 12);
  assert.equal(details.expectedTier, "C1");
  assert.equal(details.downPayment, "25–35%");
});

test("generic lender notes never leak a captured approval tier to another lead", () => {
  const lender = {
    name: "Maxim Commercial Capital",
    notes: "Godspeed Technologies approved tier C1, 25–35% down",
  };
  const evaluation = { eligible: true, matchScore: 100, weightedScore: 100, criteriaBreakdown: [] };
  const details = repFacingMatchDetails(evaluation, lender, { requestedAmount: 60_000 });
  assert.equal(details.expectedTier, null);
  assert.equal(details.downPayment, null);
});

test("Maxim points are a documented deal-specific upper bound, not compensation.max", () => {
  const lender = {
    compensation: { type: "points" as const, min: 5, max: 15 },
    notes: "Heavy equipment commission: up to 15% ≤ $75,000; up to 12% $75,001–$250,000; up to 5% on fundings for New York-based borrowers. Commission: 8% with ≥ 20% down; up to 10% with ≥ 40% down.",
  };
  const evaluation = { eligible: true, matchScore: 100, weightedScore: 100, criteriaBreakdown: [] };
  assert.equal(repFacingMatchDetails(evaluation, lender, { requestedAmount: 60_000, equipmentCategory: "construction" }).points, 15);
  assert.equal(repFacingMatchDetails(evaluation, lender, { requestedAmount: 150_000, equipmentCategory: "construction" }).points, 12);
  assert.equal(repFacingMatchDetails(evaluation, lender, { requestedAmount: 60_000, businessState: "NY", equipmentCategory: "construction" }).points, 5);
  assert.equal(repFacingMatchDetails(evaluation, lender, { industry: "trucking", equipmentCategory: "otr_truck" }).points, null);
});

test("Enviro-Care below AFG equipment minimum is explicitly excluded", () => {
  const lender = { name: "Alliance Funding Group (AFG)", minAmount: 50_000, maxAmount: 500_000, programTypes: ["equipment"] };
  const evaluation = evaluateLender(lender, {
    applicationType: "equipment", requestedAmount: 40_000, creditScore: 700,
  }, { industry: "environmental services", timeInBusinessMonths: 36 }, { equipmentCategory: "other" });
  assert.equal(evaluation.eligible, false);
  assert.match(evaluation.criteriaBreakdown.find((criterion) => criterion.criterion === "Requested Amount")!.detail, /\$40,000/);
});

test("document gaps use categories and statement count without treating one bank statement as three", () => {
  const lender = {
    requiredDocuments: ["last 3 months complete business bank statements", "equipment invoice"],
  };
  const evaluation = { eligible: true, matchScore: 100, weightedScore: 100, criteriaBreakdown: [] };
  const oneStatement = repFacingMatchDetails(evaluation, lender, {
    uploadedDocuments: ["bank_statement", "invoice_quote"],
    uploadedDocumentCategories: ["bank_statement", "invoice_quote"],
    businessStatementStatus: "business",
  });
  assert.deepEqual(oneStatement.needsBeforeSubmit, ["last 3 months complete business bank statements"]);
  const complete = repFacingMatchDetails(evaluation, lender, {
    uploadedDocuments: ["bank_statement", "bank_statement", "bank_statement", "invoice_quote"],
    uploadedDocumentCategories: ["bank_statement", "bank_statement", "bank_statement", "invoice_quote"],
    businessStatementStatus: "business",
  });
  assert.deepEqual(complete.needsBeforeSubmit, []);
});

test("a current business statement reconciles a stale personal-only persisted gap", () => {
  const lender = { requiredDocuments: ["3 months business bank statements"] };
  const evaluation = { eligible: true, matchScore: 100, weightedScore: 100, criteriaBreakdown: [] };
  const details = repFacingMatchDetails(evaluation, lender, {
    uploadedDocuments: ["personal statement", "business checking statement", "bank_statement", "bank_statement", "bank_statement"],
    uploadedDocumentCategories: ["bank_statement", "bank_statement", "bank_statement"],
    businessStatementStatus: "business",
  });
  assert.deepEqual(details.needsBeforeSubmit, []);
});