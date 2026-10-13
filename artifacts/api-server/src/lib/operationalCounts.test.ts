import assert from "node:assert/strict";
import test from "node:test";
import { sql, and } from "drizzle-orm";
import { PgDialect, PgSelectBuilder } from "drizzle-orm/pg-core";
import { leadsTable } from "@workspace/db";
import { inboundCallCounts, pipelineMilestoneWhere } from "./operationalCounts";

test("inbound counts include answered, missed, voicemail and in-progress, with lifecycle deduplication", () => {
  const make = (id: number, twilioSid: string | null, status: string, callOutcome: string | null) =>
    ({ id, twilioSid, status, callOutcome, createdAt: new Date("2026-07-15T16:00:00Z") });
  assert.deepEqual(inboundCallCounts([
    make(1, "CA-answer", "completed", "connected"),
    make(2, "CA-missed", "no-answer", "no_answer"),
    make(3, "CA-voicemail", "completed", "voicemail"),
    make(4, "CA-voicemail", "completed", null),
    make(5, null, "ringing", null),
  ]), { total: 4, answered: 1, missed: 1, voicemail: 1, other: 1 });
});

test("terminal unanswered outcomes are not treated as answered", () => {
  assert.deepEqual(inboundCallCounts([
    { id: 1, twilioSid: null, status: "completed", callOutcome: "no_answer", createdAt: new Date() },
    { id: 2, twilioSid: null, status: "busy", callOutcome: null, createdAt: new Date() },
  ]), { total: 2, answered: 0, missed: 2, voicemail: 0, other: 0 });
});

for (const stage of ["contacted", "submitted_to_underwriting"] as const) {
  test(`compiled ${stage} SQL preserves lead correlation and cohort/rep filters`, () => {
    const query = new PgSelectBuilder({
      fields: { count: sql<number>`cast(count(*) as int)` },
      session: undefined,
      dialect: new PgDialect(),
    }).from(leadsTable).where(and(
      sql`${leadsTable.assignedRepId} = ${3}`,
      sql`${leadsTable.createdAt} >= ${new Date("2026-07-01T00:00:00Z")}`,
      pipelineMilestoneWhere(stage),
    )).toSQL();
    assert.match(query.sql, /count\(\*\)/);
    assert.match(query.sql, /EXISTS/);
    assert.match(query.sql, /"lead_id" = "leads"\."id"/);
    assert.match(query.sql, /"assigned_rep_id"/);
    assert.match(query.sql, /"created_at"/);
    assert.equal(query.params[0], 3);
    assert.equal(query.sql.includes("lender_submission_deliveries"), false);
  });
}
