ALTER TABLE communications
  ADD COLUMN IF NOT EXISTS partner_id integer REFERENCES lenders(id) ON DELETE CASCADE;

ALTER TABLE partner_contacts
  ADD COLUMN IF NOT EXISTS sms_opted_out boolean NOT NULL DEFAULT false;

ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS partner_texting_enabled boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS communications_partner_idx ON communications(partner_id);