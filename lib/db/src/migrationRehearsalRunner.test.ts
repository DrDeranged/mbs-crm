import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeMigrationRehearsalUrl } from "./migrationRehearsalRunner";

test("migration rehearsal URL guard accepts only throwaway databases", () => {
  assert.equal(
    assertSafeMigrationRehearsalUrl(
      "postgresql://postgres:test@workspace-db/migration_rehearsal_123",
    ).pathname,
    "/migration_rehearsal_123",
  );
  assert.throws(
    () => assertSafeMigrationRehearsalUrl(
      "postgresql://postgres:test@workspace-db/production",
    ),
    /Refusing migration rehearsal/,
  );
});