ALTER TABLE collateral_templates
  ADD COLUMN IF NOT EXISTS campaign_category TEXT,
  ADD COLUMN IF NOT EXISTS vertical TEXT,
  ADD COLUMN IF NOT EXISTS audience TEXT,
  ADD COLUMN IF NOT EXISTS rep_user_id INTEGER,
  ADD COLUMN IF NOT EXISTS original_filename TEXT,
  ADD COLUMN IF NOT EXISTS asset_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS asset_content_type TEXT,
  ADD COLUMN IF NOT EXISTS asset_generation TEXT,
  ADD COLUMN IF NOT EXISTS asset_size INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'collateral_templates_rep_user_id_users_id_fk') THEN
    ALTER TABLE collateral_templates ADD CONSTRAINT collateral_templates_rep_user_id_users_id_fk
      FOREIGN KEY (rep_user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'collateral_templates_campaign_category_check') THEN
    ALTER TABLE collateral_templates ADD CONSTRAINT collateral_templates_campaign_category_check
      CHECK (campaign_category IS NULL OR campaign_category IN ('equipment_financing', 'working_capital'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'collateral_templates_vertical_check') THEN
    ALTER TABLE collateral_templates ADD CONSTRAINT collateral_templates_vertical_check
      CHECK (vertical IS NULL OR vertical IN ('yellow_iron', 'trucking', 'restaurants', 'amusement', 'general'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'collateral_templates_audience_check') THEN
    ALTER TABLE collateral_templates ADD CONSTRAINT collateral_templates_audience_check
      CHECK (audience IS NULL OR audience IN ('end_user', 'vendor'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS collateral_templates_flyer_filters_idx
  ON collateral_templates (campaign_category, vertical, audience, rep_user_id);