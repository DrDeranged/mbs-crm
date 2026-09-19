ALTER TABLE lender_submissions
  ADD COLUMN IF NOT EXISTS via_broker_id integer REFERENCES lenders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS end_lender_id integer REFERENCES lenders(id) ON DELETE SET NULL;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS referred_by_partner_id integer REFERENCES lenders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS referral_split_pct numeric(5, 2);

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS referred_by_partner_id integer REFERENCES lenders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS referral_split_pct numeric(5, 2);

CREATE INDEX IF NOT EXISTS lender_submissions_via_broker_idx ON lender_submissions(via_broker_id);
CREATE INDEX IF NOT EXISTS lender_submissions_end_lender_idx ON lender_submissions(end_lender_id);