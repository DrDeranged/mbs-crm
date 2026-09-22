ALTER TABLE campaign_audience_previews
  ADD COLUMN IF NOT EXISTS recipients_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb;