import assert from "node:assert/strict";
import test from "node:test";
import { lintMigrationSql } from "./lint-migrations";

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

test("unrelated catalog queries and wrong-name guards do not waive new DDL", () => {
  const sql = `DO $guard$ BEGIN
    PERFORM 1 FROM pg_constraint;
    ALTER TABLE example ADD CONSTRAINT "unguarded" CHECK (id > 0);
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='other') THEN
      ALTER TABLE example ADD CONSTRAINT actual CHECK (id > 0);
    END IF;
    CREATE TABLE naked (id integer);
    CREATE UNIQUE INDEX naked_idx ON naked(id);
    ALTER TABLE naked ADD COLUMN other text;
  END $guard$;`;
  assert.equal(lintMigrationSql("999_new.sql", sql).length, 5);
});

test("constraint guards are statement-scoped and support tagged blocks and nesting", () => {
  const sql = `DO $guard$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='wanted') THEN
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='old') THEN
        ALTER TABLE example RENAME CONSTRAINT old TO wanted;
      ELSE
        ALTER TABLE example ADD CONSTRAINT wanted CHECK (id > 0);
      END IF;
    END IF;
    ALTER TABLE example ADD CONSTRAINT outside CHECK (id < 9);
  END $guard$;`;
  assert.deepEqual(lintMigrationSql("999_new.sql", sql).map(v => v.operation), ["ADD CONSTRAINT outside"]);
});

test("quoted constraint replacement has a matching idempotent drop guard", () => {
  assert.deepEqual(lintMigrationSql("replacement.sql", `ALTER TABLE t DROP CONSTRAINT IF EXISTS "c";
    ALTER TABLE t ADD CONSTRAINT "c" CHECK (id>0);`), []);
  assert.equal(lintMigrationSql("replacement.sql", `ALTER TABLE t DROP CONSTRAINT IF EXISTS "other";
    ALTER TABLE t ADD CONSTRAINT "c" CHECK (id>0);`).length, 1);
});

test("string comment markers, fake IF strings and ELSE branches cannot hide new DDL", () => {
  assert.equal(lintMigrationSql("new.sql", `SELECT '-- not a comment'; CREATE TABLE naked (id int);`).length, 1);
  assert.equal(lintMigrationSql("new.sql", `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='c') THEN
      NULL;
    ELSE
      ALTER TABLE t ADD CONSTRAINT c CHECK (id>0);
    END IF;
  END $$;`).length, 1);
  assert.equal(lintMigrationSql("new.sql", `DO $$ BEGIN
    PERFORM 'IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname=''c'') THEN';
    ALTER TABLE t ADD CONSTRAINT c CHECK(id>0);
    PERFORM 'END IF';
  END $$;`).length, 1);
  assert.equal(lintMigrationSql("new.sql", `CREATE UNIQUE INDEX CONCURRENTLY unguarded ON t(id);`).length, 1);
  assert.equal(lintMigrationSql("new.sql", `CREATE TEMP TABLE unguarded(id int);`).length, 1);
});

test("guarded SQL spacing and concurrent index creation are accepted", () => {
  assert.deepEqual(lintMigrationSql("new.sql", `
    CREATE TABLE
      IF NOT EXISTS t(id int);
    CREATE UNIQUE INDEX CONCURRENTLY   IF NOT EXISTS i ON t(id);
    ALTER TABLE t ADD COLUMN
      IF NOT EXISTS c text;
  `), []);
});