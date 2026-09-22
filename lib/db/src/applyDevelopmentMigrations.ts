import { pathToFileURL } from "node:url";
import type { MigrationReport } from "./migrate";

type MigrationRun = () => Promise<MigrationReport>;

export type DevelopmentDatabaseIdentity = {
  PGHOST?: string;
  PGDATABASE?: string;
  PGUSER?: string;
  PGPORT?: string;
};

export function assertDevelopmentDatabaseUrl(
  value: string | undefined,
  identity: DevelopmentDatabaseIdentity,
): URL {
  if (!value) throw new Error("DATABASE_URL is required to apply development migrations");

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Refusing migrations: DATABASE_URL is not a valid PostgreSQL URL");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("Refusing migrations: DATABASE_URL is not a PostgreSQL URL");
  }

  const required = ["PGHOST", "PGDATABASE", "PGUSER", "PGPORT"] as const;
  const missing = required.filter((key) => !identity[key]);
  if (missing.length > 0) {
    throw new Error(
      `Refusing migrations: development database identity is incomplete (${missing.join(", ")})`,
    );
  }

  const matchesDevelopment = url.hostname.toLowerCase() === identity.PGHOST!.toLowerCase()
    && url.pathname.replace(/^\//, "") === identity.PGDATABASE
    && decodeURIComponent(url.username) === identity.PGUSER
    && (url.port || "5432") === identity.PGPORT;
  if (!matchesDevelopment) {
    throw new Error(
      "Refusing migrations: DATABASE_URL does not match the development database identity",
    );
  }
  return url;
}

function reportProblem(report: MigrationReport): string | null {
  if (report.failed) {
    return `${report.failed.name}: ${report.failed.error}`;
  }
  if (report.mismatches.length > 0) {
    return `checksum mismatch: ${report.mismatches.map(({ name }) => name).join(", ")}`;
  }
  if (report.pending.length > 0) {
    return `still pending: ${report.pending.join(", ")}`;
  }
  return null;
}

export async function applyDevelopmentMigrations(options: {
  run: MigrationRun;
  verify: MigrationRun;
  log?: (message: string) => void;
}): Promise<MigrationReport> {
  const report = await options.run();
  const runProblem = reportProblem(report);
  if (runProblem) throw new Error(`Development migration failed: ${runProblem}`);

  // Re-read the ledger rather than trusting only the in-memory apply report.
  // This proves the durable state that subsequent development boots will see.
  const verification = await options.verify();
  const verificationProblem = reportProblem(verification);
  if (verificationProblem) {
    throw new Error(`Development migration ledger verification failed: ${verificationProblem}`);
  }

  options.log?.(
    `Development migrations current: applied ${report.applied.length}; ledger has ${verification.migrations.length} migrations`,
  );
  return report;
}

export async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") {
    throw new Error(
      "Refusing to run development migrations in a production process; application boot owns production migrations",
    );
  }
  assertDevelopmentDatabaseUrl(process.env.DATABASE_URL, process.env);

  const [{ db, pool }, { getMigrationStatus, runMigrations }] = await Promise.all([
    import("./index"),
    import("./migrate"),
  ]);
  try {
    await applyDevelopmentMigrations({
      run: () => runMigrations({ db }),
      verify: () => getMigrationStatus({ db }),
      log: console.log,
    });
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}