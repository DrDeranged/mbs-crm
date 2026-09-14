ALTER TABLE "company_settings"
  ADD COLUMN IF NOT EXISTS "email_sending_enabled" boolean NOT NULL DEFAULT false;

ALTER TABLE "company_settings"
  ADD COLUMN IF NOT EXISTS "bulk_email_per_minute" integer NOT NULL DEFAULT 60;

-- Do not allow an accidental zero/negative rate to disable validation or
-- create an unbounded send loop.
ALTER TABLE "company_settings"
  DROP CONSTRAINT IF EXISTS "company_settings_bulk_email_per_minute_check";
ALTER TABLE "company_settings"
  ADD CONSTRAINT "company_settings_bulk_email_per_minute_check"
  CHECK ("bulk_email_per_minute" BETWEEN 1 AND 1000);