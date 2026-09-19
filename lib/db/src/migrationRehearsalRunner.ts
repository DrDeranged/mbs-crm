import path from "node:path";
import { pathToFileURL } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { runMigrations } from "./migrate";

export function assertSafeMigrationRehearsalUrl(value: string | undefined): URL {
  if (!value) throw new Error("MIGRATION_REHEARSAL_DATABASE_URL is required");
  const url = new URL(value);
  const databaseName = url.pathname.replace(/^\//, "");
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("Migration rehearsal requires PostgreSQL");
  }
  if (!/^migration_rehearsal_[a-z0-9_]+$/.test(databaseName)) {
    throw new Error(
      "Refusing migration rehearsal: target must be a throwaway database named migration_rehearsal_*",
    );
  }
  return url;
}

export async function rehearseMigrations(
  connectionString = process.env.MIGRATION_REHEARSAL_DATABASE_URL,
): Promise<void> {
  const safeUrl = assertSafeMigrationRehearsalUrl(connectionString);
  const pool = new Pool({ connectionString: safeUrl.toString(), max: 1 });
  const database = drizzle(pool);
  try {
    const report = await runMigrations({
      db: database,
      migrationsDir: path.resolve(import.meta.dirname, "../migrations"),
    });
    if (report.failed || report.pending.length || report.mismatches.length) {
      throw new Error(`Migration rehearsal failed: ${JSON.stringify({
        failed: report.failed,
        pending: report.pending,
        mismatches: report.mismatches,
      })}`);
    }
    console.log(
      `Migration runner rehearsal OK: ${report.applied.length} applied, ${report.detected.length} detected, ${report.skipped.length} already recorded`,
    );
  } finally {
    await pool.end();
  }
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  await rehearseMigrations();
}