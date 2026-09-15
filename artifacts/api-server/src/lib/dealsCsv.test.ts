import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://integration-test.invalid/test";

test("deal CSV includes notes and split percentage values", async () => {
  const { dealCsvHeaders, dealCsvRow } = await import("./dealsCsv");
  const now = new Date("2025-01-01T00:00:00.000Z");
  const row = dealCsvRow({
    id: 1,
    leadId: null,
    dealName: "CSV Deal",
    stage: "funded",
    amount: 10000,
    approxGm: 1000,
    actualGm: 880,
    notes: "Booked",
    gmSplitPct: 50,
    assignedTo: null,
    intendedRepSlug: null,
    createdAt: now,
    updatedAt: now,
    fundedAt: now,
    isArchived: false,
  } as any);

  assert.ok(dealCsvHeaders.includes("Notes"));
  assert.ok(dealCsvHeaders.includes("gmSplitPct"));
  assert.equal(row[dealCsvHeaders.indexOf("Notes")], "Booked");
  assert.equal(row[dealCsvHeaders.indexOf("gmSplitPct")], 50);
});