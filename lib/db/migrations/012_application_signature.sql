ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "signature_method" text;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "signature_signed_at" timestamp;