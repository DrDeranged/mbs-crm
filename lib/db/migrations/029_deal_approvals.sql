CREATE TABLE IF NOT EXISTS "deal_approvals" (
  "id" serial PRIMARY KEY,
  "deal_id" integer NOT NULL REFERENCES "deals"("id") ON DELETE CASCADE,
  "lender_id" integer NOT NULL REFERENCES "lenders"("id") ON DELETE RESTRICT,
  "contract_type" text NOT NULL,
  "advance" numeric(12,2) NOT NULL,
  "payment" numeric(12,2) NOT NULL,
  "term" integer NOT NULL,
  "down_payment" numeric(12,2) NOT NULL DEFAULT 0,
  "tier" text NOT NULL,
  "expires_on" date NOT NULL,
  "approval_document_id" integer REFERENCES "documents"("id") ON DELETE SET NULL,
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "deal_approvals_contract_type_check" CHECK ("contract_type" IN ('EFA', 'lease', 'loan')),
  CONSTRAINT "deal_approvals_advance_check" CHECK ("advance" > 0),
  CONSTRAINT "deal_approvals_payment_check" CHECK ("payment" > 0),
  CONSTRAINT "deal_approvals_down_payment_check" CHECK ("down_payment" >= 0),
  CONSTRAINT "deal_approvals_tier_check" CHECK (length(trim("tier")) > 0),
  CONSTRAINT "deal_approvals_term_check" CHECK ("term" > 0)
);
CREATE INDEX IF NOT EXISTS "deal_approvals_deal_created_idx"
  ON "deal_approvals" ("deal_id", "created_at" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "deal_approvals_lender_idx" ON "deal_approvals" ("lender_id");