import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
// @ts-expect-error Node's strip-types test runner resolves explicit .ts imports.
import { NEW_LENDER_SEEDS, planNewLenderSeeds } from "./newLenderSeeds.ts";

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
  assert.doesNotMatch(JSON.stringify(NEW_LENDER_SEEDS), /Luminar/);
});

test("the pure exact-name planner is idempotent and preserves existing names", () => {
  assert.deepEqual(planNewLenderSeeds([]), {
    toCreate: NEW_LENDER_SEEDS,
    unchangedNames: [],
  });
  assert.deepEqual(planNewLenderSeeds(["Dexly Finance", "Thoro Corp"]), {
    toCreate: [],
    unchangedNames: ["Dexly Finance", "Thoro Corp"],
  });
  const oneExisting = planNewLenderSeeds(["Dexly Finance"]);
  assert.deepEqual(oneExisting.toCreate.map((seed) => seed.name), ["Thoro Corp"]);
  assert.deepEqual(oneExisting.unchangedNames, ["Dexly Finance"]);
});

test("the original four-lender seed script remains byte-unchanged", () => {
  assert.doesNotThrow(() => {
    execFileSync("git", ["diff", "--quiet", "--", "lib/db/seed-lenders.mjs"], {
      stdio: "ignore",
    });
  });
});