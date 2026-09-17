import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
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