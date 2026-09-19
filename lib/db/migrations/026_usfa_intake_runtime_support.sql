-- Runtime support for USFA polling, administration, document labels, and
-- secure application prefill invites. Migration 025 contains only the intake
-- source model and receipt/prefill primitives.
ALTER TABLE "tasks" ALTER COLUMN "user_id" DROP NOT NULL;

ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "usfa_sheet_id" text;
ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "usfa_sheet_tab" text NOT NULL DEFAULT 'Sheet1';
ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "usfa_consent_confirmed" boolean NOT NULL DEFAULT false;
ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "usfa_webhook_enabled" boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "usfa_application_email_log" (
  "id" serial PRIMARY KEY,
  "gmail_message_id" text NOT NULL UNIQUE,
  "lead_id" integer REFERENCES "leads"("id") ON DELETE SET NULL,
  "status" text NOT NULL CHECK ("status" IN ('attached', 'pending', 'processing', 'expired', 'error')),
  "received_at" timestamp,
  "attempted_at" timestamp NOT NULL DEFAULT now(),
  "expires_at" timestamp NOT NULL,
  "error" text,
  "metadata" jsonb
);
CREATE INDEX IF NOT EXISTS "usfa_application_email_status_idx"
  ON "usfa_application_email_log" ("status");
CREATE INDEX IF NOT EXISTS "usfa_application_email_expires_idx"
  ON "usfa_application_email_log" ("expires_at");

ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "label" text;

CREATE TABLE IF NOT EXISTS "usfa_prefill_invites" (
  "id" serial PRIMARY KEY,
  "token_hash" text NOT NULL UNIQUE,
  "lead_id" integer NOT NULL REFERENCES "leads"("id") ON DELETE CASCADE,
  "rep_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "rep_slug" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "revoked_at" timestamp,
  "used_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "usfa_prefill_invites_lead_idx" ON "usfa_prefill_invites" ("lead_id");
CREATE INDEX IF NOT EXISTS "usfa_prefill_invites_expiry_idx" ON "usfa_prefill_invites" ("expires_at");