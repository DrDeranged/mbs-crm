import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PgDialect } from "drizzle-orm/pg-core/dialect";
import { __testCreatedRelations, __testMissingRelation, analyzeMigrationSql, discoverMigrations, runMigrations } from "./migrate";

async function migrationFixture(files: Record<string, string>, failedName?: string, error?: unknown, missing = "target_table") {
  const directory = await mkdtemp(path.join(tmpdir(), "dependency-run-"));
  for (const [name, body] of Object.entries(files)) await writeFile(path.join(directory, name), body);
  const discovered = await discoverMigrations(directory);
  const failed = failedName && discovered.find((migration) => migration.name === failedName);
  const hasBlocker = Object.keys(files).some((name) => name.includes("blocker"));
  const ledger = new Map<string, { checksum: string; failed_at?: string; error?: string; superseded_at?: string }>();
  let transactionNumber = 0;
  const transactions: number[] = [];
  const sqlIntent = (query: unknown) => {
    try {
      const result = new PgDialect().sqlToQuery(query as never);
      return { text: result.sql, params: result.params as unknown[] };
    } catch {
      return { text: String(query), params: [] as unknown[] };
    }
  };
  const operations: Array<{ text: string; params: unknown[] }> = [];
  const database = {
    async execute(query: unknown) {
      const intent = sqlIntent(query);
      operations.push(intent);
      if (intent.text.includes("SELECT name, checksum")) {
        return { rows: [...ledger].map(([name, row]) => ({ name, checksum: row.checksum, failed_at: row.failed_at, error: row.error, superseded_at: row.superseded_at })) };
      }
      if (intent.text.includes("ON CONFLICT")) {
        const [name, checksum, error] = intent.params;
        ledger.set(String(name), { checksum: String(checksum), failed_at: new Date().toISOString(), error: String(error) });
      } else if (intent.text.startsWith("update schema_migrations") || intent.text.startsWith("UPDATE schema_migrations")) {
        const [checksum, , error] = intent.params;
        const entry = [...ledger.values()].find((row) => row.checksum === String(checksum));
        if (entry) { entry.error = String(error); entry.superseded_at = new Date().toISOString(); }
      }
      return { rows: [] };
    },
    async transaction<T>(callback: (tx: { execute(query: unknown): Promise<{ rows: never[] }> }) => Promise<T>) {
      transactionNumber++;
      transactions.push(transactionNumber);
      const pendingLedger: Array<[string, string]> = [];
      return callback({
        async execute(query: unknown) {
          const intent = sqlIntent(query);
          operations.push(intent);
          if (transactionNumber === 1 && hasBlocker) {
            if (missing.includes(".")) {
              const [schema, table] = missing.split(".");
              throw Object.assign(new Error("wrapper"), {
                cause: Object.assign(new Error("undefined table"), { code: "42P01", schema, table }),
              });
            }
            throw Object.assign(new Error(`relation "${missing}" does not exist`), { code: "42P01" });
          }
          if (error && transactionNumber === (error as { transaction?: number }).transaction) {
            throw (error as { cause: unknown }).cause;
          }
          if (intent.text.includes("INSERT INTO schema_migrations")) {
            pendingLedger.push([String(intent.params[0]), String(intent.params[1])]);
          }
          return { rows: [] };
        },
      }).then((result) => {
        for (const [name, checksum] of pendingLedger) ledger.set(name, { checksum });
        return result;
      });
    },
  };
  return { directory, database, transactions, ledger, operations, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

test("dependency scanner recognizes unique, IF NOT EXISTS, and multiple top-level creates", () => {
  assert.deepEqual(__testCreatedRelations("CREATE TABLE IF NOT EXISTS public.one (id int);"), ["public.one"]);
  assert.deepEqual(__testCreatedRelations("CREATE TABLE one (id int); CREATE TABLE \"Two\" (id int);"), ["one", "\"Two\""]);
});

test("dependency scanner ignores ordinary strings, comments, nested comments, and dollar bodies", () => {
  const sql = `
    -- CREATE TABLE fake_line (id int);
    /* CREATE TABLE fake_block (id int); /* nested CREATE TABLE fake_nested (id int); */ */
    SELECT 'CREATE TABLE fake_string (id int);';
    DO $$ BEGIN PERFORM 'CREATE TABLE fake_dollar (id int);'; END $$;
    DO $_body$ BEGIN CREATE TABLE fake_tag (id int); END $_body$;
    CREATE TABLE real_table (id int);
  `;
  assert.deepEqual(__testCreatedRelations(sql), ["real_table"]);
});

test("dependency scanner handles E strings and fails closed for malformed constructs", () => {
  assert.deepEqual(
    __testCreatedRelations(String.raw`SELECT E'escaped \' quote; CREATE TABLE fake (id int);'; CREATE TABLE real_table (id int);`),
    ["real_table"],
  );
  assert.equal(__testCreatedRelations("DO $_body$ CREATE TABLE fake (id int);"), null);
  assert.equal(__testCreatedRelations("SELECT E'unterminated \\'"), null);
  assert.equal(__testCreatedRelations("/* unclosed CREATE TABLE fake (id int);"), null);
  assert.equal(__testCreatedRelations("$1$ CREATE TABLE fake (id int); $1$"), null);
});

test("migration analyzer ignores CTEs in the real 002 migration", async () => {
  const migration = (await discoverMigrations(path.resolve(import.meta.dirname, "../migrations")))
    .find((entry) => entry.name === "002_rep_slugs.sql")!;
  const analysis = analyzeMigrationSql(migration.sql);
  assert.deepEqual(analysis.referencedTables.sort(), ["users"]);
});

test("migration analyzer treats FK SET NULL as an action, not DELETE DML", async () => {
  const migration = (await discoverMigrations(path.resolve(import.meta.dirname, "../migrations")))
    .find((entry) => entry.name === "003_deals.sql")!;
  const analysis = analyzeMigrationSql(migration.sql);
  assert.deepEqual(analysis.createdTables, ["deals"]);
  assert.deepEqual(analysis.referencedTables.sort(), ["activity_log", "deals", "leads", "users"]);
});

test("all current migrations form a parseable analyzer corpus", async () => {
  const migrations = await discoverMigrations(path.resolve(import.meta.dirname, "../migrations"));
  for (const migration of migrations) {
    assert.doesNotThrow(() => analyzeMigrationSql(migration.sql), migration.name);
  }
});

test("029 ignores timestamp WITH time zone and finds its real relations", async () => {
  const migration = (await discoverMigrations(path.resolve(import.meta.dirname, "../migrations")))
    .find((entry) => entry.name === "029_deal_approvals.sql")!;
  const analysis = analyzeMigrationSql(migration.sql);
  assert.ok(analysis.referencedTables.includes("deals"));
  assert.ok(analysis.referencedTables.includes("lenders"));
  assert.ok(analysis.referencedTables.includes("documents"));
  assert.ok(analysis.referencedTables.includes("users"));
  assert.ok(analysis.referencedTables.includes("deal_approvals"));
});

test("040 DO body dependencies are analyzed while function bodies stay opaque", async () => {
  const migration = (await discoverMigrations(path.resolve(import.meta.dirname, "../migrations")))
    .find((entry) => entry.name === "040_release_schema_parity.sql")!;
  const analysis = analyzeMigrationSql(migration.sql);
  assert.ok(analysis.referencedTables.includes("users"));
  assert.ok(analysis.referencedTables.includes("leads"));
  assert.deepEqual(analyzeMigrationSql(
    "CREATE FUNCTION f() RETURNS void AS $$ BEGIN SELECT * FROM fake; END $$ LANGUAGE plpgsql;",
  ).referencedTables, []);
  assert.throws(() => analyzeMigrationSql("DO $$ BEGIN EXECUTE format('ALTER TABLE ' || x); END $$;"), /dynamic SQL/);
  assert.throws(() => analyzeMigrationSql("DO $$ BEGIN EXECUTE 'DROP TABLE users'; END $$;"), /dynamic SQL/);
  assert.throws(() => analyzeMigrationSql("DO $$ BEGIN EXECUTE query_text; END $$;"), /dynamic SQL/);
});

test("migration analyzer handles recursive, multiple, quoted, and nested CTEs", () => {
  const analysis = analyzeMigrationSql(`
    WITH RECURSIVE "tree" (id) AS (
      SELECT id FROM public.nodes
      UNION ALL SELECT n.id FROM nodes n JOIN "tree" t ON t.id = n.parent_id
    ), other AS (SELECT id FROM nodes)
    SELECT * FROM other JOIN "tree" ON true;
  `);
  assert.deepEqual(analysis.referencedTables, ["nodes"]);
  assert.deepEqual(analyzeMigrationSql("UPDATE users SET x = f() WHERE id IN (SELECT id FROM candidates);").referencedTables,
    ["users", "candidates"]);
});

test("missing relation extraction traverses wrapped causes and message fallback", () => {
  const structured = Object.assign(new Error("wrapper"), {
    cause: Object.assign(new Error("undefined table"), { code: "42P01", schema: "public", table: "contacts" }),
  });
  assert.equal(__testMissingRelation(structured), "\"public\".\"contacts\"");
  assert.equal(
    __testMissingRelation(Object.assign(new Error('relation "later_table" does not exist'), { code: "42P01" })),
    '"later_table"',
  );
  const cyclic: { cause?: unknown; code?: string } = { code: "42P01" };
  cyclic.cause = cyclic;
  assert.equal(__testMissingRelation(cyclic), undefined);
});

test("runMigrations reorders one unique creator, retries, and skips it later", async () => {
  const fixture = await migrationFixture({
    "001_blocker.sql": "SELECT * FROM target_table;",
    "002_creator.sql": "CREATE TABLE IF NOT EXISTS target_table (id integer);",
    "003_following.sql": "SELECT 3;",
  });
  try {
    const report = await runMigrations({ db: fixture.database, migrationsDir: fixture.directory });
    assert.deepEqual(report.applied, ["002_creator.sql", "001_blocker.sql", "003_following.sql"]);
    assert.equal(fixture.transactions.length, 4);
    assert.equal(fixture.ledger.get("002_creator")?.checksum, (await discoverMigrations(fixture.directory)).find((m) => m.id === "002_creator")?.checksum);
    const second = await runMigrations({ db: fixture.database, migrationsDir: fixture.directory });
    assert.deepEqual(second.applied, []);
    assert.deepEqual(second.skipped, ["001_blocker.sql", "002_creator.sql", "003_following.sql"]);
    assert.equal(report.pending.length, 0);
  } finally { await fixture.cleanup(); }
});

test("runMigrations stops with no creator and with ambiguous creators", async () => {
  for (const files of [
    { "001_blocker.sql": "SELECT * FROM absent_table;", "002_following.sql": "SELECT 2;" },
    { "001_blocker.sql": "SELECT * FROM ambiguous_table;", "002_a.sql": "CREATE TABLE ambiguous_table (id int);", "003_b.sql": "CREATE TABLE IF NOT EXISTS ambiguous_table (id int);" },
  ] as Record<string, string>[]) {
    const fixture = await migrationFixture(files);
    try {
      const report = await runMigrations({ db: fixture.database, migrationsDir: fixture.directory });
      assert.equal(report.failed?.name, "001_blocker.sql");
      assert.equal(fixture.transactions.length, 1);
    } finally { await fixture.cleanup(); }
  }
});

test("runMigrations persists creator failure and blocker retry failure", async () => {
  const creatorFailure = await migrationFixture({
    "001_blocker.sql": "SELECT * FROM target_table;",
    "002_creator.sql": "CREATE TABLE target_table (id int);",
  }, undefined, { transaction: 2, cause: Object.assign(new Error("permission denied"), { code: "42501" }) });
  try {
    const report = await runMigrations({ db: creatorFailure.database, migrationsDir: creatorFailure.directory });
    assert.equal(report.failed?.name, "002_creator.sql");
    assert.equal(creatorFailure.transactions.length, 2);
    assert.equal(creatorFailure.ledger.get("002_creator")?.error, "permission denied");
    assert.equal(creatorFailure.ledger.get("002_creator")?.checksum,
      (await discoverMigrations(creatorFailure.directory)).find((m) => m.id === "002_creator")?.checksum);
  } finally { await creatorFailure.cleanup(); }

  const retryFailure = await migrationFixture({
    "001_blocker.sql": "SELECT * FROM target_table;",
    "002_creator.sql": "CREATE TABLE target_table (id int);",
  }, undefined, { transaction: 3, cause: Object.assign(new Error("permission denied"), { code: "42501" }) });
  try {
    const report = await runMigrations({ db: retryFailure.database, migrationsDir: retryFailure.directory });
    assert.equal(report.failed?.name, "001_blocker.sql");
    assert.equal(retryFailure.transactions.length, 3);
    assert.equal(retryFailure.ledger.get("001_blocker")?.error, "permission denied");
    assert.equal(retryFailure.ledger.get("002_creator")?.checksum,
      (await discoverMigrations(retryFailure.directory)).find((m) => m.id === "002_creator")?.checksum);
  } finally { await retryFailure.cleanup(); }
});

test("runMigrations resolves structured quoted qualified identifiers and message fallback", async () => {
  const fixture = await migrationFixture({
    "001_blocker.sql": "SELECT * FROM \"CamelSchema\".\"CamelTable\";",
    "002_creator.sql": "CREATE TABLE \"CamelSchema\".\"CamelTable\" (id integer);",
  }, undefined, undefined, "CamelSchema.CamelTable");
  try {
    const report = await runMigrations({ db: fixture.database, migrationsDir: fixture.directory });
    assert.deepEqual(report.applied, ["002_creator.sql", "001_blocker.sql"]);
  } finally { await fixture.cleanup(); }
});

test("malformed CREATE syntax is rejected by the reorder scanner", () => {
  for (const sql of [
    "CREATE TABLE foo.bar.baz (id int);",
    "CREATE TABLE foo??? (id int);",
    "CREATE TABLE \"unterminated (id int);",
    "CREATE TABLE foo AS SELECT 1;",
  ]) assert.ok(__testCreatedRelations(sql) === null || __testCreatedRelations(sql)?.length === 0);
});