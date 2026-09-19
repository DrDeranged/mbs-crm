import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node's strip-types test runner resolves explicit .ts imports.
import { ALL_SEED_DEAL_NAMES, selectMatchingSeededDealRows, validateSeededDealRows, type SeededDealRow, type SeededAssignedUser } from "./seededDealMaintenance.ts";
// @ts-expect-error Node's strip-types test runner resolves explicit .ts imports.
import { normalizeFundingTimeDays } from "./analyticsHelpers.ts";
// @ts-expect-error Node's strip-types test runner resolves explicit .ts imports.
import { planSeededOwnershipCorrections } from "./productionMaintenance.ts";

const CALVIN_NAMES = new Set([
  "Mitchell & Vereen Transportation LLC",
  "Four Pillars",
  "Antleys",
  "R2Muse Trucking",
]);

function rows(overrides: Partial<Record<string, Partial<SeededDealRow>>> = {}): SeededDealRow[] {
  return ALL_SEED_DEAL_NAMES.map((dealName) => ({
    dealName,
    assignedTo: 7,
    intendedRepSlug: CALVIN_NAMES.has(dealName) ? null : null,
    ...overrides[dealName],
  }));
}

const sourceUser: SeededAssignedUser = { id: 7, slug: null };

test("accepts Calvin source ownership with a missing marker for repair", () => {
  assert.equal(validateSeededDealRows(rows(), [sourceUser]), null);
});

test("accepts a real Calvin assignee with the Calvin marker", () => {
  assert.equal(
    validateSeededDealRows(
      rows({ "Four Pillars": { assignedTo: 99, intendedRepSlug: "calvin" } }),
      [sourceUser, { id: 99, slug: "calvin" }],
    ),
    null,
  );
});

test("accepts an already-unassigned Calvin reservation", () => {
  assert.equal(
    validateSeededDealRows(
      rows({ "Four Pillars": { assignedTo: null, intendedRepSlug: "calvin" } }),
      [sourceUser],
    ),
    null,
  );
});

test("unchanged seeded ownership produces no corrections or assignment activity inputs", () => {
  const desired = rows();
  for (const row of desired) {
    row.assignedTo = CALVIN_NAMES.has(row.dealName) ? 18 : 16;
    row.intendedRepSlug = CALVIN_NAMES.has(row.dealName) ? "calvin" : null;
  }

  const plan = planSeededOwnershipCorrections(desired.map((row, id) => ({ id, ...row })), [
    { id: 16, slug: "nate" },
    { id: 18, slug: "calvin" },
  ]);

  assert.deepEqual(plan.ordinaryToNate, []);
  assert.deepEqual(plan.calvinToClear, []);
  assert.deepEqual(plan.calvinMarkerOnly, []);
});

test("closeout preserves a real Calvin assignment instead of creating a clear/reconcile loop", () => {
  const [deal] = planSeededOwnershipCorrections([
    {
      id: 19,
      dealName: "Mitchell & Vereen Transportation LLC",
      assignedTo: 18,
      intendedRepSlug: "calvin",
    },
  ], [{ id: 18, slug: "calvin" }]).calvinToClear;

  assert.equal(deal, undefined);
});

test("tolerates converted or deleted seed rows and reports only matching markers", () => {
  const partialRows = rows({
    "Four Pillars": { assignedTo: 99, intendedRepSlug: "calvin" },
  }).slice(0, -1);
  const matching = selectMatchingSeededDealRows(partialRows, [
    sourceUser,
    { id: 99, slug: "not-calvin" },
  ]);

  assert.equal(matching.length, ALL_SEED_DEAL_NAMES.length - 2);
  assert.equal(validateSeededDealRows(partialRows, [sourceUser, { id: 99, slug: "not-calvin" }]), null);
});

test("fails closeout only when no matching seeded rows remain", () => {
  assert.match(
    validateSeededDealRows([
      { dealName: "Four Pillars", assignedTo: 99, intendedRepSlug: "calvin" },
    ], [{ id: 99, slug: "not-calvin" }]) ?? "",
    /0 of 25/,
  );
});

test("normalizes funding duration to a nonnegative whole day or null", () => {
  assert.equal(normalizeFundingTimeDays(-0.1), 0);
  assert.equal(normalizeFundingTimeDays(1.6), 2);
  assert.equal(normalizeFundingTimeDays(null), null);
});
