-- USFA row receipts, encrypted application-prefill payloads, and lead source fields.
-- The existing production companies table is represented by the Drizzle model;
-- it is deliberately not created or altered here.
CREATE TABLE IF NOT EXISTS "usfa_intake_log" (
  "id" serial PRIMARY KEY,
  "external_id" text NOT NULL UNIQUE,
  "row_number" integer NOT NULL,
  "ingested_at" timestamp NOT NULL DEFAULT now(),
  "lead_id" integer REFERENCES "leads"("id") ON DELETE SET NULL,
  "status" text NOT NULL CHECK ("status" IN ('ok', 'dup', 'error')),
  "error" text,
  "metadata" jsonb
);
CREATE INDEX IF NOT EXISTS "usfa_intake_log_status_idx" ON "usfa_intake_log" ("status");
CREATE INDEX IF NOT EXISTS "usfa_intake_log_ingested_idx" ON "usfa_intake_log" ("ingested_at");

CREATE TABLE IF NOT EXISTS "usfa_intake_prefill" (
  "id" serial PRIMARY KEY,
  "lead_id" integer NOT NULL REFERENCES "leads"("id") ON DELETE CASCADE,
  "encrypted_payload" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "usfa_intake_prefill_lead_unique" UNIQUE ("lead_id")
);
CREATE INDEX IF NOT EXISTS "usfa_intake_prefill_lead_idx" ON "usfa_intake_prefill" ("lead_id");

ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "external_id" text;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "credit_score_band" text;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "monthly_revenue_band" text;
CREATE UNIQUE INDEX IF NOT EXISTS "leads_external_id_unique_idx"
  ON "leads" ("external_id")
  WHERE "external_id" IS NOT NULL;