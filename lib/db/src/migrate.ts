import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";

type QueryResult = { rows?: unknown[] };
type Executor = {
  execute(query: unknown): Promise<QueryResult>;
};
type Database = Executor & {
  transaction<T>(callback: (tx: Executor) => Promise<T>): Promise<T>;
};

export type MigrationFile = {
  name: string;
  id: string;
  checksum: string;
  sql: string;
};

export type MigrationStatus = MigrationFile & {
  status: "applied" | "pending" | "mismatch";
  appliedAt?: string;
  appliedChecksum?: string;
  detectedAsApplied?: boolean;
};

export type MigrationReport = {
  applied: string[];
  detected: string[];
  skipped: string[];
  pending: string[];
  mismatches: Array<{ name: string; expected: string; actual: string }>;
  failed: { name: string; error: string } | null;
  migrations: MigrationStatus[];
};

const formatMigrationError = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  return cause instanceof Error ? `${error.message}: ${cause.message}` : error.message;
};

export function formatSchemaBootLine(report: Pick<MigrationReport, "pending" | "mismatches" | "migrations">): string {
  const pending = [
    ...report.pending,
    ...report.mismatches.map(({ name }) => `${name} (checksum mismatch)`),
  ];
  if (pending.length > 0) return `SCHEMA PENDING: ${pending.join(", ")}`;
  const applied = report.migrations.filter((migration) => migration.status === "applied").length;
  return `schema OK (${applied} applied)`;
}

/**
 * The boot runner uses a separate line from the admin/status dry-run output:
 * this describes only what this boot applied, while the total is the number
 * of numbered migration files discovered in the bundle.
 */
export function formatSchemaSuccessLine(report: Pick<MigrationReport, "applied" | "migrations">): string {
  return `schema OK — applied ${report.applied.length} (${report.applied.join(", ")}), ${report.migrations.length} total`;
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * The first path is used by the API bundle (build.mjs copies the SQL files
 * next to the bundle). The latter paths keep this package useful on its own
 * in development and in migration tests.
 */
const defaultMigrationDirectories = [
  path.resolve(moduleDir, "migrations"),
  path.resolve(moduleDir, "../migrations"),
  path.resolve(moduleDir, "../../lib/db/migrations"),
];

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("code" in error && (error as { code?: unknown }).code) {
    return String((error as { code?: unknown }).code);
  }
  return "cause" in error
    ? errorCode((error as { cause?: unknown }).cause)
    : undefined;
}

async function findMigrationDirectory(directory?: string): Promise<string> {
  if (directory) return directory;
  for (const candidate of defaultMigrationDirectories) {
    try {
      await readdir(candidate);
      return candidate;
    } catch {
      // Try the next layout.
    }
  }
  throw new Error("Migration directory was not found");
}

export async function discoverMigrations(directory?: string): Promise<MigrationFile[]> {
  const migrationDirectory = await findMigrationDirectory(directory);
  const names = (await readdir(migrationDirectory))
    .filter((name) => /^\d+_.+\.sql$/i.test(name))
    .sort((a, b) => {
      const numberA = Number(a.match(/^\d+/)?.[0] ?? 0);
      const numberB = Number(b.match(/^\d+/)?.[0] ?? 0);
      return numberA - numberB || a.localeCompare(b);
    });

  return Promise.all(
    names.map(async (name) => {
      const contents = await readFile(path.join(migrationDirectory, name), "utf8");
      return {
        name,
        id: name.replace(/\.sql$/i, ""),
        checksum: createHash("sha256").update(contents).digest("hex"),
        sql: contents,
      };
    }),
  );
}

async function tableAndColumns(
  executor: Executor,
  table: string,
  columns: string[],
): Promise<boolean> {
  const tableResult = await executor.execute(sql`
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = ${table}
  `);
  if (!tableResult.rows?.length) return false;
  if (columns.length === 0) return true;

  const columnResult = await executor.execute(sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = ${table}
      AND column_name IN (${sql.join(columns.map((column) => sql`${column}`), sql`, `)})
  `);
  const present = new Set(
    (columnResult.rows ?? []).map((row) =>
      String((row as Record<string, unknown>).column_name),
    ),
  );
  return columns.every((column) => present.has(column));
}

/**
 * These are deliberately conservative markers. A migration is only seeded
 * into the ledger when all of its durable schema changes are already present.
 * In particular, 018 must not be replayed: it contains lender rule backfills
 * that should never overwrite changes made after the original rollout.
 */
async function schemaShowsMigrationApplied(
  executor: Executor,
  migration: MigrationFile,
): Promise<boolean> {
  const n = Number(migration.name.match(/^\d+/)?.[0]);
  const markers: Record<number, [string, string[]][]> = {
    1: [["credit_pulls", []], ["credit_compliance_log", []]],
    2: [["users", ["slug"]]],
    3: [["deals", []], ["activity_log", ["deal_id"]]],
    4: [["deals", ["intended_rep_slug"]]],
    5: [["company_settings", ["include_admins_in_round_robin", "round_robin_cursor"]]],
    6: [["drip_sequences", ["created_by"]]],
    7: [["company_settings", ["stale_threshold_days"]]],
    8: [["company_settings", ["email_sending_enabled", "bulk_email_per_minute"]]],
    9: [["email_sends", ["failure_reason"]]],
    10: [["email_webhook_events", []], ["leads", []]],
    11: [["email_rate_slots", []]],
    12: [["applications", ["signature_method", "signature_signed_at"]]],
    13: [["retired_rep_slugs", []]],
    14: [["applications", [
      "business_type", "annual_revenue", "business_start_date",
      "years_under_current_ownership", "business_description", "est_credit_score",
      "timeline_funds_needed", "year_make_model", "trucks_in_fleet",
      "down_payment_amount", "secondary_owner_name", "secondary_owner_email",
      "secondary_owner_address", "secondary_owner_ssn_encrypted",
      "secondary_owner_dob", "secondary_owner_ownership_pct", "secondary_owner_cell",
      "secondary_owner_est_credit_score",
    ]]],
    15: [["applications", ["consent_text_version"]]],
    16: [["users", ["title"]]],
    17: [["deals", ["notes", "gm_split_pct"]]],
    18: [["lenders", [
      "restricted_industries", "prohibited_industries", "min_monthly_revenue",
      "restricted_industry_min_monthly_revenue", "startup_min_credit_score",
      "startup_max_time_in_business_months", "startup_max_amount",
      "min_industry_experience_months", "requires_financial_statements",
      "trucking_rules", "industry_time_in_business_overrides",
      "program_eligibility_rules",
    ]], ["applications", ["has_financial_statements", "has_factoring", "industry_experience_months"]]],
    19: [["documents", ["category"]]],
    34: [["applications", ["sms_consent", "sms_consent_at", "sms_consent_ip"]]],
    35: [
      ["user_identities", ["user_id", "clerk_id", "email", "provider", "linked_at"]],
      ["users", ["merged_into_user_id"]],
      ["admin_audit_log", ["actor_user_id", "action", "entity_type", "entity_id", "details", "created_at"]],
    ],
  };
  const required = markers[n];
  if (!required) return false;
  for (const [table, columns] of required) {
    if (!(await tableAndColumns(executor, table, columns))) return false;
  }
  return true;
}

async function readLedger(executor: Executor): Promise<Map<string, { checksum: string; appliedAt?: string }>> {
  try {
    const result = await executor.execute(sql`
      SELECT name, checksum, applied_at
      FROM schema_migrations
      ORDER BY name
    `);
    return new Map(
      (result.rows ?? []).map((row) => {
        const record = row as Record<string, unknown>;
        return [
          String(record.name),
          {
            checksum: String(record.checksum),
            appliedAt: record.applied_at ? new Date(String(record.applied_at)).toISOString() : undefined,
          },
        ];
      }),
    );
  } catch (error) {
    if (errorCode(error) === "42P01") return new Map();
    throw error;
  }
}

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

export async function runMigrations(options: {
  db?: Database;
  migrationsDir?: string;
  dryRun?: boolean;
} = {}): Promise<MigrationReport> {
  if (!options.db) {
    throw new Error("A database executor is required to run migrations");
  }
  const database = options.db;
  const migrations = await discoverMigrations(options.migrationsDir);
  const report = emptyReport();

  if (!options.dryRun) {
    await database.execute(sql`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now(),
        checksum text NOT NULL,
        failed_at timestamptz,
        error text,
        superseded_by text,
        superseded_at timestamptz
      )
    `);
    await database.execute(sql`
      ALTER TABLE schema_migrations
        ADD COLUMN IF NOT EXISTS failed_at timestamptz,
        ADD COLUMN IF NOT EXISTS error text,
        ADD COLUMN IF NOT EXISTS superseded_by text,
        ADD COLUMN IF NOT EXISTS superseded_at timestamptz
    `);
  }
  const ledger = await readLedger(database);

  // Do the complete first-boot reconciliation before running any migration.
  // This matters for databases created before the ledger was introduced: all
  // durable schema markers must be inspected and seeded before a later
  // pending migration is allowed to run.
  const pendingMigrations: MigrationFile[] = [];
  for (const migration of migrations) {
    const ledgerEntry = ledger.get(migration.id);
    if (ledgerEntry) {
      if (ledgerEntry.checksum !== migration.checksum) {
        report.mismatches.push({
          name: migration.name,
          expected: ledgerEntry.checksum,
          actual: migration.checksum,
        });
        report.migrations.push({
          ...migration,
          status: "mismatch",
          appliedAt: ledgerEntry.appliedAt,
          appliedChecksum: ledgerEntry.checksum,
        });
      } else {
        report.skipped.push(migration.name);
        report.migrations.push({
          ...migration,
          status: "applied",
          appliedAt: ledgerEntry.appliedAt,
          appliedChecksum: ledgerEntry.checksum,
        });
      }
      continue;
    }

    let detected: boolean;
    try {
      detected = await schemaShowsMigrationApplied(database, migration);
    } catch (error) {
      report.pending.push(migration.name);
      report.migrations.push({ ...migration, status: "pending" });
      report.failed = {
        name: migration.name,
        error: formatMigrationError(error),
      };
      break;
    }
    if (detected) {
      report.detected.push(migration.name);
      report.skipped.push(migration.name);
      report.migrations.push({ ...migration, status: "applied", detectedAsApplied: true });
      if (!options.dryRun) {
        try {
          await database.transaction(async (tx) => {
            await tx.execute(sql`
              INSERT INTO schema_migrations (name, checksum)
              VALUES (${migration.id}, ${migration.checksum})
            `);
          });
        } catch (error) {
          report.failed = {
            name: migration.name,
            error: formatMigrationError(error),
          };
          break;
        }
      }
      continue;
    }

    report.pending.push(migration.name);
    report.migrations.push({ ...migration, status: "pending" });
    pendingMigrations.push(migration);
  }

  // A reconciliation failure must not allow any pending migration collected
  // before it to run: the first-boot phase is all-or-nothing.
  if (report.failed) return report;

  for (const migration of pendingMigrations) {
    if (options.dryRun) continue;

    try {
      await database.transaction(async (tx) => {
        await tx.execute(sql.raw(migration.sql));
        await tx.execute(sql`
          INSERT INTO schema_migrations (name, checksum)
          VALUES (${migration.id}, ${migration.checksum})
        `);
      });
      report.applied.push(migration.name);
      report.pending = report.pending.filter((name) => name !== migration.name);
      const status = report.migrations.find((entry) => entry.name === migration.name);
      if (status) {
        status.status = "applied";
        status.appliedChecksum = migration.checksum;
      }
    } catch (error) {
      report.failed = {
        name: migration.name,
        error: formatMigrationError(error),
      };
      break;
    }
  }

  return report;
}

export async function getMigrationStatus(options: {
  db?: Database;
  migrationsDir?: string;
} = {}): Promise<MigrationReport> {
  return runMigrations({ ...options, dryRun: true });
}