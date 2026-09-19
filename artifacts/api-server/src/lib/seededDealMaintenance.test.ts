import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node's strip-types test runner resolves explicit .ts imports.
import { ALL_SEED_DEAL_NAMES, validateSeededDealRows, type SeededDealRow, type SeededAssignedUser } from "./seededDealMaintenance.ts";
// @ts-expect-error Node's strip-types test runner resolves explicit .ts imports.
import { normalizeFundingTimeDays } from "./analyticsHelpers.ts";

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

test("rejects conflicting Calvin markers and assignees", () => {
  assert.notEqual(
    validateSeededDealRows(rows({ "Four Pillars": { intendedRepSlug: "other" } }), [sourceUser]),
    null,
  );
  assert.notEqual(
    validateSeededDealRows(
      rows({ "Four Pillars": { assignedTo: 99, intendedRepSlug: "calvin" } }),
      [sourceUser, { id: 99, slug: "not-calvin" }],
    ),
    null,
  );
});

test("normalizes funding duration to a nonnegative whole day or null", () => {
  assert.equal(normalizeFundingTimeDays(-0.1), 0);
  assert.equal(normalizeFundingTimeDays(1.6), 2);
  assert.equal(normalizeFundingTimeDays(null), null);
});
