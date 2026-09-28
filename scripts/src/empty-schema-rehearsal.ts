import { createServer } from "node:net";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  defaultCloneConfig,
  startManagedCloneServer,
  stopManagedCloneServer,
} from "./dbCloneProd";
import { localPostgresUrl } from "./localPostgres";
import { run, runCapture } from "./process";
import { makeThrowawayDatabaseName } from "./throwawayDatabase";

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not allocate an isolated PostgreSQL port"));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function psql(
  config: ReturnType<typeof defaultCloneConfig>,
  databaseUrl: string,
  command: string,
): Promise<string> {
  const result = await config.process.capture(config.psqlBinary, [
    "--dbname", databaseUrl,
    "--tuples-only",
    "--no-align",
    "--command", command,
  ]);
  if (result.code !== 0) throw new Error("Isolated PostgreSQL rehearsal query failed");
  return result.stdout.trim();
}

async function rehearsePopulatedSchemaAdoption(
  config: ReturnType<typeof defaultCloneConfig>,
  maintenanceUrl: string,
): Promise<void> {
  await config.process.run(config.dropdbBinary, [
    "--if-exists",
    "--force",
    `--maintenance-db=${maintenanceUrl}`,
    config.database,
  ]);
  await config.process.run(config.createdbBinary, [
    `--maintenance-db=${maintenanceUrl}`,
    config.database,
  ]);
  const databaseUrl = localPostgresUrl(config.port, config.database);
  const root = path.resolve(import.meta.dirname, "../..");
  const baselinePath = path.join(root, "lib/db/schema-ci-baseline/000_pre_runner_schema.sql");
  const baselineMigrationPath = path.join(root, "lib/db/migrations/000_baseline.sql");
  await config.process.run(config.psqlBinary, [
    "--dbname", databaseUrl,
    "--quiet",
    "--set=ON_ERROR_STOP=on",
    "--file", baselinePath,
  ]);

  const migrationEnv = {
    ...process.env,
    MIGRATION_REHEARSAL_DATABASE_URL: databaseUrl,
  };
  const initialReplay = await runCapture("pnpm", ["exec", "tsx", "../lib/db/src/migrationRehearsalRunner.ts"], {
    env: migrationEnv,
  });
  if (initialReplay.code !== 0) {
    throw new Error(`Populated-schema initial reconciliation failed: ${initialReplay.stderr.trim() || initialReplay.stdout.trim()}`);
  }
  const initialApplied = initialReplay.stdout.match(/^Applied names\/count: (.*) \/ \d+$/m)?.[1] ?? "";
  if (initialApplied.split(", ").includes("000_baseline.sql") ||
      !initialReplay.stdout.includes("Added ledger rows: 000_baseline")) {
    throw new Error("Populated schema did not adopt 000 before reconciling numbered migrations");
  }
  const initialAppliedCount = initialReplay.stdout.match(/^Applied names\/count: .* \/ (\d+)$/m)?.[1];
  const initialLedger = await psql(
    config,
    databaseUrl,
    "SELECT count(*) || '|' || count(*) FILTER (WHERE name = '000_baseline') FROM schema_migrations",
  );
  if (!initialAppliedCount || initialLedger !== "66|1") {
    throw new Error("Populated-schema initial reconciliation did not record the complete migration ledger");
  }
  const expectedBaselineChecksum = createHash("sha256")
    .update(await readFile(baselineMigrationPath))
    .digest("hex");
  const actualBaselineChecksum = await psql(
    config,
    databaseUrl,
    "SELECT checksum FROM schema_migrations WHERE name = '000_baseline'",
  );
  if (actualBaselineChecksum !== expectedBaselineChecksum) {
    throw new Error("Populated schema recorded an unexpected 000 checksum");
  }

  const applicationCatalog = `
    SELECT COALESCE(string_agg(signature, E'\\n' ORDER BY signature), '')
    FROM (
      SELECT 'table|' || table_name AS signature
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        AND table_name <> 'schema_migrations'
      UNION ALL
      SELECT 'column|' || table_name || '|' || column_name || '|' || ordinal_position || '|' ||
        data_type || '|' || udt_name || '|' || is_nullable || '|' || COALESCE(column_default, '')
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name <> 'schema_migrations'
      UNION ALL
      SELECT 'constraint|' || c.conrelid::regclass::text || '|' || c.conname || '|' ||
        pg_get_constraintdef(c.oid)
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = 'public' AND c.conrelid <> 'public.schema_migrations'::regclass
      UNION ALL
      SELECT 'index|' || schemaname || '|' || tablename || '|' || indexname || '|' || indexdef
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename <> 'schema_migrations'
    ) catalog_objects
  `;
  const deletedBaseline = await psql(
    config,
    databaseUrl,
    "DELETE FROM schema_migrations WHERE name = '000_baseline'; SELECT count(*) FROM schema_migrations WHERE name = '000_baseline'",
  );
  if (!deletedBaseline.endsWith("0")) throw new Error("Could not prepare the populated baseline-adoption retry");
  const before = await psql(config, databaseUrl, applicationCatalog);
  const rehearsal = await runCapture("pnpm", ["exec", "tsx", "../lib/db/src/migrationRehearsalRunner.ts"], {
    env: migrationEnv,
  });
  if (rehearsal.code !== 0) {
    throw new Error(`Populated-schema adoption runner failed: ${rehearsal.stderr.trim() || rehearsal.stdout.trim()}`);
  }
  if (!rehearsal.stdout.includes("Applied names/count: none / 0") ||
      !rehearsal.stdout.includes("Added ledger rows: 000_baseline")) {
    throw new Error("Populated schema did not adopt 000 without executing its SQL");
  }
  const after = await psql(config, databaseUrl, applicationCatalog);
  const adoptedRows = await psql(
    config,
    databaseUrl,
    "SELECT count(*) FROM schema_migrations WHERE name = '000_baseline'",
  );
  if (adoptedRows !== "1") throw new Error("Populated schema did not record the 000 checksum");
  const adoptedChecksum = await psql(
    config,
    databaseUrl,
    "SELECT checksum FROM schema_migrations WHERE name = '000_baseline'",
  );
  if (adoptedChecksum !== expectedBaselineChecksum) {
    throw new Error("Populated-schema adoption did not record the current 000 checksum");
  }
  if (before !== after) {
    throw new Error("Populated-schema 000 adoption changed application constraints or indexes");
  }
  const catalogCounts = await psql(
    config,
    databaseUrl,
    `SELECT
      (SELECT count(*) FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'schema_migrations')
      || '|' ||
      (SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name <> 'schema_migrations')
      || '|' ||
      (SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = 'public' AND c.conrelid <> 'public.schema_migrations'::regclass)
      || '|' ||
      (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename <> 'schema_migrations')`,
  );

  const parityDatabase = makeThrowawayDatabaseName("migration_rehearsal");
  await config.process.run(config.createdbBinary, [
    `--maintenance-db=${maintenanceUrl}`,
    `--template=${config.database}`,
    parityDatabase,
  ]);
  await run("pnpm", ["exec", "tsx", "../lib/db/src/schemaCiCheck.ts"], {
    env: {
      ...process.env,
      SCHEMA_CHECK_DATABASE_URL: localPostgresUrl(config.port, parityDatabase),
      SCHEMA_CHECK_EXISTING: "true",
    },
  });
  process.stdout.write(
    `POPULATED-SCHEMA initial no-ledger reconciliation: applied=${initialAppliedCount}, ledger=${initialLedger}, baseline SQL skipped\n`,
  );
  process.stdout.write(
    `POPULATED-SCHEMA retry: applied=0, adopted=000_baseline (${expectedBaselineChecksum}), constraints/indexes unchanged (${catalogCounts.replace("|", "/")})\n`,
  );
}

export async function rehearseEmptySchema(): Promise<void> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "mbs-empty-schema-"));
  const config = defaultCloneConfig(workspace);
  config.port = await freePort();
  config.log = () => {};

  let started = false;
  let primaryError: unknown;
  try {
    started = true;
    await startManagedCloneServer(config);

    const maintenanceUrl = localPostgresUrl(config.port, "postgres");
    await config.process.run(config.createdbBinary, [
      `--maintenance-db=${maintenanceUrl}`,
      config.database,
    ]);

    const migrationUrl = localPostgresUrl(config.port, config.database);
    const emptyCheck = await config.process.capture(config.psqlBinary, [
      "--dbname", migrationUrl,
      "--tuples-only",
      "--no-align",
      "--command",
      "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
    ]);
    if (emptyCheck.code !== 0 || emptyCheck.stdout.trim() !== "0") {
      throw new Error("Fresh migration rehearsal database was not empty");
    }

    const migrationEnv = {
      ...process.env,
      MIGRATION_REHEARSAL_DATABASE_URL: migrationUrl,
    };
    await run("pnpm", ["exec", "tsx", "../lib/db/src/migrationRehearsalRunner.ts"], {
      env: migrationEnv,
    });

    // The migration runner permits only production_clone, so verify final model
    // parity on a disposable template-copy with the existing parity guard.
    const parityDatabase = makeThrowawayDatabaseName("migration_rehearsal");
    await config.process.run(config.createdbBinary, [
      `--maintenance-db=${maintenanceUrl}`,
      `--template=${config.database}`,
      parityDatabase,
    ]);
    await run("pnpm", ["exec", "tsx", "../lib/db/src/schemaCiCheck.ts"], {
      env: {
        ...process.env,
        SCHEMA_CHECK_DATABASE_URL: localPostgresUrl(config.port, parityDatabase),
        SCHEMA_CHECK_EXISTING: "true",
      },
    });
    const roleDefault = await config.process.capture(config.psqlBinary, [
      "--dbname", migrationUrl,
      "--tuples-only",
      "--no-align",
      "--command",
      "SELECT column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'role'",
    ]);
    if (roleDefault.code !== 0 || roleDefault.stdout.trim() !== "'pending'::text") {
      throw new Error("Empty-schema replay did not preserve the users.role pending default");
    }
    process.stdout.write("EMPTY-SCHEMA users.role default: pending\n");
    process.stdout.write("EMPTY-SCHEMA 000-TO-LATEST REHEARSAL PASS\n");
    await rehearsePopulatedSchemaAdoption(config, maintenanceUrl);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    let cleanupError: unknown;
    try {
      if (started) await stopManagedCloneServer(config);
    } catch (error) {
      cleanupError = error;
    }
    try {
      await rm(workspace, { recursive: true, force: true });
    } catch (error) {
      cleanupError = cleanupError
        ? new AggregateError([cleanupError, error], "empty-schema cleanup failed")
        : error;
    }
    if (cleanupError && primaryError) {
      throw new AggregateError([primaryError, cleanupError], "empty-schema rehearsal and cleanup failed");
    }
    if (cleanupError) throw cleanupError;
  }
}