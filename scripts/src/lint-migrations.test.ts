import assert from "node:assert/strict";
import test from "node:test";
import { lintMigrationSql } from "./lint-migrations.ts";

test("migration lint accepts every supported idempotency guard", () => {
  const sql = `
    CREATE TABLE IF NOT EXISTS example (id integer);
    CREATE UNIQUE INDEX IF NOT EXISTS example_id_idx ON example(id);
    ALTER TABLE example ADD COLUMN IF NOT EXISTS label text;
    DO $$
    BEGIN
      ALTER TABLE example ADD CONSTRAINT example_id_check CHECK (id > 0);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `;
  assert.deepEqual(lintMigrationSql("safe.sql", sql), []);
});

test("migration lint rejects unguarded schema creation and alteration", () => {
  const sql = `
    CREATE TABLE example (id integer);
    CREATE INDEX example_id_idx ON example(id);
    ALTER TABLE example ADD COLUMN label text;
    ALTER TABLE example ADD CONSTRAINT example_id_check CHECK (id > 0);
  `;
  assert.deepEqual(
    lintMigrationSql("unsafe.sql", sql).map(({ operation }) => operation),
    ["CREATE TABLE", "CREATE INDEX", "ADD COLUMN", "ADD CONSTRAINT example_id_check"],
  );
});