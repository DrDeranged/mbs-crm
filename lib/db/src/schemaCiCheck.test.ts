import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeSchemaCheckUrl, loadCompleteSchemaSet } from "./schemaCiCheck";

test("schema parity check accepts only isolated local CI databases", () => {
  assert.equal(
    assertSafeSchemaCheckUrl("postgresql://postgres:test@127.0.0.1:5432/schema_ci").pathname,
    "/schema_ci",
  );
  assert.throws(
    () => assertSafeSchemaCheckUrl("postgresql://postgres:test@db.example.com/production"),
    /Refusing schema parity check/,
  );
  assert.throws(
    () => assertSafeSchemaCheckUrl("postgresql://postgres:test@localhost/production"),
    /Refusing schema parity check/,
  );
});

test("schema parity check loads tables from every schema module", async () => {
  const schema = await loadCompleteSchemaSet();
  for (const exportName of [
    "applicationsTable",
    "collateralRendersTable",
    "collateralTemplatesTable",
    "dealApprovalsTable",
    "lenderSubmissionsTable",
  ]) {
    assert.ok(schema[exportName], `missing ${exportName}`);
  }
});