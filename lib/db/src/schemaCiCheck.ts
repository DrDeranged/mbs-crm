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
    if (diff.statementsToExecute.length > 0) {
      throw new Error([
        "Drizzle schema differs from a database built by the SQL migration runner:",
        ...diff.statementsToExecute,
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