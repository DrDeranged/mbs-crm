import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeMigrationRehearsalUrl, formatLedgerDiff, simulateMigrationDependencies } from "./migrationRehearsalRunner";
import type { MigrationFile } from "./migrate";

test("migration rehearsal URL guard accepts only the managed local clone", () => {
  assert.equal(
    assertSafeMigrationRehearsalUrl(
      "postgresql://postgres:test@127.0.0.1:55432/production_clone",
    ).pathname, "/production_clone",
  );
  assert.throws(
    () => assertSafeMigrationRehearsalUrl(
      "postgresql://postgres:test@workspace-db/production_clone",
    ),
    /managed local/,
  );
});

const migration = (name: string, sql: string): MigrationFile => ({ name, id: name.slice(0, -4), checksum: name, sql });

test("dependency simulation rejects a later creator but accepts an earlier creator", () => {
  const later = simulateMigrationDependencies([
    migration("001_use.sql", "SELECT * FROM needed;"),
    migration("002_create.sql", "CREATE TABLE needed (id int);"),
  ], new Set(["001_use.sql", "002_create.sql"]), []);
  assert.deepEqual(later, { migration: "001_use.sql", missing: "needed" });
  assert.equal(simulateMigrationDependencies([
    migration("001_create.sql", "CREATE TABLE needed (id int);"),
    migration("002_use.sql", "SELECT * FROM needed;"),
  ], new Set(["001_create.sql", "002_use.sql"]), []), null);
});

test("ledger diff reports added, changed, removed, and state changes", () => {
  const before = { count: 2, rows: [
    { name: "old", checksum: "a", state: "applied" },
    { name: "changed", checksum: "b", state: "applied" },
  ] };
  const after = { count: 2, rows: [
    { name: "changed", checksum: "c", state: "failed" },
    { name: "new", checksum: "d", state: "superseded" },
  ] };
  const output = formatLedgerDiff(before, after);
  assert.match(output, /Added ledger rows: new/);
  assert.match(output, /Changed ledger rows: changed/);
  assert.match(output, /Removed ledger rows: old/);
});