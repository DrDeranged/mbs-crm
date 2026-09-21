import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSafeSchemaCheckUrl,
  assertSafeExistingSchemaCheckUrl,
  filterCheckerArtifacts,
  loadCompleteSchemaSet,
  SCHEMA_PARITY_TABLE_FILTER,
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

test("existing-schema parity accepts only migration rehearsal databases", () => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://postgres:test@workspace-db/development";
  try {
    assert.equal(
      assertSafeExistingSchemaCheckUrl(
        "postgresql://postgres:test@workspace-db/migration_rehearsal_123",
      ).pathname,
      "/migration_rehearsal_123",
    );
    assert.throws(
      () => assertSafeExistingSchemaCheckUrl(
        "postgresql://postgres:test@workspace-db/production",
      ),
      /Refusing existing-schema parity check/,
    );
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});

test("schema parity check accepts a throwaway database on the development host", () => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://postgres:test@workspace-db/development";
  try {
    assert.equal(
      assertSafeSchemaCheckUrl("postgresql://postgres:test@workspace-db/schema_ci_rehearsal").pathname,
      "/schema_ci_rehearsal",
    );
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});

test("schema parity check loads tables from every schema module", async () => {
  const schema = await loadCompleteSchemaSet();
  for (const exportName of [
    "applicationsTable",
    "collateralRendersTable",
    "collateralTemplatesTable",
    "dealApprovalsTable",
    "lenderSubmissionsTable",
    "schemaMigrationsTable",
  ]) {
    assert.ok(schema[exportName], `missing ${exportName}`);
  }
});

test("migration parity covers every table without exclusions", () => {
  assert.deepEqual(SCHEMA_PARITY_TABLE_FILTER, ["*"]);
  assert.equal(
    SCHEMA_PARITY_TABLE_FILTER.some((pattern) => pattern.startsWith("!")),
    false,
  );
});

test("schema parity check ignores only paired Drizzle naming artifacts", () => {
  const statements = [
    `ALTER TABLE "deals" DROP CONSTRAINT "deals_lead_id_fkey";`,
    `ALTER TABLE "deals" ADD CONSTRAINT "deals_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;`,
    `ALTER TABLE "lender_guideline_versions" DROP CONSTRAINT "lender_guideline_versions_lender_id_fkey";`,
    `ALTER TABLE "lender_guideline_versions" ADD CONSTRAINT "lender_guideline_versions_lender_id_lenders_id_fk" FOREIGN KEY ("lender_id") REFERENCES "public"."lenders"("id") ON DELETE cascade ON UPDATE no action;`,
    `DROP INDEX "underwriting_corrections_lead_field_idx";`,
    `CREATE INDEX "underwriting_corrections_lead_field_idx" ON "underwriting_corrections" USING btree ("lead_id","field","created_at" DESC NULLS LAST);`,
    `ALTER TABLE "lenders" ALTER COLUMN "equipment_restrictions" SET DEFAULT '{}';`,
    `DROP INDEX "deal_approvals_deal_created_idx";`,
    `CREATE INDEX "deal_approvals_deal_created_idx" ON "deal_approvals" USING btree ("deal_id");`,
    `ALTER TABLE "leads" ADD COLUMN "lead_score" integer;`,
    `ALTER TABLE "pii_access_log" ADD CONSTRAINT "pii_access_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;`,
  ];

  assert.deepEqual(filterCheckerArtifacts(statements), statements.slice(7));
});

test("schema parity check preserves changed constraint and index semantics", () => {
  const statements = [
    `ALTER TABLE "deals" DROP CONSTRAINT "deals_lead_id_fkey";`,
    `ALTER TABLE "deals" ADD CONSTRAINT "deals_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;`,
    `DROP INDEX "activity_lead_created_idx";`,
    `CREATE UNIQUE INDEX "activity_lead_created_idx" ON "activity_log" USING hash ("created_at");`,
  ];
  assert.deepEqual(filterCheckerArtifacts(statements), statements);
});