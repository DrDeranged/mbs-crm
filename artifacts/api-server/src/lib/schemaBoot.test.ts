import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runMigrations, type MigrationReport } from "@workspace/db/migrate";
import { runSchemaBoot, SCHEMA_MIGRATION_LOCK_KEY } from "./schemaBoot";

function emptyReport(): MigrationReport {
  return {
    applied: [],
    detected: [],
    skipped: [],
    pending: [],
    mismatches: [],
    failed: null,
    migrations: [],
  };
}

test("boot migration runner applies two pending files in numeric order and records them", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "migration-order-"));
  try {
    await writeFile(path.join(directory, "002_second.sql"), "SELECT 2;");
    await writeFile(path.join(directory, "001_first.sql"), "SELECT 1;");
    const ledger = new Map<string, string>();
    const transactionCallCounts: number[] = [];
    const database = {
      async execute(query: any) {
        // The runner reads this map as schema_migrations. The initial CREATE
        // statement and schema marker probes have no rows in this fake DB.
        if (ledger.size > 0) {
          return {
            rows: [...ledger].map(([name, checksum]) => ({
              name,
              checksum,
              applied_at: new Date().toISOString(),
            })),
          };
        }
        return { rows: [] };
      },
      async transaction<T>(callback: (tx: { execute(query: any): Promise<{ rows: never[] }> }) => Promise<T>) {
        let call = 0;
        const result = await callback({
          async execute(query: any) {
            call++;
            return { rows: [] };
          },
        });
        transactionCallCounts.push(call);
        return result;
      },
    };

    const first = await runMigrations({ db: database, migrationsDir: directory });
    assert.deepEqual(first.applied, ["001_first.sql", "002_second.sql"]);
    assert.deepEqual(transactionCallCounts, [2, 2], "each file executes SQL and records its ledger row");

    for (const migration of first.migrations) {
      ledger.set(migration.id, migration.checksum);
    }
    const second = await runMigrations({ db: database, migrationsDir: directory });
    assert.deepEqual(second.applied, []);
    assert.deepEqual(second.skipped, ["001_first.sql", "002_second.sql"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a failing second file keeps the first file applied and recorded", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "migration-failure-"));
  try {
    await writeFile(path.join(directory, "001_first.sql"), "SELECT 1;");
    await writeFile(path.join(directory, "002_second.sql"), "SELECT 2;");
    const transactionCallCounts: number[] = [];
    let transactionNumber = 0;
    const database = {
      async execute() {
        return { rows: [] };
      },
      async transaction<T>(callback: (tx: { execute(): Promise<{ rows: never[] }> }) => Promise<T>) {
        transactionNumber++;
        let calls = 0;
        try {
          return await callback({
            async execute() {
              calls++;
              if (transactionNumber === 2 && calls === 1) {
                throw new Error("synthetic SQL failure");
              }
              return { rows: [] };
            },
          });
        } finally {
          transactionCallCounts.push(calls);
        }
      },
    };

    const report = await runMigrations({ db: database, migrationsDir: directory });
    assert.deepEqual(report.applied, ["001_first.sql"]);
    assert.deepEqual(transactionCallCounts, [2, 1]);
    assert.deepEqual(report.failed, {
      name: "002_second.sql",
      error: "synthetic SQL failure",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a failed migration reports prior applied work and boot still releases its coordinator", async () => {
  const calls: string[] = [];
  const logger = {
    info: (message: string) => calls.push(`info:${message}`),
    error: (message: string) => calls.push(`error:${message}`),
  };
  const client = {
    async query(text: string) {
      calls.push(text);
      return {};
    },
    release: () => calls.push("release"),
  };
  const report: MigrationReport = {
    ...emptyReport(),
    applied: ["001_first.sql"],
    pending: ["002_second.sql"],
    failed: { name: "002_second.sql", error: "synthetic failure" },
  };

  let invoked = false;
  const result = await runSchemaBoot({
    pool: { connect: async () => client },
    logger,
    runMigrations: async () => {
      invoked = true;
      return report;
    },
  });

  assert.equal(invoked, true);
  assert.equal(result?.failed?.name, "002_second.sql");
  assert.deepEqual(result?.applied, ["001_first.sql"]);
  assert.ok(calls.includes(`error:MIGRATION FAILED: 002_second.sql: synthetic failure`), calls.join("|"));
  assert.ok(calls.includes(`SELECT pg_advisory_lock($1)`));
  assert.ok(calls.includes(`SELECT pg_advisory_unlock($1)`));
  assert.ok(calls.includes("release"));
  assert.equal(SCHEMA_MIGRATION_LOCK_KEY, 874242);
});