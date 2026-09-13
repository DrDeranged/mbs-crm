ALTER TABLE "company_settings"
  ADD COLUMN IF NOT EXISTS "include_admins_in_round_robin" boolean NOT NULL DEFAULT false;

ALTER TABLE "company_settings"
  ADD COLUMN IF NOT EXISTS "round_robin_cursor" integer NOT NULL DEFAULT 0;