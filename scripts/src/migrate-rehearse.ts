import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { createThrowawayDatabase, dropThrowawayDatabase, makeThrowawayDatabaseName } from "./throwawayDatabase";
import { run } from "./process";

const workspaceRoot = path.resolve(import.meta.dirname, "../..");
const fallbackSchema = path.join(
  workspaceRoot,
  "lib/db/schema-ci-baseline/000_pre_runner_schema.sql",
);

async function latestProductionBackup(): Promise<string | null> {
  if (process.env.MIGRATION_REHEARSAL_BACKUP) {
    return path.resolve(process.env.MIGRATION_REHEARSAL_BACKUP);
  }
  const directory = path.join(workspaceRoot, "backups/production");
  try {
    const candidates = (await readdir(directory))
      .filter((name) => /\.(?:sql|dump|backup)$/i.test(name));
    const entries = await Promise.all(candidates.map(async (name) => {
      const filePath = path.join(directory, name);
      return { filePath, modifiedAt: (await stat(filePath)).mtimeMs };
    }));
    entries.sort((a, b) => b.modifiedAt - a.modifiedAt);
    return entries[0]?.filePath ?? null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function restore(source: string, targetUrl: string): Promise<void> {
  if (/\.sql$/i.test(source)) {
    await run("psql", [
      `--dbname=${targetUrl}`,
      "--set=ON_ERROR_STOP=on",
      `--file=${source}`,
    ]);
    return;
  }
  if (/\.(?:dump|backup)$/i.test(source)) {
    await run("pg_restore", [
      "--exit-on-error",
      "--no-owner",
      "--no-privileges",
      `--dbname=${targetUrl}`,
      source,
    ]);
    return;
  }
  throw new Error(
    `Unsupported rehearsal backup ${source}; use a PostgreSQL .sql, .dump, or .backup file`,
  );
}

const baseConnectionString = process.env.DATABASE_URL;
if (!baseConnectionString) {
  throw new Error("DATABASE_URL is required for migration rehearsal");
}

const databaseName = makeThrowawayDatabaseName("migration_rehearsal");
const targetUrl = await createThrowawayDatabase(baseConnectionString, databaseName);
try {
  const backup = await latestProductionBackup();
  const source = backup ?? fallbackSchema;
  await stat(source);
  console.log(
    backup
      ? `Migration rehearsal source: latest production backup ${source}`
      : `Migration rehearsal source: schema-only baseline ${source} (no production data backup found)`,
  );
  await restore(source, targetUrl);
  await run(
    "pnpm",
    ["--filter", "@workspace/scripts", "exec", "tsx", "../lib/db/src/migrationRehearsalRunner.ts"],
    { env: { ...process.env, MIGRATION_REHEARSAL_DATABASE_URL: targetUrl } },
  );
  console.log("Running schema parity after migration rehearsal");
  await run("pnpm", ["-w", "run", "check:schema"], {
    env: {
      ...process.env,
      SCHEMA_CHECK_DATABASE_URL: targetUrl,
      SCHEMA_CHECK_EXISTING: "true",
    },
  });
  console.log("MIGRATION REHEARSAL PASS");
} catch (error) {
  console.error("MIGRATION REHEARSAL FAIL");
  throw error;
} finally {
  await dropThrowawayDatabase(baseConnectionString, databaseName);
}