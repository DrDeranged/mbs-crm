-- Client-specified routing controls and explicit marketing-resource ownership.
-- Existing creator fields remain intact for audit compatibility; owner_id is the
-- authorization source for all newly-created sequences and templates.

ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS routing_mode text NOT NULL DEFAULT 'manual'
    CHECK (routing_mode IN ('manual', 'round_robin')),
  ADD COLUMN IF NOT EXISTS routing_stale_days integer NOT NULL DEFAULT 7
    CHECK (routing_stale_days BETWEEN 1 AND 365),
  ADD COLUMN IF NOT EXISTS routing_auto_reassign_stale boolean NOT NULL DEFAULT false;

ALTER TABLE drip_sequences
  ADD COLUMN IF NOT EXISTS owner_id integer REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE email_templates
  ADD COLUMN IF NOT EXISTS owner_id integer REFERENCES users(id) ON DELETE SET NULL;

-- Preserve ownership of existing rep-created resources. Legacy system-owned
-- records stay unowned; representatives may not modify them.
UPDATE drip_sequences SET owner_id = created_by WHERE owner_id IS NULL AND created_by IS NOT NULL;
UPDATE email_templates SET owner_id = created_by WHERE owner_id IS NULL AND created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS drip_sequences_owner_id_idx ON drip_sequences(owner_id);
CREATE INDEX IF NOT EXISTS email_templates_owner_id_idx ON email_templates(owner_id);