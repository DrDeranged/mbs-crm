ALTER TABLE company_settings
  ALTER COLUMN bulk_email_per_day SET DEFAULT 60;

-- Preserve non-default administrator choices; change only the old default.
UPDATE company_settings
SET bulk_email_per_day = 60
WHERE bulk_email_per_day = 75;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS reply_to_email TEXT NOT NULL DEFAULT 'nate@my-business-solutions.com';

ALTER TABLE campaign_recipients
  ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ;