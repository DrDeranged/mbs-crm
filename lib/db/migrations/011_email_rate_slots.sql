CREATE TABLE IF NOT EXISTS "email_rate_slots" (
  "id" serial PRIMARY KEY NOT NULL,
  "reserved_at" timestamp NOT NULL DEFAULT now(),
  "expires_at" timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS "email_rate_slots_expiry_idx"
  ON "email_rate_slots" ("expires_at");