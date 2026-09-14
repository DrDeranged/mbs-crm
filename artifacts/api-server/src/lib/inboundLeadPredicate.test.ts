import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node's strip-types test runner resolves explicit .ts imports.
import { isUnassignedInboundLead } from "./inboundLeadPredicate.ts";

const NOW = new Date("2025-01-02T12:00:00.000Z");

function lead(overrides: Partial<Parameters<typeof isUnassignedInboundLead>[0]> = {}) {
  return {
    assignedRepId: null,
    leadSource: "website",
    createdAt: new Date("2024-12-31T11:59:59.000Z"),
    ...overrides,
  };
}

test("matches an unassigned inbound lead older than 24 hours", () => {
  assert.equal(isUnassignedInboundLead(lead(), NOW), true);
});

test("does not match a lead exactly at the 24-hour boundary", () => {
  assert.equal(
    isUnassignedInboundLead({ ...lead(), createdAt: new Date("2025-01-01T12:00:00.000Z") }, NOW),
    false,
  );
});

test("does not match assigned, non-inbound, or recent leads", () => {
  assert.equal(isUnassignedInboundLead({ ...lead(), assignedRepId: 7 }, NOW), false);
  assert.equal(isUnassignedInboundLead({ ...lead(), leadSource: "manual" }, NOW), false);
  assert.equal(
    isUnassignedInboundLead({ ...lead(), leadSource: "qr-card", createdAt: new Date("2025-01-02T00:00:01.000Z") }, NOW),
    false,
  );
});
