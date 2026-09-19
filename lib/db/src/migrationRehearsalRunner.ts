import path from "node:path";
import { pathToFileURL } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  analyzeMigrationSql,
  discoverMigrations,
  getMigrationStatus,
  runMigrations,
  type MigrationReport,
} from "./migrate";

function safeErrorMessage(error: unknown): string {
  if (error instanceof AggregateError) {
    return error.errors.map((entry) => safeErrorMessage(entry)).filter(Boolean).join("; ") || error.message;
  }
  if (error instanceof Error) return error.message || error.name;
  return typeof error === "string" ? error : "Unknown migration rehearsal error";
}

export function assertSafeMigrationRehearsalUrl(value = process.env.MIGRATION_REHEARSAL_DATABASE_URL): URL {
  if (!value) throw new Error("MIGRATION_REHEARSAL_DATABASE_URL is required");
  const url = new URL(value);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      database !== "production_clone") {
    throw new Error("Migration rehearsal requires the managed local production_clone database");
  }
  return url;
}

type LedgerRow = { name: string; checksum: string; state: string };
export type LedgerSnapshot = { rows: LedgerRow[]; count: number };

export async function snapshotLedger(pool: Pool): Promise<LedgerSnapshot> {
  const columns = await pool.query<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'schema_migrations'",
  );
  if (!columns.rowCount) return { rows: [], count: 0 };
  const names = new Set(columns.rows.map((r) => r.column_name));
  const selected = ["name", "checksum", "applied_at", "failed_at", "error", "superseded_at"]
    .filter((name) => names.has(name));
  if (!names.has("name") || !names.has("checksum")) throw new Error("schema_migrations lacks name/checksum columns");
  const result = await pool.query<Record<string, unknown>>(
    `SELECT ${selected.map((name) => `"${name}"`).join(", ")} FROM "schema_migrations" ORDER BY name`,
  );
  return {
    count: result.rowCount ?? 0,
    rows: result.rows.map((row) => ({
      name: String(row.name),
      checksum: String(row.checksum),
      state: row.failed_at || row.error ? "failed" : row.superseded_at ? "superseded" : "applied",
    })),
  };
}

export function simulateMigrationDependencies(
  migrations: Awaited<ReturnType<typeof discoverMigrations>>,
  pendingNames: Set<string>,
  initialTables: Iterable<string>,
): { migration: string; missing: string } | null {
  const known = new Set(initialTables);
  for (const migration of migrations) {
    if (!pendingNames.has(migration.name)) continue;
    const analysis = analyzeMigrationSql(migration.sql);
    for (const operation of analysis.operations) {
      if (operation.kind === "reference" && !known.has(operation.table)) {
        return { migration: migration.name, missing: operation.table };
      }
      if (operation.kind === "create") known.add(operation.table);
    }
  }
  return null;
}

export async function precheck(pool: Pool, report: MigrationReport, migrationsDir: string): Promise<void> {
  const ledger = await snapshotLedger(pool);
  const byName = new Map(ledger.rows.map((row) => [row.name.replace(/\.sql$/i, ""), row]));
  const migrations = await discoverMigrations(migrationsDir);
  const pending = new Set<string>();
  for (const migration of migrations) {
    const row = byName.get(migration.id);
    if (row && row.checksum !== migration.checksum) {
      throw new Error(`Migration dependency pre-check failed: checksum mismatch for ${migration.name}`);
    }
    if (!row || row.state === "failed") pending.add(migration.name);
  }
  const catalog = await pool.query<{ relname: string }>(
    "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
    "WHERE n.nspname = 'public' AND c.relkind IN ('r','p')",
  );
  const initial = new Set(["schema_migrations", ...catalog.rows.map((r) => r.relname)]);
  try {
    const simulated = simulateMigrationDependencies(migrations, pending, initial);
    if (simulated) throw new Error(`Migration dependency pre-check failed: ${simulated.migration} references missing table ${simulated.missing}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Migration dependency")) throw error;
    throw new Error(`Migration dependency pre-check failed: ${safeErrorMessage(error)}`);
  }
}

export function formatLedgerDiff(before: LedgerSnapshot, after: LedgerSnapshot): string {
  const b = new Map(before.rows.map((row) => [row.name, row]));
  const a = new Map(after.rows.map((row) => [row.name, row]));
  const added = [...a.keys()].filter((name) => !b.has(name));
  const removed = [...b.keys()].filter((name) => !a.has(name));
  const changed = [...a.keys()].filter((name) => b.has(name) &&
    (a.get(name)!.checksum !== b.get(name)!.checksum || a.get(name)!.state !== b.get(name)!.state));
  return [
    `Ledger before/after counts: ${before.count}/${after.count}`,
    `Added ledger rows: ${added.length ? added.join(", ") : "none"}`,
    `Changed ledger rows: ${changed.length ? changed.join(", ") : "none"}`,
    `Removed ledger rows: ${removed.length ? removed.join(", ") : "none"}`,
  ].join("\n");
}

export async function rehearseMigrations(
  connectionString = process.env.MIGRATION_REHEARSAL_DATABASE_URL,
  migrationsDirOverride?: string,
): Promise<MigrationReport> {
  const safeUrl = assertSafeMigrationRehearsalUrl(connectionString);
  const pool = new Pool({ connectionString: safeUrl.toString(), max: 1 });
  const database = drizzle(pool);
  const migrationsDir = migrationsDirOverride ?? path.resolve(import.meta.dirname, "../migrations");
  let report: MigrationReport;
  let before: LedgerSnapshot | undefined;
  try {
    before = await snapshotLedger(pool);
    report = await getMigrationStatus({ db: database, migrationsDir });
    await precheck(pool, report, migrationsDir);
    report = await runMigrations({ db: database, migrationsDir, allowDependencyReordering: false });
    const after = await snapshotLedger(pool);
    console.log(`Applied names/count: ${report.applied.length ? report.applied.join(", ") : "none"} / ${report.applied.length}`);
    console.log(`Superseded names/count: ${report.skipped.filter((name) => report.migrations.find((m) => m.name === name)?.supersededAt).join(", ") || "none"} / ${report.skipped.filter((name) => report.migrations.find((m) => m.name === name)?.supersededAt).length}`);
    console.log(`Failed: ${report.failed ? `${report.failed.name}: ${report.failed.error}` : "none"}`);
    console.log(formatLedgerDiff(before!, after));
  } catch (error) {
    const after = before ? await snapshotLedger(pool) : undefined;
    console.log(`Applied names/count: none / 0`);
    console.log(`Superseded names/count: none / 0`);
    console.log(`Failed: ${safeErrorMessage(error)}`);
    if (after) console.log(formatLedgerDiff(before!, after));
    throw error;
  } finally {
    await pool.end();
  }
  if (report.failed || report.pending.length || report.mismatches.length) {
    throw new Error(`Migration rehearsal failed: ${JSON.stringify({ failed: report.failed, pending: report.pending, mismatches: report.mismatches })}`);
  }
  return report;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  await rehearseMigrations().catch(() => {
    process.exitCode = 1;
  });
}