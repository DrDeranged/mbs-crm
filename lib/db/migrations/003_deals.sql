CREATE TABLE IF NOT EXISTS "deals" (
  "id" serial PRIMARY KEY NOT NULL,
  "lead_id" integer REFERENCES "leads"("id") ON DELETE SET NULL,
  "deal_name" text NOT NULL,
  "stage" text DEFAULT 'waiting_on_app' NOT NULL
    CHECK ("stage" IN ('waiting_on_app', 'information_needed', 'submitted', 'approved', 'going_to_funding', 'in_funding', 'funded', 'declined', 'dead', 'hold_on')),
  "amount" integer,
  "approx_gm" integer,
  "actual_gm" integer,
  "assigned_to" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "funded_at" timestamp,
  "is_archived" boolean DEFAULT false NOT NULL
);
CREATE INDEX IF NOT EXISTS "deals_lead_idx" ON "deals" ("lead_id");
CREATE INDEX IF NOT EXISTS "deals_stage_idx" ON "deals" ("stage");
CREATE INDEX IF NOT EXISTS "deals_assigned_to_idx" ON "deals" ("assigned_to");
CREATE INDEX IF NOT EXISTS "deals_created_idx" ON "deals" ("created_at");
CREATE INDEX IF NOT EXISTS "deals_archived_idx" ON "deals" ("is_archived");
ALTER TABLE "activity_log" ADD COLUMN IF NOT EXISTS "deal_id" integer REFERENCES "deals"("id") ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS "activity_deal_idx" ON "activity_log" ("deal_id");