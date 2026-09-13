ALTER TABLE "company_settings"
  ADD COLUMN IF NOT EXISTS "stale_threshold_days" integer NOT NULL DEFAULT 7;