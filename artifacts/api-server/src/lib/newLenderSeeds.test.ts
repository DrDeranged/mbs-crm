import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  EXISTING_LENDER_UPDATE_MARKER,
  EXISTING_LENDER_UPDATES,
  NEW_LENDER_SEEDS,
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
                  NEW_LENDER_SEEDS.some((seed) => seed.name === row.name),
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

  assert.deepEqual({ ...dexly, programTypes: [...dexly.programTypes], acceptedStates: [...dexly.acceptedStates] }, {
    name: "Dexly Finance",
    programTypes: ["working_capital", "MCA"],
    minAmount: 75_000,
    maxAmount: 5_000_000,
    minCreditScore: null,
    minTimeInBusinessMonths: 12,
    acceptedStates: STATE_LIST,
    contactEmail: "underwriting@dexlyfinance.com",
    notes: EXPECTED_DEXLY_NOTES,
    isActive: true,
    acceptedIndustries: [],
    maxExistingPositions: 5,
  });
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
  assert.equal(NEW_LENDER_SEEDS.length, 8);
});

test("the six Section A seed literals preserve exact mapped fields, contacts, nulls, and notes", () => {
  const expected = [
    ["Navitas Credit Corp", ["equipment"], 10_000, 350_000, 660, 24, "myapplications@navitascredit.com"],
    ["Keystone Equipment Finance Corp (KEF)", ["equipment"], 10_000, 150_000, 550, 0, "jgothers@keystoneefc.com"],
    ["Channel Partners Capital", ["working_capital", "equipment"], 10_000, 400_000, 600, 12, "newdeals@channelpartnersllc.com"],
    ["TimePayment Corp", ["equipment"], 500, 1_500_000, null, 0, "brokerdesk@timepayment.com"],
    ["PEAC Solutions", ["equipment", "working_capital"], 10_000, 250_000, 640, 24, "ezucchi@PEACsolutions.com"],
    ["Luminar Capital", ["working_capital", "MCA"], 5_000, 150_000, 500, 12, "partners@luminarcapital.com"],
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
    assert.deepEqual([...seed.acceptedStates], name === "Navitas Credit Corp" ? [...states, "DC"] : states);
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
});

test("Section B update literals preserve the exact marker, source statements, and schema mappings", () => {
  assert.deepEqual(EXISTING_LENDER_UPDATES.map((update) => update.name), [
    "Alliance Funding Group (AFG)",
    "AMUR Equipment Finance",
    "Y.E.S. Leasing",
  ]);
  for (const update of EXISTING_LENDER_UPDATES) {
    assert.equal(update.marker, EXISTING_LENDER_UPDATE_MARKER);
    assert.match(update.notes, /^2026-09-14 packet update\n\nSOURCE STATEMENTS \(verbatim\):/);
    assert.match(update.notes, /SCHEMA MAPPING:/);
  }

  const afg = EXISTING_LENDER_UPDATES[0];
  assert.match(afg.notes, /WORKING CAPITAL \(Premium WC, app-only to \$300k; up to \$3MM with financials\)/);
  assert.match(afg.notes, /maxAmount stays 500000 \(EF app-only\); WC app-only 300000 in notes\./);
  assert.deepEqual(afg.structuredPatch, {
    minCreditScore: 600,
    minTimeInBusinessMonths: 48,
    maxAmount: 500_000,
  });

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
});

test("Section B appends preserve old notes and contacts while restricting structured patches", () => {
  const oldNotes = "Existing CRM note; contact Bobby at bobby@yesleasing.com.";
  const appended = appendExistingLenderUpdateNotes(oldNotes, EXISTING_LENDER_UPDATES[2].notes);
  assert.equal(appended.slice(0, oldNotes.length), oldNotes);
  assert.equal(appended.slice(oldNotes.length, oldNotes.length + 2), "\n\n");
  assert.match(appended, /2026-09-14 packet update/);
  assert.match(appended, /contact Bobby at bobby@yesleasing.com/);

  const allowedFields = new Set(["minAmount", "maxAmount", "minCreditScore", "minTimeInBusinessMonths"]);
  for (const update of EXISTING_LENDER_UPDATES) {
    for (const field of Object.keys(update.structuredPatch)) {
      assert.equal(allowedFields.has(field), true, `${update.name} has an unapproved field: ${field}`);
    }
    assert.equal("contactName" in update.structuredPatch, false);
    assert.equal("contactEmail" in update.structuredPatch, false);
  }
});

test("production executor creates first, then applies Section B updates without touching contacts", async () => {
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
  ]);

  assert.match(String(double.rows.find((row) => row.name === afg.name)?.notes), /^AFG legacy notes\n\n2026-09-14 packet update/);
  assert.equal(afg.contactName, double.rows.find((row) => row.name === afg.name)?.contactName);
  assert.equal(afg.contactEmail, double.rows.find((row) => row.name === afg.name)?.contactEmail);
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
    assert.equal("contactEmail" in values, false);
  }
  const afgValues = updateEvents.find((event) => event.name === afg.name)?.values as Record<string, unknown>;
  assert.deepEqual(
    Object.fromEntries(Object.entries(afgValues).filter(([key]) => key !== "notes" && key !== "updatedAt")),
    { minCreditScore: 600, minTimeInBusinessMonths: 48, maxAmount: 500_000 },
  );

  const updatesAfterFirstRun = double.events.filter((event) => event.kind === "update").length;
  const second = await executeLenderSeedAndUpdates(double.tx);
  assert.deepEqual(second.updatedExistingNames, []);
  assert.deepEqual(second.unchangedExistingNames, [
    "Alliance Funding Group (AFG)",
    "AMUR Equipment Finance",
    "Y.E.S. Leasing",
  ]);
  assert.equal(
    double.events.filter((event) => event.kind === "update").length,
    updatesAfterFirstRun,
    "a marker-bearing second execution must issue zero updates",
  );
});

test("production executor uses exact names and does not recreate a missing Section B lender", async () => {
  const double = makeLenderSeedTransaction([
    fakeLender("Alliance Funding Group (AFG)", 201, { notes: "AFG old" }),
    fakeLender("Y.E.S. Leasing", 202, { notes: "YES old" }),
    fakeLender("AMUR Equipment Finance - alias", 203, { notes: "alias must remain" }),
  ]);

  const result = await executeLenderSeedAndUpdates(double.tx);
  assert.deepEqual(result.missingExistingNames, ["AMUR Equipment Finance"]);
  assert.equal(double.rows.some((row) => row.name === "AMUR Equipment Finance"), false);
  assert.equal(double.rows.find((row) => row.name === "AMUR Equipment Finance - alias")?.notes, "alias must remain");
  assert.deepEqual(
    double.events.filter((event) => event.kind === "lookup").map((event) => event.name),
    ["Alliance Funding Group (AFG)", "AMUR Equipment Finance", "Y.E.S. Leasing"],
  );
  assert.equal(
    double.events.some((event) => event.kind === "update" && event.name === "AMUR Equipment Finance"),
    false,
  );
});

test("the original four-lender seed script remains byte-unchanged", () => {
  assert.doesNotThrow(() => {
    execFileSync("git", ["diff", "--quiet", "--", "lib/db/seed-lenders.mjs"], {
      stdio: "ignore",
    });
  });
});