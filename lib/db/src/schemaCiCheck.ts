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
export const SCHEMA_PARITY_TABLE_FILTER = ["*"] as const;

const equivalentDefaultStatements = new Set([
  `ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'pending';`,
  `ALTER TABLE "lenders" ALTER COLUMN "program_types" SET DEFAULT '{}';`,
  `ALTER TABLE "lenders" ALTER COLUMN "accepted_industries" SET DEFAULT '{}';`,
  `ALTER TABLE "lenders" ALTER COLUMN "accepted_states" SET DEFAULT '{}';`,
  `ALTER TABLE "lenders" ALTER COLUMN "restricted_industries" SET DEFAULT '{}';`,
  `ALTER TABLE "lenders" ALTER COLUMN "prohibited_industries" SET DEFAULT '{}';`,
  `ALTER TABLE "lenders" ALTER COLUMN "equipment_restrictions" SET DEFAULT '{}';`,
  `ALTER TABLE "lenders" ALTER COLUMN "required_documents" SET DEFAULT '{}';`,
  `ALTER TABLE "deal_approvals" ALTER COLUMN "down_payment" SET DEFAULT 0;`,
]);

const equivalentConstraintPairs = [
  [
    `ALTER TABLE "deals" DROP CONSTRAINT "deals_lead_id_fkey";`,
    `ALTER TABLE "deals" ADD CONSTRAINT "deals_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;`,
  ],
  [
    `ALTER TABLE "deals" DROP CONSTRAINT "deals_assigned_to_fkey";`,
    `ALTER TABLE "deals" ADD CONSTRAINT "deals_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;`,
  ],
  [
    `ALTER TABLE "leads" DROP CONSTRAINT "leads_referred_by_partner_id_fkey";`,
    `ALTER TABLE "leads" ADD CONSTRAINT "leads_referred_by_partner_id_lenders_id_fk" FOREIGN KEY ("referred_by_partner_id") REFERENCES "public"."lenders"("id") ON DELETE set null ON UPDATE no action;`,
  ],
  [
    `ALTER TABLE "deals" DROP CONSTRAINT "deals_referred_by_partner_id_fkey";`,
    `ALTER TABLE "deals" ADD CONSTRAINT "deals_referred_by_partner_id_lenders_id_fk" FOREIGN KEY ("referred_by_partner_id") REFERENCES "public"."lenders"("id") ON DELETE set null ON UPDATE no action;`,
  ],
  [`ALTER TABLE "retired_rep_slugs" DROP CONSTRAINT "retired_rep_slugs_slug_key";`, `ALTER TABLE "retired_rep_slugs" ADD CONSTRAINT "retired_rep_slugs_slug_unique" UNIQUE("slug");`],
  [`ALTER TABLE "usfa_intake_log" DROP CONSTRAINT "usfa_intake_log_external_id_key";`, `ALTER TABLE "usfa_intake_log" ADD CONSTRAINT "usfa_intake_log_external_id_unique" UNIQUE("external_id");`],
  [`ALTER TABLE "usfa_application_email_log" DROP CONSTRAINT "usfa_application_email_log_gmail_message_id_key";`, `ALTER TABLE "usfa_application_email_log" ADD CONSTRAINT "usfa_application_email_log_gmail_message_id_unique" UNIQUE("gmail_message_id");`],
  [`ALTER TABLE "usfa_prefill_invites" DROP CONSTRAINT "usfa_prefill_invites_token_hash_key";`, `ALTER TABLE "usfa_prefill_invites" ADD CONSTRAINT "usfa_prefill_invites_token_hash_unique" UNIQUE("token_hash");`],
  [`ALTER TABLE "user_identities" DROP CONSTRAINT "user_identities_clerk_id_key";`, `ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_clerk_id_unique" UNIQUE("clerk_id");`],
  [`ALTER TABLE "activity_log" DROP CONSTRAINT "activity_log_deal_id_fkey";`, `ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;`],
  [`ALTER TABLE "users" DROP CONSTRAINT "users_merged_into_user_id_fkey";`, `ALTER TABLE "users" ADD CONSTRAINT "users_merged_into_user_id_users_id_fk" FOREIGN KEY ("merged_into_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;`],
  [`ALTER TABLE "communications" DROP CONSTRAINT "communications_partner_id_fkey";`, `ALTER TABLE "communications" ADD CONSTRAINT "communications_partner_id_lenders_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."lenders"("id") ON DELETE cascade ON UPDATE no action;`],
  [`ALTER TABLE "email_templates" DROP CONSTRAINT "email_templates_owner_id_fkey";`, `ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;`],
  [`ALTER TABLE "drip_sequences" DROP CONSTRAINT "drip_sequences_owner_id_fkey";`, `ALTER TABLE "drip_sequences" ADD CONSTRAINT "drip_sequences_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;`],
  [`ALTER TABLE "retired_rep_slugs" DROP CONSTRAINT "retired_rep_slugs_user_id_fkey";`, `ALTER TABLE "retired_rep_slugs" ADD CONSTRAINT "retired_rep_slugs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;`],
  [`ALTER TABLE "usfa_intake_log" DROP CONSTRAINT "usfa_intake_log_lead_id_fkey";`, `ALTER TABLE "usfa_intake_log" ADD CONSTRAINT "usfa_intake_log_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;`],
  [`ALTER TABLE "usfa_intake_prefill" DROP CONSTRAINT "usfa_intake_prefill_lead_id_fkey";`, `ALTER TABLE "usfa_intake_prefill" ADD CONSTRAINT "usfa_intake_prefill_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;`],
  [`ALTER TABLE "lender_submission_deliveries" DROP CONSTRAINT "lender_submission_deliveries_lead_id_fkey";`, `ALTER TABLE "lender_submission_deliveries" ADD CONSTRAINT "lender_submission_deliveries_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;`],
  [`ALTER TABLE "lender_submission_deliveries" DROP CONSTRAINT "lender_submission_deliveries_lender_id_fkey";`, `ALTER TABLE "lender_submission_deliveries" ADD CONSTRAINT "lender_submission_deliveries_lender_id_lenders_id_fk" FOREIGN KEY ("lender_id") REFERENCES "public"."lenders"("id") ON DELETE cascade ON UPDATE no action;`],
  [`ALTER TABLE "lender_submission_deliveries" DROP CONSTRAINT "lender_submission_deliveries_sent_by_fkey";`, `ALTER TABLE "lender_submission_deliveries" ADD CONSTRAINT "lender_submission_deliveries_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;`],
  [`ALTER TABLE "usfa_application_email_log" DROP CONSTRAINT "usfa_application_email_log_lead_id_fkey";`, `ALTER TABLE "usfa_application_email_log" ADD CONSTRAINT "usfa_application_email_log_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;`],
  [`ALTER TABLE "usfa_prefill_invites" DROP CONSTRAINT "usfa_prefill_invites_lead_id_fkey";`, `ALTER TABLE "usfa_prefill_invites" ADD CONSTRAINT "usfa_prefill_invites_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;`],
  [`ALTER TABLE "usfa_prefill_invites" DROP CONSTRAINT "usfa_prefill_invites_rep_user_id_fkey";`, `ALTER TABLE "usfa_prefill_invites" ADD CONSTRAINT "usfa_prefill_invites_rep_user_id_users_id_fk" FOREIGN KEY ("rep_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;`],
  [`ALTER TABLE "deal_approvals" DROP CONSTRAINT "deal_approvals_approval_document_id_fkey";`, `ALTER TABLE "deal_approvals" ADD CONSTRAINT "deal_approvals_approval_document_id_documents_id_fk" FOREIGN KEY ("approval_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;`],
  [`ALTER TABLE "deal_approvals" DROP CONSTRAINT "deal_approvals_created_by_fkey";`, `ALTER TABLE "deal_approvals" ADD CONSTRAINT "deal_approvals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;`],
  [`ALTER TABLE "deal_approvals" DROP CONSTRAINT "deal_approvals_deal_id_fkey";`, `ALTER TABLE "deal_approvals" ADD CONSTRAINT "deal_approvals_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;`],
  [`ALTER TABLE "deal_approvals" DROP CONSTRAINT "deal_approvals_lender_id_fkey";`, `ALTER TABLE "deal_approvals" ADD CONSTRAINT "deal_approvals_lender_id_lenders_id_fk" FOREIGN KEY ("lender_id") REFERENCES "public"."lenders"("id") ON DELETE restrict ON UPDATE no action;`],
  [`ALTER TABLE "collateral_templates" DROP CONSTRAINT "collateral_templates_created_by_fkey";`, `ALTER TABLE "collateral_templates" ADD CONSTRAINT "collateral_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;`],
  [`ALTER TABLE "collateral_renders" DROP CONSTRAINT "collateral_renders_lead_id_fkey";`, `ALTER TABLE "collateral_renders" ADD CONSTRAINT "collateral_renders_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;`],
  [`ALTER TABLE "collateral_renders" DROP CONSTRAINT "collateral_renders_template_id_fkey";`, `ALTER TABLE "collateral_renders" ADD CONSTRAINT "collateral_renders_template_id_collateral_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."collateral_templates"("id") ON DELETE cascade ON UPDATE no action;`],
  [`ALTER TABLE "collateral_renders" DROP CONSTRAINT "collateral_renders_user_id_fkey";`, `ALTER TABLE "collateral_renders" ADD CONSTRAINT "collateral_renders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;`],
  [`ALTER TABLE "user_identities" DROP CONSTRAINT "user_identities_user_id_fkey";`, `ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;`],
  [`ALTER TABLE "lender_submissions" DROP CONSTRAINT "lender_submissions_deal_fk";`, `ALTER TABLE "lender_submissions" ADD CONSTRAINT "lender_submissions_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;`],
  [`ALTER TABLE "lender_submissions" DROP CONSTRAINT "lender_submissions_end_lender_id_fkey";`, `ALTER TABLE "lender_submissions" ADD CONSTRAINT "lender_submissions_end_lender_id_lenders_id_fk" FOREIGN KEY ("end_lender_id") REFERENCES "public"."lenders"("id") ON DELETE set null ON UPDATE no action;`],
  [`ALTER TABLE "lender_submissions" DROP CONSTRAINT "lender_submissions_submitted_by_users_id_fk";`, `ALTER TABLE "lender_submissions" ADD CONSTRAINT "lender_submissions_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;`],
  [`ALTER TABLE "lender_submissions" DROP CONSTRAINT "lender_submissions_via_broker_id_fkey";`, `ALTER TABLE "lender_submissions" ADD CONSTRAINT "lender_submissions_via_broker_id_lenders_id_fk" FOREIGN KEY ("via_broker_id") REFERENCES "public"."lenders"("id") ON DELETE set null ON UPDATE no action;`],
  [`ALTER TABLE "admin_audit_log" DROP CONSTRAINT "admin_audit_log_actor_user_id_fkey";`, `ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;`],
  [`ALTER TABLE "partner_contacts" DROP CONSTRAINT "partner_contacts_created_by_fkey";`, `ALTER TABLE "partner_contacts" ADD CONSTRAINT "partner_contacts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;`],
  [`ALTER TABLE "partner_contacts" DROP CONSTRAINT "partner_contacts_partner_id_fkey";`, `ALTER TABLE "partner_contacts" ADD CONSTRAINT "partner_contacts_partner_id_lenders_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."lenders"("id") ON DELETE cascade ON UPDATE no action;`],
  [`ALTER TABLE "lender_guideline_versions" DROP CONSTRAINT "lender_guideline_versions_lender_id_fkey";`, `ALTER TABLE "lender_guideline_versions" ADD CONSTRAINT "lender_guideline_versions_lender_id_lenders_id_fk" FOREIGN KEY ("lender_id") REFERENCES "public"."lenders"("id") ON DELETE cascade ON UPDATE no action;`],
  [`ALTER TABLE "underwriting_corrections" DROP CONSTRAINT "underwriting_corrections_created_by_fkey";`, `ALTER TABLE "underwriting_corrections" ADD CONSTRAINT "underwriting_corrections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;`],
  [`ALTER TABLE "underwriting_corrections" DROP CONSTRAINT "underwriting_corrections_evidence_document_id_fkey";`, `ALTER TABLE "underwriting_corrections" ADD CONSTRAINT "underwriting_corrections_evidence_document_id_documents_id_fk" FOREIGN KEY ("evidence_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;`],
  [`ALTER TABLE "underwriting_corrections" DROP CONSTRAINT "underwriting_corrections_lead_id_fkey";`, `ALTER TABLE "underwriting_corrections" ADD CONSTRAINT "underwriting_corrections_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;`],
  [
    `ALTER TABLE "campaign_audience_presets" DROP CONSTRAINT "campaign_audience_presets_owner_id_name_key";`,
    `ALTER TABLE "campaign_audience_presets" ADD CONSTRAINT "campaign_audience_presets_owner_id_name_key" UNIQUE("owner_id","name");`,
  ],
] as const;

const equivalentIndexPairs = [
  [
    `DROP INDEX "lender_submission_deliveries_lead_lender_idx";`,
    `CREATE INDEX "lender_submission_deliveries_lead_lender_idx" ON "lender_submission_deliveries" USING btree ("lead_id","lender_id","created_at" DESC NULLS LAST);`,
  ],
  [
    `DROP INDEX "deal_approvals_deal_created_idx";`,
    `CREATE INDEX "deal_approvals_deal_created_idx" ON "deal_approvals" USING btree ("deal_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);`,
  ],
  [
    `DROP INDEX "underwriting_corrections_lead_field_idx";`,
    `CREATE INDEX "underwriting_corrections_lead_field_idx" ON "underwriting_corrections" USING btree ("lead_id","field","created_at" DESC NULLS LAST);`,
  ],
] as const;

export function filterCheckerArtifacts(statements: string[]): string[] {
  const normalized = statements.map((statement) => statement.trim());
  const equivalentConstraintStatements = new Set<string>();
  for (const [dropped, added] of equivalentConstraintPairs) {
    if (normalized.includes(dropped) && normalized.includes(added)) {
      equivalentConstraintStatements.add(dropped);
      equivalentConstraintStatements.add(added);
    }
  }
  for (const [dropped, added] of equivalentIndexPairs) {
    if (normalized.includes(dropped) && normalized.includes(added)) {
      equivalentConstraintStatements.add(dropped);
      equivalentConstraintStatements.add(added);
    }
  }

  return normalized.filter((statement) => {
    if (equivalentDefaultStatements.has(statement)) return false;
    if (
      statement
      === `ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_bulk_email_per_minute_check" CHECK ("company_settings"."bulk_email_per_minute" BETWEEN 1 AND 1000);`
    ) {
      return false;
    }

    if (equivalentConstraintStatements.has(statement)) return false;
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
  const developmentHost = process.env.DATABASE_URL
    ? new URL(process.env.DATABASE_URL).hostname
    : null;
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("Schema parity checks require PostgreSQL");
  }
  if (
    (!localHosts.has(url.hostname) && url.hostname !== developmentHost)
    || !/^schema_ci(?:_|$)/.test(databaseName)
  ) {
    throw new Error(
      "Refusing schema parity check: use a fresh database named schema_ci or schema_ci_* on the development PostgreSQL host",
    );
  }
  return url;
}

export function assertSafeExistingSchemaCheckUrl(value: string | undefined): URL {
  if (!value) throw new Error("SCHEMA_CHECK_DATABASE_URL is required");
  const url = new URL(value);
  const databaseName = url.pathname.replace(/^\//, "");
  const developmentHost = process.env.DATABASE_URL
    ? new URL(process.env.DATABASE_URL).hostname
    : null;
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol)
    || (!localHosts.has(url.hostname) && url.hostname !== developmentHost)
    || !/^migration_rehearsal_[a-z0-9_]+$/.test(databaseName)
  ) {
    throw new Error(
      "Refusing existing-schema parity check: use a migration_rehearsal_* database on the development PostgreSQL host",
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

    await assertDatabaseMatchesDrizzle(database);
  } finally {
    await pool.end();
  }
}

async function assertDatabaseMatchesDrizzle(database: any): Promise<void> {
  const schema = await loadCompleteSchemaSet();
  const diff = await pushSchema(schema, database, ["public"], [...SCHEMA_PARITY_TABLE_FILTER]);
  const actionableDiff = filterCheckerArtifacts(diff.statementsToExecute);
  if (actionableDiff.length > 0) {
    throw new Error([
      "Drizzle schema differs from the migrated database:",
      ...actionableDiff,
    ].join("\n\n"));
  }
}

export async function checkExistingMigrationParity(
  connectionString = process.env.SCHEMA_CHECK_DATABASE_URL,
): Promise<void> {
  const safeUrl = assertSafeExistingSchemaCheckUrl(connectionString);
  const pool = new Pool({ connectionString: safeUrl.toString(), max: 1 });
  try {
    await assertDatabaseMatchesDrizzle(drizzle(pool));
  } finally {
    await pool.end();
  }
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  if (process.env.SCHEMA_CHECK_EXISTING === "true") {
    await checkExistingMigrationParity();
  } else {
    await checkRunnerMigrationParity();
  }
  console.log("Schema parity OK: SQL runner and complete Drizzle schema set match");
}