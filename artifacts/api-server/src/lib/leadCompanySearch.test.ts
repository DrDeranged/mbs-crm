import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";

process.env.DATABASE_URL ??= "postgresql://integration-test.invalid/test";

test("lead search matches company-table identity in one correlated SQL query", async () => {
  const { buildLeadSearchCondition, leadToApi } = await import("../routes/leads");
  const condition = buildLeadSearchCondition("Northstar Group");
  assert(condition);
  const compiled = new PgDialect().sqlToQuery(condition);
  assert.match(compiled.sql, /exists/i);
  assert.match(compiled.sql, /companies"?\."?name/i);
  assert.match(compiled.sql, /companies"?\."?lead_id/i);
  assert.match(compiled.sql, /leads"?\."?company_name/i);
  assert.equal((compiled.sql.match(/exists/gi) ?? []).length, 1);
  assert(compiled.params.includes("%Northstar Group%"));

  const response = leadToApi({
    id: 81,
    firstName: "  Avery ",
    lastName: "Morgan  ",
    companyName: null,
    email: "avery@example.com",
    phone: null,
    ein: null,
    applicationType: null,
    status: "new_lead",
    assignedRepId: 7,
    leadSource: "manual",
    requestedAmount: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    lastActivityAt: null,
    leadScore: null,
    leadScoreBreakdown: null,
    aiSummary: null,
    aiSummaryGeneratedAt: null,
    fundedAt: null,
    fundedAmount: null,
    estimatedTermMonths: null,
    renewalFlaggedAt: null,
  } as any, null, null, null, 7, "  Northstar Group  ");

  assert.equal(response.companyName, "Northstar Group");
  assert.equal(response.entityLabel, "Northstar Group — Avery Morgan");
});