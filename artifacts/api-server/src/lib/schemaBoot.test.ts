import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { pool } from "@workspace/db";
import { discoverMigrations, runMigrations, type MigrationReport } from "@workspace/db/migrate";
import {
  runSchemaBoot,
  SCHEMA_LOCK_TIMEOUT_MS,
  SCHEMA_MIGRATION_LOCK_KEY,
  SCHEMA_STATEMENT_TIMEOUT_MS,
} from "./schemaBoot";

const execFileAsync = promisify(execFile);

test("production-partial partner recovery reaches the current migration head", async (t) => {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) {
    t.skip("DATABASE_URL is required for the isolated production-partial fixture");
    return;
  }
  const databaseName =
    `migration_rehearsal_${process.pid}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  await execFileAsync("createdb", [`--maintenance-db=${baseUrl}`, databaseName]);
  const targetUrlObject = new URL(baseUrl);
  targetUrlObject.pathname = `/${databaseName}`;
  const targetUrl = targetUrlObject.toString();
  const PoolConstructor = pool.constructor as unknown as new (
    options: { connectionString: string },
  ) => typeof pool;
  const isolatedPool = new PoolConstructor({ connectionString: targetUrl });
  const client = await isolatedPool.connect();
  const migrationDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../lib/db/migrations");
  const baselinePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../lib/db/schema-ci-baseline/000_pre_runner_schema.sql",
  );
  const beforeDirectory = await mkdtemp(path.join(tmpdir(), "migration-partial-before-"));
  try {
    await client.query(await readFile(baselinePath, "utf8"));
    const beforeHead = (await readdir(migrationDirectory))
      .filter((name) => /^\d+_.+\.sql$/.test(name) && Number(name.slice(0, 3)) <= 35);
    for (const name of beforeHead) await copyFile(path.join(migrationDirectory, name), path.join(beforeDirectory, name));
    const db = drizzle(client);
    await runMigrations({ db, migrationsDir: beforeDirectory });

    // Model the exact production partial: 035 is the last clean ledger entry,
    // 036 failed after its lender changes, and partner_contacts was rolled back.
    const migrations = await discoverMigrations(migrationDirectory);
    await client.query(`
      ALTER TABLE lenders
        ADD COLUMN IF NOT EXISTS partner_type text NOT NULL DEFAULT 'direct_lender',
        ADD COLUMN IF NOT EXISTS referral_split_pct numeric(5, 2),
        ADD COLUMN IF NOT EXISTS submission_method text NOT NULL DEFAULT 'email',
        ADD COLUMN IF NOT EXISTS portal_url text
    `);
    for (const constraint of [
      `ALTER TABLE lenders ADD CONSTRAINT lenders_partner_type_check CHECK (partner_type IN ('direct_lender', 'broker_out', 'broker_in'))`,
      `ALTER TABLE lenders ADD CONSTRAINT lenders_submission_method_check CHECK (submission_method IN ('email', 'portal', 'both'))`,
      `ALTER TABLE lenders ADD CONSTRAINT lenders_referral_split_check CHECK ((partner_type = 'broker_in' AND referral_split_pct BETWEEN 0 AND 100) OR (partner_type <> 'broker_in' AND referral_split_pct IS NULL))`,
    ]) await client.query(constraint);
    const failed036 = migrations.find((migration) => migration.name === "036_partners_contacts.sql");
    assert.ok(failed036, "current 036 migration must exist");
    await client.query(`
      INSERT INTO schema_migrations (name, checksum, failed_at, error)
      SELECT '036_partners_contacts.sql', '${failed036.checksum}', now(), 'synthetic production failure'
      WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name = '036_partners_contacts.sql')
    `);

    const report = await runMigrations({ db, migrationsDir: migrationDirectory });
    const currentRecoveryHead = (await readdir(migrationDirectory))
      .filter((name) => /^\d+_.+\.sql$/.test(name) && Number(name.slice(0, 3)) >= 37)
      .sort();
    const appliedRecovery = report.applied.filter((name) => currentRecoveryHead.includes(name));
    const expectedRecoveryOrder = [
      "037_partner_flows_and_texting.sql", "047_partner_contacts_prerequisite.sql",
      "038_partner_texting.sql", "039_ridgestone_partner_profile.sql",
      "040_release_schema_parity.sql", "041_push_notifications.sql",
      "042_push_delivery_ledger.sql", "043_align_push_schema.sql",
      "044_notification_delivery_claims.sql", "045_application_equipment_category_homeowner.sql",
      "046_complete_partner_contacts_recovery.sql", "048_financing_campaign_draft.sql",
      "049_lender_underwriting_intelligence.sql", "050_lender_guideline_versions.sql",
    ];
    const evidence = {
      applied: report.applied,
      superseded: report.migrations.filter((migration) => migration.supersededAt).map((migration) => migration.name),
      alreadyApplied: report.skipped,
      schema: { failed: report.failed },
    };
    console.log(JSON.stringify(evidence));
    assert.deepEqual(appliedRecovery, expectedRecoveryOrder,
      "fixture must demonstrate dependency order through the current migration head");
    assert.deepEqual(new Set(appliedRecovery), new Set(currentRecoveryHead),
      "fixture must apply every migration from 037 through the current migration head");
    assert.equal(report.pending.length, 0, `unaccounted pending migrations: ${report.pending.join(", ")}`);
    assert.equal(report.failed, null);
    assert.ok(report.migrations.find((migration) => migration.name === "036_partners_contacts.sql")?.supersededAt);
    assert.ok((await client.query("SELECT 1 FROM partner_contacts LIMIT 1")).rowCount !== null);
  } finally {
    client.release();
    await isolatedPool.end();
    await execFileAsync(
      "dropdb",
      ["--if-exists", "--force", `--maintenance-db=${baseUrl}`, databaseName],
    );
    await rm(beforeDirectory, { recursive: true, force: true });
  }
});

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

test("a failed entry with a checksum mismatch is reported without retrying", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "migration-checksum-mismatch-"));
  try {
    await writeFile(path.join(directory, "001_recovery.sql"), "SELECT 1;");
    let transactions = 0;
    const database = {
      async execute() {
        return { rows: [{ name: "001_recovery", checksum: "old-provenance", failed_at: new Date().toISOString(), error: "old failure" }] };
      },
      async transaction<T>(callback: (tx: { execute(): Promise<{ rows: never[] }> }) => Promise<T>) {
        transactions++;
        return callback({ async execute() { return { rows: [] }; } });
      },
    };
    const report = await runMigrations({ db: database, migrationsDir: directory });
    assert.equal(transactions, 0);
    assert.deepEqual(report.mismatches.map(({ name }) => name), ["001_recovery.sql"]);
    assert.equal(report.failed, null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("dry-run reads a legacy schema_migrations ledger without mutating it", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "legacy-ledger-"));
  try {
    await writeFile(path.join(directory, "001_legacy.sql"), "SELECT 1;");
    const discovered = await discoverMigrations(directory);
    let calls = 0;
    const database = {
      async execute() {
        calls++;
        if (calls === 1) throw Object.assign(new Error("column failed_at does not exist"), { code: "42703" });
        return {
          rows: [{ name: discovered[0].id, checksum: discovered[0].checksum, applied_at: new Date().toISOString() }],
        };
      },
      async transaction() {
        throw new Error("dry run must not open a transaction");
      },
    };
    const report = await runMigrations({ db: database, migrationsDir: directory, dryRun: true });
    assert.deepEqual(report.skipped, ["001_legacy.sql"]);
    assert.equal(report.failed, null);
    assert.equal(calls, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a mismatch blocks pending files collected before it", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "migration-mismatch-order-"));
  try {
    await writeFile(path.join(directory, "001_pending.sql"), "SELECT 1;");
    await writeFile(path.join(directory, "002_mismatched.sql"), "SELECT 2;");
    let transactions = 0;
    let executeCalls = 0;
    const database = {
      async execute() {
        executeCalls++;
        return {
          rows: executeCalls <= 3 ? [{
            name: "002_mismatched",
            checksum: "old-checksum",
            failed_at: new Date().toISOString(),
            error: "old failure",
          }] : [],
        };
      },
      async transaction<T>(callback: (tx: { execute(): Promise<{ rows: never[] }> }) => Promise<T>) {
        transactions++;
        return callback({ async execute() { return { rows: [] }; } });
      },
    };
    const report = await runMigrations({ db: database, migrationsDir: directory });
    assert.equal(transactions, 0);
    assert.deepEqual(report.pending, ["001_pending.sql"]);
    assert.deepEqual(report.mismatches.map(({ name }) => name), ["002_mismatched.sql"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a persisted checksum-matching non-duplicate failure remains failed and stops following files", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "migration-retry-failure-"));
  try {
    await writeFile(path.join(directory, "001_failed.sql"), "SELECT forbidden_operation();");
    await writeFile(path.join(directory, "002_must_not_run.sql"), "SELECT 2;");
    const discovered = await discoverMigrations(directory);
    let transactions = 0;
    const database = {
      async execute() {
        return {
          rows: [{
            name: "001_failed",
            checksum: discovered[0].checksum,
            failed_at: new Date().toISOString(),
            error: "permission denied",
          }],
        };
      },
      async transaction<T>(callback: (tx: { execute(): Promise<{ rows: never[] }> }) => Promise<T>) {
        transactions++;
        return callback({
          async execute() {
            throw Object.assign(new Error("permission denied"), { code: "42501" });
          },
        });
      },
    };
    const report = await runMigrations({ db: database, migrationsDir: directory });
    assert.equal(transactions, 1);
    assert.deepEqual(report.failed, { name: "001_failed.sql", error: "permission denied" });
    assert.deepEqual(report.pending, ["001_failed.sql"]);
    assert.equal(report.migrations.some(({ name }) => name === "002_must_not_run.sql"), false);
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
  assert.ok(calls.includes(`SET statement_timeout = ${SCHEMA_LOCK_TIMEOUT_MS}`));
  assert.ok(calls.includes(`SELECT pg_advisory_lock($1)`));
  assert.ok(calls.includes(`SET statement_timeout = ${SCHEMA_STATEMENT_TIMEOUT_MS}`));
  assert.ok(calls.includes(`SELECT pg_advisory_unlock($1)`));
  assert.ok(calls.includes("release"));
  assert.equal(SCHEMA_MIGRATION_LOCK_KEY, 874242);
});

test("a checksum-matching duplicate-object failure is superseded", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "migration-supersede-"));
  try {
    await writeFile(path.join(directory, "001_recovery.sql"), "CREATE TABLE already_there (id integer);");
    const discovered = await discoverMigrations(directory);
    let transactions = 0;
    const database = {
      async execute() {
        return { rows: [{ name: "001_recovery", checksum: discovered[0].checksum, failed_at: new Date().toISOString(), error: "already exists" }] };
      },
      async transaction<T>(callback: (tx: { execute(): Promise<{ rows: never[] }> }) => Promise<T>) {
        transactions++;
        return callback({
          async execute() {
            throw Object.assign(new Error("relation already exists"), { code: "42P07" });
          },
        });
      },
    };
    const report = await runMigrations({ db: database, migrationsDir: directory });
    assert.equal(transactions, 1);
    assert.equal(report.failed, null);
    assert.deepEqual(report.skipped, ["001_recovery.sql"]);
    assert.ok(report.migrations[0]?.supersededAt);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a timed-out advisory lock records degraded startup and releases the client", async () => {
  const calls: string[] = [];
  const client = {
    async query(text: string) {
      calls.push(text);
      if (text.includes("pg_advisory_lock")) {
        throw new Error("canceling statement due to statement timeout");
      }
      return {};
    },
    release: () => calls.push("release"),
  };

  const result = await runSchemaBoot({
    pool: { connect: async () => client },
    logger: {
      info: (message) => calls.push(`info:${message}`),
      error: (message) => calls.push(`error:${message}`),
      warn: (message) => calls.push(`warn:${message}`),
    },
    runMigrations: async () => {
      throw new Error("migrations must not run without the advisory lock");
    },
  });

  assert.equal(result, null);
  assert.ok(
    calls.includes("error:MIGRATION FAILED: startup: canceling statement due to statement timeout"),
    calls.join("|"),
  );
  assert.ok(calls.includes("release"));
});