import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createApprovalExpiryReminder } from "../routes/deals";
function latestApproval<T extends { createdAt: string; id: number }>(rows: T[]) {
  return [...rows].sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || b.id - a.id,
  )[0] ?? null;
}

test("Migration 029 is append-only and preserves historical approvals", async () => {
  const migration = await readFile(
    new URL("../../../../lib/db/migrations/029_deal_approvals.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "deal_approvals"/);
  assert.match(migration, /REFERENCES "deals"\("id"\) ON DELETE CASCADE/);
  assert.match(migration, /"contract_type" IN \('EFA', 'lease', 'loan'\)/);
  assert.match(migration, /"advance" > 0/);
  assert.match(migration, /"payment" > 0/);
  assert.match(migration, /"down_payment" >= 0/);
  assert.match(migration, /length\(trim\("tier"\)\) > 0/);
  assert.match(migration, /timestamp with time zone/);
  assert.match(migration, /"approval_document_id" integer REFERENCES "documents"/);
  assert.doesNotMatch(migration, /027/);
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/);
});

test("latest approval selection uses created_at then id tie-break", () => {
  const selected = latestApproval([
    { id: 1, createdAt: "2026-09-17T12:00:00.000Z" },
    { id: 2, createdAt: "2026-09-17T12:00:00.000Z" },
  ]);
  assert.equal(selected?.id, 2);
});

test("approval reminder creation is idempotent across duplicate captures", async () => {
  const reminders: Array<Record<string, unknown>> = [];
  let lockCount = 0;
  const database = {
    transaction: async (callback: (tx: any) => Promise<void>) => callback({
      select: () => ({
        from: () => ({
          where: () => ({
            for: async (mode: string) => {
              assert.equal(mode, "update");
              lockCount++;
              return [{ id: 42 }];
            },
          }),
        }),
      }),
      query: {
        tasksTable: {
          findFirst: async () => reminders[0] ?? null,
        },
      },
      insert: () => ({
        values: async (value: Record<string, unknown>) => {
          reminders.push(value);
          return [];
        },
      }),
    }),
  } as any;
  const deal = { id: 42, leadId: 7, assignedTo: 9, dealName: "Godspeed" } as any;

  await createApprovalExpiryReminder(database, deal, "2026-10-20");
  await createApprovalExpiryReminder(database, deal, "2026-10-20");

  assert.equal(lockCount, 2);
  assert.equal(reminders.length, 1);
  assert.equal(reminders[0]?.userId, 9);
  assert.equal(reminders[0]?.dueDate, "2026-10-13");
});