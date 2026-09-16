import { drizzle } from "drizzle-orm/node-postgres";
import {
  runMigrations,
  formatSchemaBootLine,
  formatSchemaSuccessLine,
  type MigrationReport,
} from "@workspace/db/migrate";
import * as schema from "@workspace/db/schema";

/**
 * This is intentionally a fixed, application-specific lock key. It is held
 * on the same dedicated client used to construct the Drizzle database so no
 * other pool checkout can accidentally run migrations outside the lock.
 */
export const SCHEMA_MIGRATION_LOCK_KEY = 874242;

export type SchemaBootFailure = {
  name: string;
  error: string;
};

type DedicatedClient = {
  query(text: string, values?: unknown[]): Promise<unknown>;
  release(): void;
};

type DedicatedPool = {
  connect(): Promise<DedicatedClient>;
};

type BootLogger = {
  info(message: string): void;
  error(message: string): void;
  warn?(message: string): void;
};

type RunMigrations = typeof runMigrations;

let bootSchemaFailure: SchemaBootFailure | null = null;

export function getBootSchemaFailure(): SchemaBootFailure | null {
  return bootSchemaFailure;
}

export function clearBootSchemaFailure(): void {
  bootSchemaFailure = null;
}

export function schemaBootSuccessLine(report: Pick<MigrationReport, "applied" | "migrations">): string {
  return formatSchemaSuccessLine(report);
}

export async function runSchemaBoot(options: {
  pool: DedicatedPool;
  logger: BootLogger;
  runMigrations?: RunMigrations;
}): Promise<MigrationReport | null> {
  let client: DedicatedClient | undefined;
  try {
    client = await options.pool.connect();
    // Session-level lock is required here because each migration gets its own
    // transaction. The dedicated client keeps the lock for the whole sequence.
    await client.query("SELECT pg_advisory_lock($1)", [SCHEMA_MIGRATION_LOCK_KEY]);

    // The narrow client interface above keeps this coordinator easy to test;
    // node-postgres supplies the fuller PoolClient shape at runtime.
    const migrationDb = drizzle(client as never, { schema });
    const report = await (options.runMigrations ?? runMigrations)({ db: migrationDb });
    if (report.failed) {
      bootSchemaFailure = report.failed;
      options.logger.error(`MIGRATION FAILED: ${report.failed.name}: ${report.failed.error}`);
    } else if (report.pending.length > 0 || report.mismatches.length > 0) {
      options.logger.warn?.(formatSchemaBootLine(report));
    } else {
      clearBootSchemaFailure();
      options.logger.info(schemaBootSuccessLine(report));
    }
    return report;
  } catch (error) {
    const failure: SchemaBootFailure = {
      name: "startup",
      error: error instanceof Error ? error.message : String(error),
    };
    bootSchemaFailure = failure;
    options.logger.error(`MIGRATION FAILED: ${failure.name}: ${failure.error}`);
    return null;
  } finally {
    if (client) {
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [SCHEMA_MIGRATION_LOCK_KEY]);
      } catch (error) {
        options.logger.warn?.(
          `Schema migration advisory unlock failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        client.release();
      }
    }
  }
}