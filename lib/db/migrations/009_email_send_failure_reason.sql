ALTER TABLE "email_sends"
  ADD COLUMN IF NOT EXISTS "failure_reason" text;