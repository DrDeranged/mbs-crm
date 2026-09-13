ALTER TABLE deals ADD COLUMN IF NOT EXISTS intended_rep_slug text;
CREATE INDEX IF NOT EXISTS deals_intended_rep_slug_idx ON deals (intended_rep_slug);