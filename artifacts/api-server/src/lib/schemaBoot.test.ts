import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runMigrations, type MigrationReport } from "@workspace/db/migrate";
import {
  runSchemaBoot,
  SCHEMA_LOCK_TIMEOUT_MS,
  SCHEMA_MIGRATION_LOCK_KEY,
  SCHEMA_STATEMENT_TIMEOUT_MS,
} from "./schemaBoot";

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

test("boot recovers the actual partial 036 state before applying 037 through 040", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "migration-supersession-"));
  try {
    for (const [name, body] of [
      ["036_partners_contacts.sql", "ALTER TABLE lenders ADD CONSTRAINT duplicate_check CHECK (true);"],
      [
        "037_partner_contacts_prerequisite.sql",
        "CREATE TABLE IF NOT EXISTS partner_contacts (id integer PRIMARY KEY);",
      ],
      ["037_partner_flows_and_texting.sql", "SELECT 37;"],
      ["038_partner_texting.sql", "ALTER TABLE partner_contacts ADD COLUMN sms_opted_out boolean;"],
      ["039_ridgestone_partner_profile.sql", "UPDATE partner_contacts SET id = id;"],
      ["040_complete_partner_contacts_recovery.sql", "SELECT 40;"],
    ] as const) {
      await writeFile(path.join(directory, name), body);
    }

    const partialProductionState = {
      lenderColumns: new Set([
        "partner_type",
        "referral_split_pct",
        "submission_method",
        "portal_url",
      ]),
      lenderConstraints: new Set([
        "lenders_partner_type_check",
        "lenders_submission_method_check",
        "lenders_referral_split_check",
      ]),
      partnerContactsExists: false,
    };
    let transactionNumber = 0;
    const transactionCallCounts: number[] = [];
    const database = {
      async execute() {
        return {
          rows: [{
            name: "036_partners_contacts.sql",
            checksum: "failed-checksum",
            applied_at: new Date().toISOString(),
            failed_at: new Date().toISOString(),
            error: 'constraint "duplicate_check" already exists',
            superseded_at: null,
          }],
        };
      },
      async transaction<T>(callback: (tx: { execute(): Promise<{ rows: never[] }> }) => Promise<T>) {
        transactionNumber++;
        let calls = 0;
        try {
          return await callback({
            async execute() {
              calls++;
              if (transactionNumber === 1 && calls === 1) {
                throw Object.assign(
                  new Error('constraint "duplicate_check" already exists'),
                  { code: "42710" },
                );
              }
              if (transactionNumber === 2 && calls === 1) {
                partialProductionState.partnerContactsExists = true;
              }
              if (
                (transactionNumber === 4 || transactionNumber === 5)
                && calls === 1
                && !partialProductionState.partnerContactsExists
              ) {
                throw Object.assign(
                  new Error('relation "partner_contacts" does not exist'),
                  { code: "42P01" },
                );
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

    assert.equal(report.failed, null);
    assert.deepEqual([...partialProductionState.lenderColumns], [
      "partner_type",
      "referral_split_pct",
      "submission_method",
      "portal_url",
    ]);
    assert.equal(partialProductionState.lenderConstraints.size, 3);
    assert.equal(partialProductionState.partnerContactsExists, true);
    assert.deepEqual(report.applied, [
      "037_partner_contacts_prerequisite.sql",
      "037_partner_flows_and_texting.sql",
      "038_partner_texting.sql",
      "039_ridgestone_partner_profile.sql",
      "040_complete_partner_contacts_recovery.sql",
    ]);
    assert.deepEqual(report.skipped, ["036_partners_contacts.sql"]);
    assert.deepEqual(transactionCallCounts, [1, 2, 2, 2, 2, 2]);
    assert.ok(
      report.migrations.find((migration) => migration.name === "036_partners_contacts.sql")?.supersededAt,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("boot retries a persisted non-duplicate failure and still stops the run", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "migration-retry-failure-"));
  try {
    await writeFile(path.join(directory, "036_failed.sql"), "SELECT forbidden_operation();");
    await writeFile(path.join(directory, "037_must_not_run.sql"), "SELECT 37;");

    let migrationTransactions = 0;
    let failureRecordWrites = 0;
    const database = {
      async execute() {
        failureRecordWrites++;
        return {
          rows: [{
            name: "036_failed",
            checksum: "failed-checksum",
            applied_at: new Date().toISOString(),
            failed_at: new Date().toISOString(),
            error: "permission denied",
            superseded_at: null,
          }],
        };
      },
      async transaction<T>(callback: (tx: { execute(): Promise<{ rows: never[] }> }) => Promise<T>) {
        migrationTransactions++;
        return callback({
          async execute() {
            throw Object.assign(new Error("permission denied"), { code: "42501" });
          },
        });
      },
    };

    const report = await runMigrations({ db: database, migrationsDir: directory });

    assert.equal(migrationTransactions, 1);
    assert.ok(failureRecordWrites >= 4, "the retried failure is persisted after ledger setup and read");
    assert.deepEqual(report.applied, []);
    assert.deepEqual(report.pending, ["036_failed.sql"]);
    assert.deepEqual(report.failed, {
      name: "036_failed.sql",
      error: "permission denied",
    });
    assert.equal(
      report.migrations.some((migration) => migration.name === "037_must_not_run.sql"),
      false,
    );
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