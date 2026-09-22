ALTER TABLE campaign_launches
  ADD COLUMN IF NOT EXISTS execution_lease_token text,
  ADD COLUMN IF NOT EXISTS execution_lease_expires_at timestamptz;
CREATE INDEX IF NOT EXISTS campaign_launches_execution_lease_idx
  ON campaign_launches(id, execution_lease_expires_at);