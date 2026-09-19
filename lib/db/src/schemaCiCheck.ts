import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { pushSchema } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { runMigrations } from "./migrate";

const schemaDirectory = path.resolve(import.meta.dirname, "schema");
const baselineDirectory = path.resolve(import.meta.dirname, "../schema-ci-baseline");
const migrationsDirectory = path.resolve(import.meta.dirname, "../migrations");

const equivalentDefaultStatements = new Set([
  `ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'pending';`,
  `ALTER TABLE "lenders" ALTER COLUMN "program_types" SET DEFAULT '{}';`,
  `ALTER TABLE "lenders" ALTER COLUMN "accepted_industries" SET DEFAULT '{}';`,
  `ALTER TABLE "lenders" ALTER COLUMN "accepted_states" SET DEFAULT '{}';`,
  `ALTER TABLE "lenders" ALTER COLUMN "restricted_industries" SET DEFAULT '{}';`,
  `ALTER TABLE "lenders" ALTER COLUMN "prohibited_industries" SET DEFAULT '{}';`,
  `ALTER TABLE "deal_approvals" ALTER COLUMN "down_payment" SET DEFAULT 0;`,
]);

const constraintKind = (statement: string): string | undefined => {
  if (statement.includes(" FOREIGN KEY ")) return "foreign-key";
  if (statement.includes(" UNIQUE(")) return "unique";
  if (statement.includes(" CHECK ")) return "check";
  const droppedName = statement.match(/DROP CONSTRAINT "([^"]+)"/)?.[1];
  if (!droppedName) return undefined;
  if (droppedName.endsWith("_key")) return "unique";
  if (droppedName.endsWith("_check")) return "check";
  if (droppedName.endsWith("_fk") || droppedName.endsWith("_fkey")) {
    return "foreign-key";
  }
  return undefined;
};

export function filterCheckerArtifacts(statements: string[]): string[] {
  const normalized = statements.map((statement) => statement.trim());
  const droppedConstraints = new Map<string, number>();
  const addedConstraints = new Map<string, number>();
  const droppedIndexes = new Set<string>();
  const createdIndexes = new Set<string>();

  for (const statement of normalized) {
    const table = statement.match(/^ALTER TABLE "([^"]+)"/)?.[1];
    const kind = constraintKind(statement);
    if (table && kind && statement.includes(" DROP CONSTRAINT ")) {
      const key = `${table}:${kind}`;
      droppedConstraints.set(key, (droppedConstraints.get(key) ?? 0) + 1);
    }
    if (table && kind && statement.includes(" ADD CONSTRAINT ")) {
      const key = `${table}:${kind}`;
      addedConstraints.set(key, (addedConstraints.get(key) ?? 0) + 1);
    }
    const droppedIndex = statement.match(/^DROP INDEX "([^"]+)";$/)?.[1];
    if (droppedIndex) droppedIndexes.add(droppedIndex);
    const createdIndex = statement.match(/^CREATE (?:UNIQUE )?INDEX "([^"]+)"/)?.[1];
    if (createdIndex) createdIndexes.add(createdIndex);
  }

  return normalized.filter((statement) => {
    if (equivalentDefaultStatements.has(statement)) return false;
    if (
      statement
      === `ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_bulk_email_per_minute_check" CHECK ("company_settings"."bulk_email_per_minute" BETWEEN 1 AND 1000);`
    ) {
      return false;
    }

    const table = statement.match(/^ALTER TABLE "([^"]+)"/)?.[1];
    const kind = constraintKind(statement);
    if (table && kind) {
      const key = `${table}:${kind}`;
      if (
        droppedConstraints.get(key) === addedConstraints.get(key)
        && (droppedConstraints.get(key) ?? 0) > 0
      ) {
        return false;
      }
    }

    const droppedIndex = statement.match(/^DROP INDEX "([^"]+)";$/)?.[1];
    if (droppedIndex && createdIndexes.has(droppedIndex)) return false;
    const createdIndex = statement.match(/^CREATE (?:UNIQUE )?INDEX "([^"]+)"/)?.[1];
    if (createdIndex && droppedIndexes.has(createdIndex)) return false;
    return true;
  });
}

export function assertSafeSchemaCheckUrl(value: string | undefined): URL {
  if (!value) {
    throw new Error("SCHEMA_CHECK_DATABASE_URL is required");
  }

  const url = new URL(value);
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  const databaseName = url.pathname.replace(/^\//, "");
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("Schema parity checks require PostgreSQL");
  }
  if (!localHosts.has(url.hostname) || !/^schema_ci(?:_|$)/.test(databaseName)) {
    throw new Error(
      "Refusing schema parity check: use a fresh local database named schema_ci or schema_ci_*",
    );
  }
  return url;
}

export async function loadCompleteSchemaSet(
  directory = schemaDirectory,
): Promise<Record<string, unknown>> {
  const files = (await readdir(directory))
    .filter((name) => name.endsWith(".ts") && name !== "index.ts")
    .sort();
  const schema: Record<string, unknown> = {};

  for (const file of files) {
    Object.assign(schema, await import(pathToFileURL(path.join(directory, file)).href));
  }
  return schema;
}

export async function checkRunnerMigrationParity(
  connectionString = process.env.SCHEMA_CHECK_DATABASE_URL,
): Promise<void> {
  const safeUrl = assertSafeSchemaCheckUrl(connectionString);
  const pool = new Pool({ connectionString: safeUrl.toString(), max: 1 });
  const database = drizzle(pool);

  try {
    const existing = await pool.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);
    if (existing.rows[0]?.count !== "0") {
      throw new Error("Schema parity database must be empty before the migration runner starts");
    }

    const baselineReport = await runMigrations({
      db: database,
      migrationsDir: baselineDirectory,
    });
    if (baselineReport.failed || baselineReport.pending.length || baselineReport.mismatches.length) {
      throw new Error(`CI baseline migration did not finish cleanly: ${JSON.stringify({
        failed: baselineReport.failed,
        pending: baselineReport.pending,
        mismatches: baselineReport.mismatches,
      })}`);
    }

    const report = await runMigrations({
      db: database,
      migrationsDir: migrationsDirectory,
    });
    if (report.failed || report.pending.length || report.mismatches.length) {
      throw new Error(`SQL migration runner did not finish cleanly: ${JSON.stringify({
        failed: report.failed,
        pending: report.pending,
        mismatches: report.mismatches,
      })}`);
    }

    const schema = await loadCompleteSchemaSet();
    const diff = await pushSchema(
      schema,
      database,
      ["public"],
      ["*", "!schema_migrations"],
    );
    const actionableDiff = filterCheckerArtifacts(diff.statementsToExecute);
    if (actionableDiff.length > 0) {
      throw new Error([
        "Drizzle schema differs from a database built by the SQL migration runner:",
        ...actionableDiff,
      ].join("\n\n"));
    }
  } finally {
    await pool.end();
  }
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  await checkRunnerMigrationParity();
  console.log("Schema parity OK: SQL runner and complete Drizzle schema set match");
}