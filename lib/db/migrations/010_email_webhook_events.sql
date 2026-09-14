CREATE TABLE IF NOT EXISTS "email_webhook_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "event_id" text NOT NULL,
  "event_type" text NOT NULL,
  "message_id" text,
  "received_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "email_webhook_events_event_id_uq"
  ON "email_webhook_events" ("event_id");
CREATE INDEX IF NOT EXISTS "email_webhook_events_message_idx"
  ON "email_webhook_events" ("message_id");

CREATE INDEX IF NOT EXISTS "leads_normalized_email_idx"
  ON "leads" (lower(trim("email")));