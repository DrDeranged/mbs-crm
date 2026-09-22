CREATE TABLE IF NOT EXISTS campaign_audience_previews (
  id serial PRIMARY KEY,
  preview_token text NOT NULL UNIQUE,
  campaign_id integer NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  campaign_version integer NOT NULL,
  requested_by integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  content_hash text NOT NULL,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campaign_audience_previews_campaign_idx
  ON campaign_audience_previews(campaign_id, campaign_version);

ALTER TABLE campaign_approvals ADD COLUMN IF NOT EXISTS content_hash text NOT NULL DEFAULT '';
ALTER TABLE campaign_approvals ADD COLUMN IF NOT EXISTS preview_id integer;
ALTER TABLE campaign_approvals ADD COLUMN IF NOT EXISTS claims_affirmed boolean NOT NULL DEFAULT false;
ALTER TABLE campaign_approvals ADD COLUMN IF NOT EXISTS snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_approvals_preview_id_fkey') THEN
    ALTER TABLE campaign_approvals ADD CONSTRAINT campaign_approvals_preview_id_fkey
      FOREIGN KEY (preview_id) REFERENCES campaign_audience_previews(id) ON DELETE RESTRICT;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_audience_previews_token_nonempty') THEN
    ALTER TABLE campaign_audience_previews
      ADD CONSTRAINT campaign_audience_previews_token_nonempty CHECK (length(preview_token) >= 10);
  END IF;
END $$;