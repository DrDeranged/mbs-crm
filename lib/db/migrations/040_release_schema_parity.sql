ALTER TABLE communications
  ADD COLUMN IF NOT EXISTS call_notes text,
  ADD COLUMN IF NOT EXISTS call_outcome text;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS lead_score integer,
  ADD COLUMN IF NOT EXISTS lead_score_breakdown jsonb,
  ADD COLUMN IF NOT EXISTS ai_summary jsonb,
  ADD COLUMN IF NOT EXISTS ai_summary_generated_at timestamp,
  ADD COLUMN IF NOT EXISTS funded_at timestamp,
  ADD COLUMN IF NOT EXISTS funded_amount integer,
  ADD COLUMN IF NOT EXISTS estimated_term_months integer,
  ADD COLUMN IF NOT EXISTS renewal_flagged_at timestamp,
  ADD COLUMN IF NOT EXISTS tracking_token text;

ALTER TABLE drip_sequences
  ADD COLUMN IF NOT EXISTS sender_mode text NOT NULL DEFAULT 'template';

CREATE UNIQUE INDEX IF NOT EXISTS idempotency_keys_key_endpoint_unique
  ON idempotency_keys(key, endpoint);
CREATE INDEX IF NOT EXISTS activity_lead_created_idx
  ON activity_log(lead_id, created_at);
CREATE INDEX IF NOT EXISTS pii_access_log_user_idx
  ON pii_access_log(user_id);
CREATE INDEX IF NOT EXISTS pii_access_log_lead_idx
  ON pii_access_log(lead_id);
CREATE INDEX IF NOT EXISTS pii_access_log_created_idx
  ON pii_access_log(created_at);
CREATE INDEX IF NOT EXISTS leads_renewal_flagged_idx
  ON leads(renewal_flagged_at);
CREATE INDEX IF NOT EXISTS workflow_rules_trigger_status_idx
  ON workflow_rules(trigger_status);
CREATE INDEX IF NOT EXISTS workflow_rules_is_active_idx
  ON workflow_rules(is_active);
CREATE INDEX IF NOT EXISTS notifications_user_idx
  ON notifications(user_id);
CREATE INDEX IF NOT EXISTS notifications_user_read_idx
  ON notifications(user_id, is_read);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leads_tracking_token_unique'
  ) THEN
    ALTER TABLE leads
      ADD CONSTRAINT leads_tracking_token_unique UNIQUE (tracking_token);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pii_access_log_user_id_users_id_fk'
  ) THEN
    ALTER TABLE pii_access_log
      ADD CONSTRAINT pii_access_log_user_id_users_id_fk
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pii_access_log_lead_id_leads_id_fk'
  ) THEN
    ALTER TABLE pii_access_log
      ADD CONSTRAINT pii_access_log_lead_id_leads_id_fk
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;
  END IF;
END $$;