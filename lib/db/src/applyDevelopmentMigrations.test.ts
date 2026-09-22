import assert from "node:assert/strict";
import test from "node:test";
import type { MigrationReport } from "./migrate";
import {
  applyDevelopmentMigrations,
  assertDevelopmentDatabaseUrl,
} from "./applyDevelopmentMigrations";

function report(overrides: Partial<MigrationReport> = {}): MigrationReport {
  return {
    applied: [],
    detected: [],
    skipped: [],
    pending: [],
    mismatches: [],
    failed: null,
    migrations: [],
    ...overrides,
  };
}

test("a newly applied migration must be visible in the development ledger", async () => {
  const calls: string[] = [];
  const migration = {
    name: "999_merged_feature.sql",
    id: "999_merged_feature",
    checksum: "checksum",
    sql: "SELECT 1",
    status: "applied" as const,
  };

  const result = await applyDevelopmentMigrations({
    run: async () => {
      calls.push("run");
      return report({ applied: [migration.name], migrations: [migration] });
    },
    verify: async () => {
      calls.push("verify");
      return report({ skipped: [migration.name], migrations: [migration] });
    },
  });

  assert.deepEqual(calls, ["run", "verify"]);
  assert.deepEqual(result.applied, [migration.name]);
});

test("a migration failure stops the post-merge command before ledger verification", async () => {
  let verified = false;
  await assert.rejects(
    applyDevelopmentMigrations({
      run: async () => report({
        failed: { name: "999_broken.sql", error: "synthetic failure" },
        pending: ["999_broken.sql"],
      }),
      verify: async () => {
        verified = true;
        return report();
      },
    }),
    /Development migration failed: 999_broken\.sql: synthetic failure/,
  );
  assert.equal(verified, false);
});

test("a migration missing from the durable ledger fails verification", async () => {
  await assert.rejects(
    applyDevelopmentMigrations({
      run: async () => report({ applied: ["999_merged_feature.sql"] }),
      verify: async () => report({ pending: ["999_merged_feature.sql"] }),
    }),
    /ledger verification failed: still pending: 999_merged_feature\.sql/,
  );
});

test("the migration target must match the development database identity", () => {
  const development = {
    PGHOST: "development.example",
    PGDATABASE: "crm_dev",
    PGUSER: "developer",
    PGPORT: "5432",
  };
  assert.equal(
    assertDevelopmentDatabaseUrl(
      "postgresql://developer:secret@development.example/crm_dev",
      development,
    ).hostname,
    "development.example",
  );
  assert.throws(
    () => assertDevelopmentDatabaseUrl(
      "postgresql://publisher:secret@production.example/crm_prod",
      development,
    ),
    /does not match the development database identity/,
  );
});

test("missing independent development identity refuses all migration targets", () => {
  assert.throws(
    () => assertDevelopmentDatabaseUrl(
      "postgresql://developer:secret@development.example/crm_dev",
      {},
    ),
    /development database identity is incomplete/,
  );
});
