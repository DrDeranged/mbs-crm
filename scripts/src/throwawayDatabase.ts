import { randomUUID } from "node:crypto";
import { run } from "./process";

const SAFE_DATABASE_NAME = /^(?:schema_ci|migration_rehearsal)_[a-z0-9_]+$/;

function assertSafeDatabaseName(name: string): void {
  if (!SAFE_DATABASE_NAME.test(name)) {
    throw new Error(`Refusing unsafe throwaway database name: ${name}`);
  }
}

export function makeThrowawayDatabaseName(prefix: "schema_ci" | "migration_rehearsal"): string {
  return `${prefix}_${process.pid}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

export function databaseUrlFor(baseConnectionString: string, databaseName: string): string {
  assertSafeDatabaseName(databaseName);
  const url = new URL(baseConnectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("Throwaway database checks require PostgreSQL");
  }
  url.pathname = `/${databaseName}`;
  return url.toString();
}

export async function createThrowawayDatabase(
  baseConnectionString: string,
  databaseName: string,
): Promise<string> {
  assertSafeDatabaseName(databaseName);
  const targetUrl = databaseUrlFor(baseConnectionString, databaseName);
  await run("createdb", [`--maintenance-db=${baseConnectionString}`, databaseName]);
  return targetUrl;
}

export async function dropThrowawayDatabase(
  baseConnectionString: string,
  databaseName: string,
): Promise<void> {
  assertSafeDatabaseName(databaseName);
  await run(
    "dropdb",
    ["--if-exists", "--force", `--maintenance-db=${baseConnectionString}`, databaseName],
    { quiet: true },
  );
}