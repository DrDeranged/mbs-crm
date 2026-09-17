import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSafeSchemaCheckUrl,
  filterCheckerArtifacts,
  loadCompleteSchemaSet,
} from "./schemaCiCheck";

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

test("schema parity check ignores only paired Drizzle naming artifacts", () => {
  const statements = [
    `ALTER TABLE "deals" DROP CONSTRAINT "deals_lead_id_fkey";`,
    `ALTER TABLE "deals" ADD CONSTRAINT "deals_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;`,
    `DROP INDEX "deal_approvals_deal_created_idx";`,
    `CREATE INDEX "deal_approvals_deal_created_idx" ON "deal_approvals" USING btree ("deal_id");`,
    `ALTER TABLE "leads" ADD COLUMN "lead_score" integer;`,
    `ALTER TABLE "pii_access_log" ADD CONSTRAINT "pii_access_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;`,
  ];

  assert.deepEqual(filterCheckerArtifacts(statements), statements.slice(4));
});