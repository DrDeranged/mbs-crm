import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  BATCH_2_LENDER_UPDATE_MARKER,
  AFG_TRUCKING_UPDATE_MARKER,
  EXISTING_LENDER_UPDATE_MARKER,
  EXISTING_LENDER_UPDATES,
  NEW_LENDER_SEEDS,
  PRESERVED_LEGACY_LENDER_NAMES,
  applyExistingLenderUpdate,
  appendExistingLenderUpdateNotes,
  newLenderSeedToInsertValues,
  planNewLenderSeeds,
} from "./newLenderSeeds";
import {
  executeLenderSeedAndUpdates,
  type LenderSeedTransaction,
} from "./productionMaintenance";

const DEXLY_NOTES = `SOURCE STATEMENTS (verbatim):
 - Programs: working capital / MCA
 - Funding: $75,000 – $5,000,000; terms typically 5–12 months (exceptions
   considered); repayment daily or weekly
 - Time in business: minimum 12 months
 - Revenue: minimum $200,000 MONTHLY
 - Credit: no minimum FICO stated; no bankruptcies; no more than 5 consecutive
   NSF events
 - Paper: A–D; Positions: 1–5
 - Geography: all 50 US states + Puerto Rico; TEXAS: first position only;
   Canada only w/ US-registered entity (enhanced review)
 - Restricted industries: construction, contractors, consulting, logistics,
   trucking, cannabis, restaurants — EXCEPTION: accepted at $1,000,000+ monthly
   revenue
 - Pricing (notes): factor rates 1.25–1.50; ISO commission tiers: 1.25–1.30 =
   A-paper 1%; 1.30 buy rate; 1.31–1.35 = 1–5%; 1.36–1.40 = 6–10%; 1.41–1.45 =
   10.4–12%; 1.46–1.50 = 12.4–14%; commissions paid weekly Fridays
 - Docs: complete application + last 3 months business bank statements; stips
   may include DL/VC, most recent tax return, AR report, AP report, balance
   sheet, proof of ownership, board resolution if applicable, bank login
 - Submission: underwriting@dexlyfinance.com (cc ISO Relations Manager); all deal communication stays in the original email thread
 - Notes: approvals within minutes; family-office capital; ISO-only model

SCHEMA MAPPING:
 - Mapped: working_capital and MCA programs, $75,000–$5,000,000 amount range,
   12-month minimum TIB, 1–5 position maximum, all 50 US states and Puerto
   Rico, and the stated underwriting email.
 - Unsupported by the existing lender schema and retained above: terms and
   repayment cadence, monthly revenue, no-bankruptcy and NSF rules, paper
   grade, Texas first-position rule, Canadian enhanced-review rule,
   restricted industries and revenue exception, pricing and commission tiers,
   documentation/stips, ISO Relations Manager CC rule, original-thread rule,
   and the approval/funding model.`;

const THORO_NOTES = `SOURCE STATEMENTS (verbatim):
 - Programs: working capital / MCA
 - Funding: $80,000 – $5,000,000; terms 30–180 days; repayment daily or weekly
 - Time in business: minimum 6 months
 - Credit: minimum FICO 500; previous defaults accepted if settled; maximum 3
   negative days per month
 - Paper: B–D
 - Positions & revenue by risk tier: LOW-RISK industries: 1st position and up,
   minimum revenue $100,000/mo, minimum 10 deposits/mo; HIGH-RISK industries:
   2nd position and up, minimum revenue $150,000/mo, minimum 20 deposits/mo
 - Geography/industries: NO industry restrictions, NO state restrictions
 - Docs (contract request): driver's license, voided check, email, phone —
   for EVERY owner if multiple; closing stips before bank verification: proof
   of ownership (most recent tax return / EIN letter / K1), most recent AR
   report or invoices, credit card statements if applicable
 - Notes: B–D paper lane; accepts previously defaulted merchants if settled

SCHEMA MAPPING:
 - Mapped: working_capital and MCA programs, $80,000–$5,000,000 amount range,
   6-month minimum TIB, and minimum FICO 500.
 - Unsupported by the existing lender schema and retained above: terms and
   repayment cadence, previous-default settlement rule, negative-days rule,
   paper grade, risk-tier position rules, monthly revenue and deposit
   requirements, documentation/stips, and the no-restrictions geography and
   industry statements.
 - Thoro's risk-tier position rules do not map to one maxExistingPositions
   value; no maximum position was supplied, so the schema-required default
   applies.`;
const EXPECTED_DEXLY_NOTES = DEXLY_NOTES.replace(/^ /gm, "");
const EXPECTED_THORO_NOTES = THORO_NOTES.replace(/^ /gm, "");

type FakeLenderRow = {
  id: number;
  name: string;
  notes: string | null;
  minAmount: number | null;
  maxAmount: number | null;
  minCreditScore: number | null;
  minTimeInBusinessMonths: number;
  contactName: string | null;
  contactEmail: string | null;
  [key: string]: unknown;
};

function fakeLender(name: string, id: number, overrides: Partial<FakeLenderRow> = {}): FakeLenderRow {
  return {
    id,
    name,
    notes: null,
    minAmount: 10_000,
    maxAmount: 300_000,
    minCreditScore: null,
    minTimeInBusinessMonths: 0,
    contactName: `${name} contact`,
    contactEmail: `${id}@example.test`,
    ...overrides,
  };
}

function sqlParamValue(condition: { queryChunks?: unknown[] }): unknown {
  const parameter = condition.queryChunks?.find((chunk) =>
    (chunk as { constructor?: { name?: string } }).constructor?.name === "Param");
  return (parameter as { value?: unknown } | undefined)?.value;
}

/**
 * A transaction-shaped double: it implements the select/insert/update
 * builders used by the production executor and maintains rows between runs.
 * The exact-name lookup is backed by the value encoded in Drizzle's eq SQL
 * condition rather than by update-array position.
 */
function makeLenderSeedTransaction(initialRows: FakeLenderRow[]) {
  const rows = initialRows.map((row) => ({ ...row }));
  const events: Array<Record<string, unknown>> = [];
  let nextId = Math.max(0, ...rows.map((row) => row.id)) + 1;
  const transaction = {
    execute: async () => {
      events.push({ kind: "lock" });
      return [];
    },
    select(selection?: unknown) {
      return {
        from() {
          return {
            where(condition: { queryChunks?: unknown[] }) {
              if (selection === undefined) {
                const selected = rows.filter((row) =>
                  NEW_LENDER_SEEDS.some((seed) => seed.name === row.name)
                  || PRESERVED_LEGACY_LENDER_NAMES.includes(row.name as (typeof PRESERVED_LEGACY_LENDER_NAMES)[number]),
                );
                const result = {
                  then(resolve: (value: FakeLenderRow[]) => unknown, reject?: (reason: unknown) => unknown) {
                    return Promise.resolve(selected).then(resolve, reject);
                  },
                  for: async () => selected,
                };
                return result;
              }

              const exactName = sqlParamValue(condition);
              events.push({ kind: "lookup", name: exactName });
              const selected = rows.filter((row) => row.name === exactName);
              return {
                for: async () => selected,
              };
            },
          };
        },
      };
    },
    insert() {
      return {
        async values(values: FakeLenderRow) {
          events.push({ kind: "create", name: values.name });
          rows.push({ ...values, id: nextId++ });
          return [];
        },
      };
    },
    update() {
      return {
        set(values: Record<string, unknown>) {
          return {
            async where(condition: { queryChunks?: unknown[] }) {
              const id = sqlParamValue(condition);
              const row = rows.find((candidate) => candidate.id === id);
              if (!row) throw new Error(`fake update target ${String(id)} not found`);
              events.push({ kind: "update", name: row.name, values });
              Object.assign(row, values);
              return [row];
            },
          };
        },
      };
    },
  };
  return {
    rows,
    events,
    tx: transaction as unknown as LenderSeedTransaction,
  };
}

const STATE_LIST = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI",
  "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI",
  "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC",
  "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT",
  "VT", "VA", "WA", "WV", "WI", "WY", "PR",
];

test("seed literals have the exact mapped fields and exhaustive structured notes", () => {
  const dexly = NEW_LENDER_SEEDS.find((seed) => seed.name === "Dexly Finance");
  const thoro = NEW_LENDER_SEEDS.find((seed) => seed.name === "Thoro Corp");
  assert.ok(dexly);
  assert.ok(thoro);

  assert.deepEqual({
    name: dexly.name,
    programTypes: [...dexly.programTypes],
    minAmount: dexly.minAmount,
    maxAmount: dexly.maxAmount,
    minCreditScore: dexly.minCreditScore,
    minTimeInBusinessMonths: dexly.minTimeInBusinessMonths,
    acceptedStates: [...dexly.acceptedStates],
    contactEmail: dexly.contactEmail,
    isActive: dexly.isActive,
    acceptedIndustries: dexly.acceptedIndustries,
    maxExistingPositions: dexly.maxExistingPositions,
  }, {
    name: "Dexly Finance", programTypes: ["working_capital", "MCA"], minAmount: 75_000,
    maxAmount: 5_000_000, minCreditScore: null, minTimeInBusinessMonths: 12,
    acceptedStates: STATE_LIST, contactEmail: "underwriting@dexlyfinance.com",
    isActive: true, acceptedIndustries: [], maxExistingPositions: 5,
  });
  assert.match(dexly.notes, /Structured matcher fields now enforce/);
  assert.equal(dexly.minMonthlyRevenue, 200_000);
  assert.equal(dexly.restrictedIndustryMinMonthlyRevenue, 1_000_000);
  assert.deepEqual({ ...thoro, programTypes: [...thoro.programTypes], acceptedStates: [...thoro.acceptedStates] }, {
    name: "Thoro Corp",
    programTypes: ["working_capital", "MCA"],
    minAmount: 80_000,
    maxAmount: 5_000_000,
    minCreditScore: 500,
    minTimeInBusinessMonths: 6,
    acceptedStates: [],
    notes: EXPECTED_THORO_NOTES,
    isActive: true,
    acceptedIndustries: [],
  });
  assert.equal("contactName" in dexly, false);
  assert.equal("priorityWeight" in dexly, false);
  assert.equal("maxExistingPositions" in thoro, false);
  assert.equal(NEW_LENDER_SEEDS.length, 13);
});

test("the Section A seed literals preserve exact mapped fields, contacts, nulls, and notes", () => {
  const expected = [
    ["Navitas Credit Corp", ["equipment"], 10_000, 350_000, 660, 24, "myapplications@navitascredit.com"],
    ["Keystone Equipment Finance Corp (KEF)", ["equipment"], 10_000, 150_000, 550, 0, "jgothers@keystoneefc.com"],
    ["Channel Partners Capital", ["working_capital", "equipment"], 10_000, 400_000, 600, 12, "newdeals@channelpartnersllc.com"],
    ["TimePayment Corp", ["equipment"], 500, 1_500_000, null, 0, "brokerdesk@timepayment.com"],
    ["PEAC Solutions", ["equipment", "working_capital"], 10_000, 250_000, 640, 24, "ezucchi@PEACsolutions.com"],
    ["Luminar Capital", ["working_capital", "MCA"], 5_000, 150_000, 500, 12, "partners@luminarcapital.com"],
    ["Fenix Capital Funding", ["working_capital", "MCA"], null, 250_000, 500, 12, "iso@fenixcapitalfunding.com"],
  ] as const;
  const states = [
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI",
    "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI",
    "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC",
    "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT",
    "VT", "VA", "WA", "WV", "WI", "WY",
  ];

  for (const [name, programTypes, minAmount, maxAmount, minCreditScore, minTib, contactEmail] of expected) {
    const seed = NEW_LENDER_SEEDS.find((candidate) => candidate.name === name);
    assert.ok(seed, `missing seed ${name}`);
    assert.deepEqual([...seed.programTypes], programTypes);
    assert.equal(seed.minAmount, minAmount);
    assert.equal(seed.maxAmount, maxAmount);
    assert.equal(seed.minCreditScore, minCreditScore);
    assert.equal(seed.minTimeInBusinessMonths, minTib);
    const expectedStates = name === "Navitas Credit Corp"
      ? [...states, "DC"]
      : name === "Fenix Capital Funding"
        ? states.filter((state) => !["PR", "HI", "CA", "AK"].includes(state))
        : states;
    assert.deepEqual([...seed.acceptedStates], expectedStates);
    assert.equal(seed.contactEmail, contactEmail);
    assert.equal(seed.isActive, true);
    assert.match(seed.notes, /^SOURCE STATEMENTS \(verbatim\):/);
    assert.match(seed.notes, /SCHEMA MAPPING:/);
  }

  const navitas = NEW_LENDER_SEEDS.find((seed) => seed.name === "Navitas Credit Corp")!;
  assert.deepEqual([...navitas.acceptedStates], [...states, "DC"]);
  assert.match(navitas.notes, /commercial program \$250k–\$500k with financials/);
  assert.match(navitas.notes, /TRUCKING LONG-DISTANCE/);

  const kef = NEW_LENDER_SEEDS.find((seed) => seed.name === "Keystone Equipment Finance Corp (KEF)")!;
  assert.equal(kef.contactName, "Jake Gothers");
  assert.match(kef.notes, /NO: rebuilds\/reconditioned, glider kits, salvaged\/branded titles, working capital/);
  assert.match(kef.notes, /No working_capital program is mapped/);

  const timePayment = NEW_LENDER_SEEDS.find((seed) => seed.name === "TimePayment Corp")!;
  assert.equal(timePayment.minCreditScore, null);
  assert.match(timePayment.notes, /minCreditScore: null/);
  assert.match(timePayment.notes, /no credit minimum is inferred/);

  const peac = NEW_LENDER_SEEDS.find((seed) => seed.name === "PEAC Solutions")!;
  assert.equal(peac.contactName, "Elena Zucchi");
  assert.match(peac.notes, /WC criteria not in the extracted pages/);
  assert.match(peac.notes, /no WC-specific minimums are set/);

  const luminar = NEW_LENDER_SEEDS.find((seed) => seed.name === "Luminar Capital")!;
  assert.equal(luminar.contactName, "Misha Mikhaylov");
  assert.deepEqual([...luminar.programTypes], ["working_capital", "MCA"]);
  assert.match(luminar.notes, /working_capital \+ MCA/);
  assert.match(luminar.notes, /\$5K–\$150K; payoffs must net 50%\+/);

  const fenix = NEW_LENDER_SEEDS.find((seed) => seed.name === "Fenix Capital Funding")!;
  assert.deepEqual([...fenix.acceptedStates], states.filter((state) => !["PR", "HI", "CA", "AK"].includes(state)));
  assert.equal(fenix.minMonthlyRevenue, 20_000);
  assert.deepEqual([...fenix.prohibitedIndustries], [
    "adult entertainment", "gaming/gambling", "non-profit", "law firms", "auto sales",
    "bail bonds", "check cashing", "fix and flip", "TRUCKING", "auctions or pawn shops",
    "credit repair", "gas stations", "payroll or payment processing", "staffing",
    "property management (unless properties are owned by the merchant)",
    "money transfer services/financial institutions", "securities and commodities dealers",
    "financial brokers", "oil field services", "travel agencies",
  ]);
  assert.match(fenix.notes, /max funding \$250k for MCAs and \$375k for reverses/);
  assert.match(fenix.notes, /TRUCKING is prohibited/);
  assert.equal("contactName" in fenix, false);
  assert.equal("maxExistingPositions" in fenix, false);

  const maxim = NEW_LENDER_SEEDS.find((seed) => seed.name === "Maxim Commercial Capital")!;
  assert.deepEqual([...maxim.programTypes], ["equipment", "working_capital"]);
  assert.equal(maxim.minAmount, 20_000);
  assert.equal(maxim.maxAmount, 250_000);
  assert.equal(maxim.minCreditScore, null);
  assert.equal(maxim.minTimeInBusinessMonths, 0);
  assert.equal(maxim.minMonthlyRevenue, null);
  assert.equal(maxim.contactEmail, "submit@maximcc.com");
  assert.equal(maxim.acceptedStates.includes("TX"), true);
  assert.equal(maxim.acceptedStates.includes("AK"), false);
  assert.equal(maxim.acceptedStates.includes("HI"), false);
  assert.equal(maxim.acceptedStates.includes("LA"), false);
  assert.deepEqual(maxim.programEligibilityRules, [
    { programType: "working_capital", requiresCollateral: true },
  ]);
  assert.match(maxim.notes, /CREDIT TIER GRID \(a borrower must meet or beat ALL variables in a column/);
  assert.match(maxim.notes, /Bankruptcy and tax-lien restrictions are documented above but are not matcher-gated/i);
});

test("seed insert mapping carries explicit contacts and position caps without name special cases", () => {
  const byName = (name: string) => NEW_LENDER_SEEDS.find((seed) => seed.name === name)!;
  const dexlyInsert = newLenderSeedToInsertValues(byName("Dexly Finance"));
  const kefInsert = newLenderSeedToInsertValues(byName("Keystone Equipment Finance Corp (KEF)"));
  const peacInsert = newLenderSeedToInsertValues(byName("PEAC Solutions"));
  const luminarInsert = newLenderSeedToInsertValues(byName("Luminar Capital"));
  const thoroInsert = newLenderSeedToInsertValues(byName("Thoro Corp"));

  assert.equal(dexlyInsert.maxExistingPositions, 5);
  assert.equal(luminarInsert.maxExistingPositions, 4);
  assert.equal(kefInsert.contactName, "Jake Gothers");
  assert.equal(peacInsert.contactName, "Elena Zucchi");
  assert.equal(luminarInsert.contactName, "Misha Mikhaylov");
  assert.equal("contactName" in dexlyInsert, false);
  assert.equal("maxExistingPositions" in thoroInsert, false);
  assert.equal(thoroInsert.contactEmail, null);
});

test("the pure exact-name planner is idempotent and preserves existing names", () => {
  assert.deepEqual(planNewLenderSeeds([]), {
    toCreate: NEW_LENDER_SEEDS,
    unchangedNames: [],
  });
  assert.deepEqual(planNewLenderSeeds(["Dexly Finance", "Thoro Corp"]), {
    toCreate: NEW_LENDER_SEEDS.slice(2),
    unchangedNames: ["Dexly Finance", "Thoro Corp"],
  });
  const oneExisting = planNewLenderSeeds(["Dexly Finance"]);
  assert.deepEqual(oneExisting.toCreate.map((seed) => seed.name), NEW_LENDER_SEEDS.slice(1).map((seed) => seed.name));
  assert.deepEqual(oneExisting.unchangedNames, ["Dexly Finance"]);
  const allExisting = planNewLenderSeeds(NEW_LENDER_SEEDS.map((seed) => seed.name));
  assert.deepEqual(allExisting.toCreate, []);
  assert.deepEqual(allExisting.unchangedNames, NEW_LENDER_SEEDS.map((seed) => seed.name));

  const beforeMaxim = planNewLenderSeeds(
    NEW_LENDER_SEEDS.filter((seed) => seed.name !== "Maxim Commercial Capital").map((seed) => seed.name),
  );
  assert.deepEqual(beforeMaxim.toCreate.map((seed) => seed.name), ["Maxim Commercial Capital"]);
  assert.equal(beforeMaxim.unchangedNames.includes("Maxim Commercial Capital"), false);
});

test("Section B update literals preserve the exact marker, source statements, and schema mappings", () => {
  assert.deepEqual(EXISTING_LENDER_UPDATES.map((update) => update.name), [
    "Alliance Funding Group (AFG)",
    "AMUR Equipment Finance",
    "Y.E.S. Leasing",
    "Dexly Finance",
    "TimePayment Corp",
    "Keystone Equipment Finance Corp (KEF)",
  ]);
  for (const [index, update] of EXISTING_LENDER_UPDATES.entries()) {
    assert.equal(update.marker, index === 0
      ? AFG_TRUCKING_UPDATE_MARKER
      : index < 3 ? EXISTING_LENDER_UPDATE_MARKER : "2026-09-15 packet update");
    assert.match(update.notes, index === 0
      ? /^2026-09-18 AFG trucking criteria \(direct from partner\)\n\nSOURCE STATEMENTS \(verbatim\):/
      : /^2026-09-(14|15) packet update\n\nSOURCE STATEMENTS \(verbatim\):/);
    assert.match(update.notes, /SCHEMA MAPPING:/);
  }

  const afg = EXISTING_LENDER_UPDATES[0];
  assert.match(afg.notes, /TRUCKING \/ TRANSPORTATION \(OTR\): 5 years time in business/);
  assert.match(afg.notes, /vocational vehicles without guidelines but no tow trucks/);
  assert.match(afg.notes, /adaniel@afg\.com/);
  assert.equal(afg.notes.split(AFG_TRUCKING_UPDATE_MARKER).length - 1, 1);
  assert.equal(afg.marker, AFG_TRUCKING_UPDATE_MARKER);
  assert.equal(afg.structuredPatch.contactEmail, "acurtis@afg.com");
  assert.equal(afg.structuredPatch.minCreditScore, 600);
  assert.equal(afg.structuredPatch.minTimeInBusinessMonths, 48);
  assert.equal(afg.structuredPatch.maxAmount, 500_000);

  const amur = EXISTING_LENDER_UPDATES[1];
  assert.match(amur.notes, /Broker program tiers: A — app-only to \$350k/);
  assert.match(amur.notes, /leave 750000 and note "app-only cap \$350k" unless he confirms/);
  assert.deepEqual(amur.structuredPatch, {
    minCreditScore: 620,
    minTimeInBusinessMonths: 24,
    maxAmount: 750_000,
  });

  const yes = EXISTING_LENDER_UPDATES[2];
  assert.match(yes.notes, /2026 guidelines: NO personal credit requirement/);
  assert.match(yes.notes, /no changes to amounts; minCreditScore null/);
  assert.deepEqual(yes.structuredPatch, {});

  const dexly = EXISTING_LENDER_UPDATES[3];
  assert.match(dexly.notes, /Paper types: B to D/);
  assert.equal(dexly.structuredPatch.minMonthlyRevenue, 200_000);
  const timePayment = EXISTING_LENDER_UPDATES[4];
  assert.deepEqual(timePayment.structuredPatch.maxAmount, 150_000);
  const kef = EXISTING_LENDER_UPDATES[5];
  assert.match(kef.notes, /DEAL BREAKERS: under 500 scores/);
});

test("Section B appends preserve old notes and contacts while restricting structured patches", () => {
  const oldNotes = "Existing CRM note; contact Bobby at bobby@yesleasing.com.";
  const appended = appendExistingLenderUpdateNotes(oldNotes, EXISTING_LENDER_UPDATES[2].notes);
  assert.equal(appended.slice(0, oldNotes.length), oldNotes);
  assert.equal(appended.slice(oldNotes.length, oldNotes.length + 2), "\n\n");
  assert.match(appended, /2026-09-14 packet update/);
  assert.match(appended, /contact Bobby at bobby@yesleasing.com/);

  const allowedFields = new Set([
    "minAmount", "maxAmount", "minCreditScore", "minTimeInBusinessMonths",
    "restrictedIndustries", "prohibitedIndustries", "minMonthlyRevenue",
    "restrictedIndustryMinMonthlyRevenue", "truckingRules",
    "programEligibilityRules", "contactEmail",
  ]);
  for (const update of EXISTING_LENDER_UPDATES) {
    for (const field of Object.keys(update.structuredPatch)) {
      assert.equal(allowedFields.has(field), true, `${update.name} has an unapproved field: ${field}`);
    }
    assert.equal("contactName" in update.structuredPatch, false);
    assert.equal("contactEmail" in update.structuredPatch, update.name === "Alliance Funding Group (AFG)");
  }
});

test("production executor creates first, then applies Section B updates with only AFG contact correction", async () => {
  const afg = fakeLender("Alliance Funding Group (AFG)", 101, {
    notes: "AFG legacy notes",
    minAmount: 10_000,
    maxAmount: 500_000,
    minCreditScore: 600,
    minTimeInBusinessMonths: 48,
    contactName: "Atalie Daniel",
    contactEmail: "adaniel@afg.com",
  });
  const amur = fakeLender("AMUR Equipment Finance", 102, {
    notes: "AMUR legacy notes",
    maxAmount: 750_000,
    minCreditScore: 620,
    minTimeInBusinessMonths: 24,
    contactName: "Blake Anderson, CLFP",
    contactEmail: "BRAnderson@goamur.com",
  });
  const yes = fakeLender("Y.E.S. Leasing", 103, {
    notes: "Y.E.S. legacy notes",
    maxAmount: 300_000,
    minCreditScore: null,
    contactName: "Bobby",
    contactEmail: "bobby@yesleasing.com",
  });
  const double = makeLenderSeedTransaction([afg, amur, yes]);

  const first = await executeLenderSeedAndUpdates(double.tx);
  assert.equal(first.created, 13);
  assert.equal(first.updated, 3);
  assert.equal(first.unchanged, 0);
  assert.deepEqual(first.createdNames, NEW_LENDER_SEEDS.map((seed) => seed.name));
  assert.deepEqual(first.updatedNames, [
    "Alliance Funding Group (AFG)",
    "AMUR Equipment Finance",
    "Y.E.S. Leasing",
  ]);
  const firstUpdateIndex = double.events.findIndex((event) => event.kind === "update");
  let lastCreateIndex = -1;
  for (let index = 0; index < double.events.length; index += 1) {
    if (double.events[index].kind === "create") lastCreateIndex = index;
  }
  assert.ok(lastCreateIndex >= 0);
  assert.ok(lastCreateIndex < firstUpdateIndex, "all new seeds must be created before updates");
  assert.deepEqual(first.updatedExistingNames, [
    "Alliance Funding Group (AFG)",
    "AMUR Equipment Finance",
    "Y.E.S. Leasing",
    "Dexly Finance",
    "TimePayment Corp",
    "Keystone Equipment Finance Corp (KEF)",
  ]);

  assert.match(String(double.rows.find((row) => row.name === afg.name)?.notes), /^AFG legacy notes\n\n2026-09-18 AFG trucking criteria \(direct from partner\)/);
  assert.equal(afg.contactName, double.rows.find((row) => row.name === afg.name)?.contactName);
  assert.equal(double.rows.find((row) => row.name === afg.name)?.contactEmail, "acurtis@afg.com");
  assert.equal(double.rows.find((row) => row.name === afg.name)?.minCreditScore, 600);
  assert.equal(double.rows.find((row) => row.name === afg.name)?.minTimeInBusinessMonths, 48);
  assert.equal(double.rows.find((row) => row.name === afg.name)?.maxAmount, 500_000);

  assert.equal(double.rows.find((row) => row.name === amur.name)?.maxAmount, 750_000);
  assert.equal(double.rows.find((row) => row.name === amur.name)?.minCreditScore, 620);
  assert.equal(double.rows.find((row) => row.name === amur.name)?.minTimeInBusinessMonths, 24);
  assert.equal(double.rows.find((row) => row.name === amur.name)?.contactEmail, "BRAnderson@goamur.com");

  assert.equal(double.rows.find((row) => row.name === yes.name)?.maxAmount, 300_000);
  assert.equal(double.rows.find((row) => row.name === yes.name)?.minCreditScore, null);
  assert.equal(double.rows.find((row) => row.name === yes.name)?.contactName, "Bobby");

  const updateEvents = double.events.filter((event) => event.kind === "update");
  for (const event of updateEvents) {
    const values = event.values as Record<string, unknown>;
    assert.equal("contactName" in values, false);
    assert.equal("contactEmail" in values, event.name === "Alliance Funding Group (AFG)");
  }
  const afgValues = updateEvents.find((event) => event.name === afg.name)?.values as Record<string, unknown>;
  assert.deepEqual(
    Object.fromEntries(Object.entries(afgValues).filter(([key]) => key !== "notes" && key !== "updatedAt")),
    {
      minCreditScore: 600,
      minTimeInBusinessMonths: 48,
      maxAmount: 500_000,
      contactEmail: "acurtis@afg.com",
      programEligibilityRules: EXISTING_LENDER_UPDATES[0].structuredPatch.programEligibilityRules,
    },
  );

  const updatesAfterFirstRun = double.events.filter((event) => event.kind === "update").length;
  const second = await executeLenderSeedAndUpdates(double.tx);
  assert.deepEqual(second.updatedExistingNames, []);
  assert.deepEqual(second.unchangedExistingNames, [
    "Alliance Funding Group (AFG)",
    "AMUR Equipment Finance",
    "Y.E.S. Leasing",
    "Dexly Finance",
    "TimePayment Corp",
    "Keystone Equipment Finance Corp (KEF)",
  ]);
  assert.equal(
    double.events.filter((event) => event.kind === "update").length,
    updatesAfterFirstRun,
    "a marker-bearing second execution must issue zero updates",
  );
  assert.equal(second.created, 0);
  assert.equal(second.updated, 0);
  assert.equal(second.unchanged, 16);
  assert.deepEqual(second.unchangedNames, [
    ...NEW_LENDER_SEEDS.map((seed) => seed.name),
    "Alliance Funding Group (AFG)",
    "AMUR Equipment Finance",
    "Y.E.S. Leasing",
  ]);
});

test("seed operation reports the unique configured lender inventory and updates", async () => {
  const double = makeLenderSeedTransaction([
    fakeLender("Dexly Finance", 301),
    fakeLender("Thoro Corp", 302),
    fakeLender("Alliance Funding Group (AFG)", 303, { notes: "AFG old" }),
    fakeLender("AMUR Equipment Finance", 304, { notes: "AMUR old" }),
    fakeLender("Y.E.S. Leasing", 305, { notes: "YES old" }),
  ]);

  const first = await executeLenderSeedAndUpdates(double.tx);
  assert.equal(first.created, 11);
  assert.equal(first.updated, 4);
  assert.equal(first.unchanged, 1);
  assert.deepEqual(first.createdNames, NEW_LENDER_SEEDS.slice(2).map((seed) => seed.name));
  assert.deepEqual(first.unchangedNames, ["Thoro Corp"]);
  assert.deepEqual(first.missingUpdateNames, []);

  const second = await executeLenderSeedAndUpdates(double.tx);
  assert.equal(second.created, 0);
  assert.equal(second.updated, 0);
  assert.equal(second.unchanged, 16);
  assert.deepEqual(second.unchangedNames, [
    ...NEW_LENDER_SEEDS.map((seed) => seed.name),
    "Alliance Funding Group (AFG)",
    "AMUR Equipment Finance",
    "Y.E.S. Leasing",
  ]);
  assert.deepEqual(second.missingUpdateNames, []);
});

test("production executor uses exact names and does not recreate a missing Section B lender", async () => {
  const double = makeLenderSeedTransaction([
    fakeLender("Alliance Funding Group (AFG)", 201, { notes: "AFG old" }),
    fakeLender("Y.E.S. Leasing", 202, { notes: "YES old" }),
    fakeLender("AMUR Equipment Finance - alias", 203, { notes: "alias must remain" }),
  ]);

  const result = await executeLenderSeedAndUpdates(double.tx);
  assert.equal(result.updated, 2);
  assert.equal(result.unchanged, 0);
  assert.deepEqual(result.updatedNames, [
    "Alliance Funding Group (AFG)",
    "Y.E.S. Leasing",
  ]);
  assert.deepEqual(result.missingUpdateNames, ["AMUR Equipment Finance"]);
  assert.deepEqual(result.missingExistingNames, ["AMUR Equipment Finance"]);
  assert.equal(double.rows.some((row) => row.name === "AMUR Equipment Finance"), false);
  assert.equal(double.rows.find((row) => row.name === "AMUR Equipment Finance - alias")?.notes, "alias must remain");
  assert.deepEqual(
    double.events.filter((event) => event.kind === "lookup").map((event) => event.name),
    [
      "Alliance Funding Group (AFG)",
      "AMUR Equipment Finance",
      "Y.E.S. Leasing",
      "Dexly Finance",
      "TimePayment Corp",
      "Keystone Equipment Finance Corp (KEF)",
    ],
  );
  assert.equal(
    double.events.some((event) => event.kind === "update" && event.name === "AMUR Equipment Finance"),
    false,
  );
});

test("structured gates backfill after an earlier packet marker and remain idempotent", async () => {
  const priorPacketNotes = `legacy note\n\n${EXISTING_LENDER_UPDATE_MARKER}\nprior packet source`;
  const double = makeLenderSeedTransaction([
    fakeLender("Alliance Funding Group (AFG)", 401, { notes: priorPacketNotes }),
  ]);

  const first = await executeLenderSeedAndUpdates(double.tx);
  assert.equal(first.updatedNames.includes("Alliance Funding Group (AFG)"), true);
  const backfill = double.events.find((event) => event.kind === "update" && event.name === "Alliance Funding Group (AFG)");
  assert.ok(backfill);
  assert.ok((backfill.values as Record<string, unknown>).programEligibilityRules);
  assert.match(
    String(double.rows.find((row) => row.name === "Alliance Funding Group (AFG)")?.notes),
    /2026-09-16 structured matcher gate backfill/,
  );

  const updatesAfterFirst = double.events.filter((event) => event.kind === "update").length;
  const second = await executeLenderSeedAndUpdates(double.tx);
  assert.equal(second.updatedNames.includes("Alliance Funding Group (AFG)"), false);
  assert.equal(double.events.filter((event) => event.kind === "update").length, updatesAfterFirst);
});

test("a prior packet marker without the new AFG marker is updated once and then unchanged", async () => {
  const afgUpdate = EXISTING_LENDER_UPDATES.find((update) => update.name === "Alliance Funding Group (AFG)")!;
  // jsonb does not preserve JS insertion order, including nested rule objects.
  const reorderKeys = (value: unknown): unknown =>
    Array.isArray(value) ? value.map(reorderKeys) :
    value !== null && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorderKeys(item)]))
      : value;
  const databasePatch = reorderKeys(afgUpdate.structuredPatch) as Partial<FakeLenderRow>;
  assert.notEqual(JSON.stringify(databasePatch), JSON.stringify(afgUpdate.structuredPatch));
  const double = makeLenderSeedTransaction([
    fakeLender("Alliance Funding Group (AFG)", 402, {
      notes: `legacy note\n\n${EXISTING_LENDER_UPDATE_MARKER}\nprior packet source`,
      ...databasePatch,
    }),
  ]);

  const result = await executeLenderSeedAndUpdates(double.tx);
  assert.equal(result.updatedNames.includes("Alliance Funding Group (AFG)"), true);
  assert.equal(
    double.events.some((event) => event.kind === "update" && event.name === "Alliance Funding Group (AFG)"),
    true,
  );
  const updatedNotes = double.rows.find((row) => row.name === "Alliance Funding Group (AFG)")?.notes ?? "";
  assert.equal(updatedNotes.split(AFG_TRUCKING_UPDATE_MARKER).length - 1, 1);
  assert.equal(double.rows.find((row) => row.name === "Alliance Funding Group (AFG)")?.contactEmail, "acurtis@afg.com");

  const updatesAfterFirst = double.events.filter((event) => event.kind === "update").length;
  const rerun = await executeLenderSeedAndUpdates(double.tx);
  assert.equal(rerun.updatedNames.includes("Alliance Funding Group (AFG)"), false);
  assert.equal(double.events.filter((event) => event.kind === "update").length, updatesAfterFirst);
});

test("prior packet inventory includes the new AFG update and three unapplied September 15 updates", async () => {
  const reorderJsonb = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(reorderJsonb);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .reverse()
          .map(([key, nested]) => [key, reorderJsonb(nested)]),
      );
    }
    return value;
  };
  const migrationEquivalentSeed = (seedName: string, id: number): FakeLenderRow => {
    const seed = NEW_LENDER_SEEDS.find((candidate) => candidate.name === seedName)!;
    const canonical = newLenderSeedToInsertValues(seed) as unknown as FakeLenderRow;
    return {
      ...fakeLender(seedName, id),
      ...canonical,
      id,
      name: seedName,
      notes: canonical.notes?.replaceAll(BATCH_2_LENDER_UPDATE_MARKER, "prior source packet") ?? null,
      programEligibilityRules: reorderJsonb(canonical.programEligibilityRules),
    };
  };
  const priorExisting = (name: string, id: number): FakeLenderRow => {
    const update = EXISTING_LENDER_UPDATES.find((candidate) => candidate.name === name)!;
    return {
      ...fakeLender(name, id),
      ...(update.matchingBaseline as Partial<FakeLenderRow>),
      ...(update.structuredPatch as Partial<FakeLenderRow>),
      id,
      name,
      notes: `legacy notes\n\n${EXISTING_LENDER_UPDATE_MARKER}\nprior packet source`,
      programEligibilityRules: "programEligibilityRules" in update.structuredPatch
        ? reorderJsonb(update.structuredPatch.programEligibilityRules)
        : null,
    };
  };

  const oldSeedNames = NEW_LENDER_SEEDS.slice(0, 8).map((seed) => seed.name);
  const initialRows = [
    ...oldSeedNames.map((name, index) => migrationEquivalentSeed(name, index + 1)),
    priorExisting("Alliance Funding Group (AFG)", 101),
    priorExisting("AMUR Equipment Finance", 102),
    priorExisting("Y.E.S. Leasing", 103),
  ];
  assert.equal(initialRows.every((row) => !row.notes?.includes(BATCH_2_LENDER_UPDATE_MARKER)), true);
  assert.equal(
    initialRows.find((row) => row.name === "TimePayment Corp")?.maxAmount,
    1_500_000,
  );

  const double = makeLenderSeedTransaction(initialRows);
  const first = await executeLenderSeedAndUpdates(double.tx);
  const expectedInventory = [
    ...NEW_LENDER_SEEDS.map((seed) => seed.name),
    "Alliance Funding Group (AFG)",
    "AMUR Equipment Finance",
    "Y.E.S. Leasing",
  ].sort();
  assert.equal(first.created, 5);
  assert.equal(first.updated, 4);
  assert.equal(first.unchanged, 7);
  assert.deepEqual(first.createdNames, NEW_LENDER_SEEDS.slice(8).map((seed) => seed.name));
  assert.deepEqual(first.updatedNames, [
    "Alliance Funding Group (AFG)",
    "Dexly Finance",
    "TimePayment Corp",
    "Keystone Equipment Finance Corp (KEF)",
  ]);
  assert.deepEqual(
    [...first.createdNames, ...first.updatedNames, ...first.unchangedNames].sort(),
    expectedInventory,
  );
  assert.equal(new Set([...first.createdNames, ...first.updatedNames, ...first.unchangedNames]).size, 16);

  const second = await executeLenderSeedAndUpdates(double.tx);
  assert.equal(second.created, 0);
  assert.equal(second.updated, 0);
  assert.equal(second.unchanged, 16);
  assert.deepEqual(second.unchangedNames.sort(), expectedInventory);
});

test("Section D seeds one missing lender and updates old AFG marker exactly once", async () => {
  const seedRows = NEW_LENDER_SEEDS
    .filter((seed) => seed.name !== "Fenix Capital Funding")
    .map((seed, index) => ({
      ...fakeLender(seed.name, index + 1),
      ...(newLenderSeedToInsertValues(seed) as unknown as Partial<FakeLenderRow>),
      id: index + 1,
      name: seed.name,
    }));
  const initialRows = [
    ...seedRows,
    fakeLender("Alliance Funding Group (AFG)", 101, {
      notes: `legacy notes\n\n${AFG_TRUCKING_UPDATE_MARKER}\nold source`,
      contactEmail: "adaniel@afg.com",
    }),
    fakeLender("AMUR Equipment Finance", 102, {
      notes: `${EXISTING_LENDER_UPDATE_MARKER}\nprior source`,
    }),
    fakeLender("Y.E.S. Leasing", 103, {
      notes: `${EXISTING_LENDER_UPDATE_MARKER}\nprior source`,
    }),
    fakeLender(PRESERVED_LEGACY_LENDER_NAMES[0], 104),
  ];
  for (const row of seedRows) {
    if (["Dexly Finance", "TimePayment Corp", "Keystone Equipment Finance Corp (KEF)"].includes(row.name)) {
      const update = EXISTING_LENDER_UPDATES.find((candidate) => candidate.name === row.name)!;
      Object.assign(row, applyExistingLenderUpdate(row, update));
    }
  }
  assert.equal(initialRows.length, 16);

  const double = makeLenderSeedTransaction(initialRows);
  const first = await executeLenderSeedAndUpdates(double.tx);
  assert.deepEqual(first.updatedNames, ["Alliance Funding Group (AFG)"]);
  assert.equal(first.created, 1);
  assert.equal(first.updated, 1);
  assert.equal(first.unchanged, 15);
  assert.equal(double.rows.length, 17);
  assert.deepEqual(first.createdNames, ["Fenix Capital Funding"]);
  assert.equal(double.rows.find((row) => row.name === "Alliance Funding Group (AFG)")?.contactEmail, "acurtis@afg.com");

  const second = await executeLenderSeedAndUpdates(double.tx);
  assert.equal(second.created, 0);
  assert.equal(second.updated, 0);
  assert.equal(second.unchanged, 17);
  assert.equal(double.rows.length, 17);

  const withoutLegacy = makeLenderSeedTransaction(
    initialRows.filter((row) => row.name !== PRESERVED_LEGACY_LENDER_NAMES[0]),
  );
  const missingLegacyResult = await executeLenderSeedAndUpdates(withoutLegacy.tx);
  assert.equal(missingLegacyResult.created, 1);
  assert.equal(missingLegacyResult.updated, 1);
  assert.equal(missingLegacyResult.unchangedNames.includes(PRESERVED_LEGACY_LENDER_NAMES[0]), false);
  assert.equal(withoutLegacy.rows.some((row) => row.name === PRESERVED_LEGACY_LENDER_NAMES[0]), false);
});

test("the original four-lender seed script remains byte-unchanged", () => {
  assert.doesNotThrow(() => {
    execFileSync("git", ["diff", "--quiet", "--", "lib/db/seed-lenders.mjs"], {
      stdio: "ignore",
    });
  });
});