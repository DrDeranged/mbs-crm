-- Durable marketing delivery classification and the shared daily allowance.
-- This is additive: earlier migration files remain immutable.
ALTER TABLE "company_settings"
  ADD COLUMN IF NOT EXISTS "bulk_email_per_day" integer NOT NULL DEFAULT 75;
ALTER TABLE "company_settings"
  DROP CONSTRAINT IF EXISTS "company_settings_bulk_email_per_day_check";
ALTER TABLE "company_settings"
  ADD CONSTRAINT "company_settings_bulk_email_per_day_check"
  CHECK ("bulk_email_per_day" BETWEEN 1 AND 100000);

ALTER TABLE "email_sends"
  ADD COLUMN IF NOT EXISTS "delivery_kind" text NOT NULL DEFAULT 'direct';
ALTER TABLE "email_sends"
  DROP CONSTRAINT IF EXISTS "email_sends_delivery_kind_check";
ALTER TABLE "email_sends"
  ADD CONSTRAINT "email_sends_delivery_kind_check"
  CHECK ("delivery_kind" IN ('direct', 'bulk', 'drip', 'test'));
CREATE INDEX IF NOT EXISTS "email_sends_daily_marketing_idx"
  ON "email_sends" ("delivery_kind", "created_at");