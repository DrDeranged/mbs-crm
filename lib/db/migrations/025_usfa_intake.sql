-- USFA row receipts and encrypted application-prefill payloads.
-- The sheet is never written by this integration; external_id is its idempotency key.
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
  "lead_id" integer NOT NULL UNIQUE REFERENCES "leads"("id") ON DELETE CASCADE,
  "encrypted_payload" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "usfa_intake_prefill_lead_idx" ON "usfa_intake_prefill" ("lead_id");

ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "usfa_sheet_id" text;
ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "usfa_sheet_tab" text NOT NULL DEFAULT 'Sheet1';