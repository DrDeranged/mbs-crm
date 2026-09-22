import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  analyzeMigrationSql,
  countColumnReferences,
  lintMigrationDependencies,
  numberMigrations,
} from "./lint-migration-dependencies";

test("numberMigrations is strict, sorted, and rejects aliases", () => {
  assert.deepEqual(numberMigrations(["002_second.sql", "001_first.sql"]), [
    { name: "001_first.sql", number: 1 }, { name: "002_second.sql", number: 2 },
  ]);
  for (const name of [
    "first.sql", "001_First.sql", "001_bad-name.sql", "000_first.sql",
    "9007199254740992_first.sql", "001_first.sql",
  ]) assert.throws(() => numberMigrations(["001_ok.sql", name]), /invalid|duplicate|unsafe/);
});

type Fixture = { root: string; migrationDir: string };
async function fixture(files: Record<string, string>, baseline = "CREATE TABLE users(id int, name text);\n"): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "migration-dependencies-test-"));
  const migrationDir = path.join(root, "lib/db/migrations");
  await mkdir(path.join(root, "lib/db/schema-ci-baseline"), { recursive: true });
  await mkdir(migrationDir, { recursive: true });
  await writeFile(path.join(root, "lib/db/schema-ci-baseline/000_pre_runner_schema.sql"), baseline);
  for (const [name, sql] of Object.entries(files)) await writeFile(path.join(migrationDir, name), sql);
  return { root, migrationDir };
}

async function lintFixture(files: Record<string, string>, baseline?: string) {
  const value = await fixture(files, baseline);
  try { return await lintMigrationDependencies(value.root); } finally {
    // lintMigrationDependencies owns its server and clone directory; remove
    // the fixture only after it has had an opportunity to finish finalization.
    assert.equal((await readdir(value.root)).includes(".local"), false);
    await rm(value.root, { recursive: true, force: true });
  }
}

test("baseline and an earlier creator permit later column use", { concurrency: false }, async () => {
  const result = await lintFixture({
    "001_add_future.sql": "ALTER TABLE users ADD COLUMN future text;\n",
    "002_use_future.sql": "SELECT future FROM users;\n",
  });
  assert.equal(result.migrationsChecked, 2);
  assert.ok(result.columnReferencesChecked > 0);
});

test("same-file table, foreign key, index, and insert are accepted", { concurrency: false }, async () => {
  const result = await lintFixture({
    "001_child.sql": `
      CREATE TABLE child(id int, user_id int REFERENCES users(id));
      CREATE INDEX child_user_id_idx ON child(user_id);
      INSERT INTO child(id, user_id) SELECT 1, 1 WHERE false;
    `,
  }, "CREATE TABLE users(id int, name text);\nALTER TABLE users ADD UNIQUE(id);\n");
  assert.ok(result.tableReferencesChecked > 0);
  assert.ok(result.columnReferencesChecked >= 4);
});

test("forward table and unqualified column dependencies are reported", { concurrency: false }, async () => {
  await assert.rejects(() => lintFixture({
    "001_use_later.sql": "ALTER TABLE later ADD COLUMN value text;\n",
    "002_create_later.sql": "CREATE TABLE later(id int);\n",
  }), /001_use_later\.sql.*later.*FORWARD/s);
  await assert.rejects(() => lintFixture({
    "001_use_future.sql": "SELECT future FROM users;\n",
    "002_add_future.sql": "ALTER TABLE users ADD COLUMN future text;\n",
  }), /001_use_future\.sql.*future.*FORWARD/s);
});

test("missing table and column dependencies are reported", { concurrency: false }, async () => {
  await assert.rejects(() => lintFixture({
    "001_ghost.sql": "ALTER TABLE ghosts ADD COLUMN id int;\n",
  }), /001_ghost\.sql.*ghosts.*MISSING/s);
  await assert.rejects(() => lintFixture({
    "001_bogus.sql": "SELECT bogus FROM users;\n",
  }), /001_bogus\.sql.*bogus.*MISSING/s);
});

test("quoted public names, aliases, CTEs, and non-dynamic DO pass", { concurrency: false }, async () => {
  const result = await lintFixture({
    "001_misc.sql": `
      CREATE TABLE "public"."quoted_table"(id int);
      WITH recent AS (SELECT id FROM "public"."quoted_table")
        SELECT r.id FROM recent AS r;
      DO $$ BEGIN PERFORM 1; END $$;
    `,
  });
  assert.equal(result.migrationsChecked, 1);
});

test("dynamic DO SQL is rejected before migration execution", { concurrency: false }, async () => {
  for (const sql of [
    "DO $$ BEGIN EXECUTE 'CREATE TABLE should_not_run(id int)'; END $$;",
    "DO $$ DECLARE statement text := 'CREATE TABLE should_not_run(id int)'; BEGIN EXECUTE statement; END $$;",
  ]) {
    await assert.rejects(() => lintFixture({ "001_dynamic.sql": sql }), (error: Error) => {
      assert.match(error.message, /001_dynamic\.sql: dynamic SQL cannot be analyzed/);
      assert.equal(error.message.includes("should_not_run"), false);
      assert.equal(error.message.includes("CREATE TABLE"), false);
      return true;
    });
  }
});

test("lazy DO branches are validated even when false", { concurrency: false }, async () => {
  await assert.rejects(() => lintFixture({
    "001_lazy_bogus.sql": "DO $$ BEGIN IF false THEN PERFORM bogus FROM users; END IF; END $$;",
  }), /001_lazy_bogus\.sql.*bogus.*MISSING/s);
  const result = await lintFixture({
    "001_lazy_valid.sql": "DO $$ BEGIN IF false THEN PERFORM id FROM users; END IF; END $$;",
  });
  assert.ok(result.columnReferencesChecked > 0);
});

test("guarded procedural statements are not skipped", { concurrency: false }, async () => {
  await assert.rejects(() => lintFixture({
    "001_guarded_bogus.sql": "DO $$ BEGIN IF EXISTS (SELECT 1 WHERE false) THEN PERFORM bogus FROM users; END IF; END $$;",
  }), /001_guarded_bogus\.sql.*users\.bogus.*MISSING/s);
  const result = await lintFixture({
    "001_guarded_valid.sql": "DO $$ BEGIN IF EXISTS (SELECT 1 WHERE false) THEN PERFORM id FROM users; END IF; END $$;",
  });
  assert.equal(result.migrationsChecked, 1);
});

test("native statement attribution uses the failing statement", { concurrency: false }, async () => {
  await assert.rejects(() => lintFixture({
    "001_two_reads.sql": "SELECT id FROM other;\nSELECT future FROM users;\n",
    "002_users_future.sql": "ALTER TABLE users ADD COLUMN future text;\n",
  }, "CREATE TABLE users(id int, name text);\nCREATE TABLE other(id int);\n"), /001_two_reads\.sql.*users\.future.*FORWARD/s);
});

test("unqualified missing columns use the structurally inferred table", { concurrency: false }, async () => {
  await assert.rejects(() => lintFixture({
    "001_read_future.sql": "SELECT future FROM users;\n",
    "002_other_future.sql": "CREATE TABLE other(id int); ALTER TABLE other ADD COLUMN future text;\n",
  }), /001_read_future\.sql.*future.*MISSING/s);
  await assert.rejects(() => lintFixture({
    "001_read_future.sql": "SELECT future FROM users;\n",
    "002_users_future.sql": "ALTER TABLE users ADD COLUMN future text;\n",
  }), /001_read_future\.sql.*users\.future.*FORWARD/s);
});

test("opaque numbered function bodies fail closed", { concurrency: false }, async () => {
  await assert.rejects(() => lintFixture({
    "001_function.sql": "CREATE FUNCTION hidden_check() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM bogus FROM users; END $$;",
  }), /001_function\.sql.*unsupported opaque procedural SQL/);
});

test("column reference counting is explicit and deduplicated", () => {
  const sql = `
    CREATE INDEX ix ON users(id, name);
    CREATE INDEX ix2 ON users(id);
    ALTER TABLE users ADD COLUMN future text;
    INSERT INTO users(id, name) VALUES (1, 'x');
    UPDATE users SET name = 'y' WHERE users.id = 1;
    ALTER TABLE child ADD CONSTRAINT fk FOREIGN KEY (user_id) REFERENCES users(id);
  `;
  assert.equal(countColumnReferences(sql), 8);
});

test("migration analysis ignores relation-like prose inside SQL string literals", () => {
  const analysis = analyzeMigrationSql(`
    INSERT INTO campaigns (description)
    VALUES ('Reusable campaign seeded from the review-only campaign page.');
  `);
  assert.deepEqual(analysis.operations, [
    { kind: "reference", table: "campaigns" },
  ]);
});

test("workspace corpus has the expected baseline and migration counts", { concurrency: false }, async () => {
  const result = await lintMigrationDependencies();
  assert.equal(result.baselineTables, 31);
  assert.equal(result.baselineColumns, 320);
  assert.equal(result.migrationsChecked, 54);
  assert.ok(result.tableReferencesChecked > 0);
  assert.ok(result.columnReferencesChecked > 0);
});