-- Store an immutable reference and integrity metadata for the exact PDF sent.
ALTER TABLE lender_submissions
  ADD COLUMN IF NOT EXISTS package_config_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS exact_package_key text,
  ADD COLUMN IF NOT EXISTS exact_package_sha256 text,
  ADD COLUMN IF NOT EXISTS exact_package_bytes integer;

-- Delivery state is deliberately separate from lender_submissions.status:
-- a provider call can succeed even when the following application transaction
-- fails. Keep the immutable packet and receipt until that transaction recovers.
CREATE TABLE IF NOT EXISTS lender_submission_deliveries (
  id serial PRIMARY KEY,
  lead_id integer NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  lender_id integer NOT NULL REFERENCES lenders(id) ON DELETE CASCADE,
  sent_by integer REFERENCES users(id) ON DELETE SET NULL,
  package_config_snapshot jsonb,
  exact_package_key text NOT NULL,
  exact_package_sha256 text NOT NULL,
  exact_package_bytes integer NOT NULL,
  state text NOT NULL CHECK (state IN ('pending', 'sent', 'submitted', 'failed', 'uncertain')),
  message_id text,
  failure_message text,
  window_started_at timestamp NOT NULL DEFAULT now(),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lender_submission_deliveries_lead_lender_idx
  ON lender_submission_deliveries(lead_id, lender_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS lender_submission_deliveries_active_idx
  ON lender_submission_deliveries(lead_id, lender_id)
  WHERE state IN ('pending', 'sent', 'uncertain');

ALTER TABLE pii_access_log ADD COLUMN IF NOT EXISTS metadata jsonb;