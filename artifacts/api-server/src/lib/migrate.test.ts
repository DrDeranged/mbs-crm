import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
// @ts-expect-error Node's strip-types test runner resolves explicit .ts imports.
import { formatSchemaBootLine, runMigrations } from "../../../../lib/db/src/migrate.ts";

function fakeDatabase() {
  const ledger = new Map<string, string>();
  const execute = async (_query: unknown) => {
    // The synthetic migration has no known schema marker. Returning ledger
    // rows once the test has seeded one models the second runner invocation.
    if (ledger.size > 0) {
      return {
        rows: [...ledger].map(([name, checksum]) => ({ name, checksum, applied_at: new Date().toISOString() })),
      };
    }
    return { rows: [] };
  };
  return {
    ledger,
    execute,
    async transaction<T>(callback: (tx: { execute: typeof execute }) => Promise<T>): Promise<T> {
      let calls = 0;
      return callback({
        execute: async (query: unknown) => {
          calls++;
          if (calls === 2) {
            // The checksum is only needed by the assertion, so identify this
            // insert from the migration report after the transaction.
            return { rows: [] };
          }
          return execute(query);
        },
      });
    },
  };
}

test("migration runner applies a new file once and skips it on the second run", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "migration-runner-"));
  try {
    await writeFile(path.join(directory, "999_test.sql"), "CREATE TABLE migration_test (id integer);");
    const database = fakeDatabase();
    // Seed the fake ledger from the runner's transaction SQL is intentionally
    // avoided here; derive the expected checksum from the first report.
    const first = await runMigrations({ db: database, migrationsDir: directory });
    assert.deepEqual(first.applied, ["999_test.sql"]);
    assert.deepEqual(first.failed, null);
    const checksum = first.migrations[0]?.checksum;
    assert.ok(checksum);
    database.ledger.set("999_test", checksum);

    const second = await runMigrations({ db: database, migrationsDir: directory });
    assert.deepEqual(second.applied, []);
    assert.deepEqual(second.skipped, ["999_test.sql"]);
    assert.deepEqual(second.pending, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("migration runner reports a checksum mismatch without rerunning the file", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "migration-runner-"));
  try {
    await writeFile(path.join(directory, "999_test.sql"), "CREATE TABLE migration_test (id integer);");
    const database = fakeDatabase();
    const first = await runMigrations({ db: database, migrationsDir: directory });
    database.ledger.set("999_test", first.migrations[0]!.checksum);
    await writeFile(path.join(directory, "999_test.sql"), "CREATE TABLE migration_test (id bigint);");

    const second = await runMigrations({ db: database, migrationsDir: directory });
    assert.equal(second.applied.length, 0);
    assert.equal(second.mismatches.length, 1);
    assert.equal(second.mismatches[0]?.name, "999_test.sql");
    assert.deepEqual(second.failed, null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("schema boot line reports zero applied migrations", () => {
  assert.equal(
    formatSchemaBootLine({ pending: [], mismatches: [], migrations: [] }),
    "schema OK (0 applied)",
  );
});

test("schema boot line lists pending migration names", () => {
  assert.equal(
    formatSchemaBootLine({
      pending: ["018_lender_matcher_gates.sql", "019_document_categories.sql"],
      mismatches: [],
      migrations: [],
    }),
    "SCHEMA PENDING: 018_lender_matcher_gates.sql, 019_document_categories.sql",
  );
});

test("dry run treats a wrapped missing-ledger error as a first run", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "migration-runner-"));
  try {
    await writeFile(path.join(directory, "999_test.sql"), "SELECT 1;");
    let calls = 0;
    const database = {
      async execute() {
        calls++;
        if (calls === 1) {
          throw new Error("ledger query failed", {
            cause: Object.assign(new Error("missing relation"), { code: "42P01" }),
          });
        }
        return { rows: [] };
      },
      async transaction<T>(): Promise<T> {
        throw new Error("dry run must not start a transaction");
      },
    };
    const report = await runMigrations({
      db: database,
      migrationsDir: directory,
      dryRun: true,
    });
    assert.deepEqual(report.pending, ["999_test.sql"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});