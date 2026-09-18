ALTER TABLE lenders
  ADD COLUMN IF NOT EXISTS partner_type text NOT NULL DEFAULT 'direct_lender',
  ADD COLUMN IF NOT EXISTS referral_split_pct numeric(5, 2),
  ADD COLUMN IF NOT EXISTS submission_method text NOT NULL DEFAULT 'email',
  ADD COLUMN IF NOT EXISTS portal_url text;

DO $$
BEGIN
  ALTER TABLE lenders
    ADD CONSTRAINT lenders_partner_type_check
    CHECK (partner_type IN ('direct_lender', 'broker_out', 'broker_in'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE lenders
    ADD CONSTRAINT lenders_submission_method_check
    CHECK (submission_method IN ('email', 'portal', 'both'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE lenders
    ADD CONSTRAINT lenders_referral_split_check
    CHECK (
      (partner_type = 'broker_in' AND referral_split_pct BETWEEN 0 AND 100)
      OR (partner_type <> 'broker_in' AND referral_split_pct IS NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS partner_contacts (
  id serial PRIMARY KEY,
  partner_id integer NOT NULL REFERENCES lenders(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'rep'
    CHECK (role IN ('rep', 'submissions', 'credit', 'docs', 'funding', 'other')),
  name text NOT NULL,
  email text,
  phone text,
  is_primary boolean NOT NULL DEFAULT false,
  notes text,
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS partner_contacts_partner_idx ON partner_contacts(partner_id);
CREATE INDEX IF NOT EXISTS partner_contacts_primary_idx ON partner_contacts(partner_id, is_primary);

INSERT INTO partner_contacts (partner_id, role, name, email, phone, is_primary)
SELECT id, 'rep', COALESCE(contact_name, contact_email), contact_email, NULL, true
FROM lenders
WHERE (contact_name IS NOT NULL OR contact_email IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM partner_contacts existing
    WHERE existing.partner_id = lenders.id AND existing.role = 'rep'
  );

INSERT INTO lenders (name, partner_type, is_active, submission_method)
SELECT 'Ridgestone Capital', 'broker_out', true, 'email'
WHERE NOT EXISTS (SELECT 1 FROM lenders WHERE name = 'Ridgestone Capital');

INSERT INTO partner_contacts (partner_id, role, name, email, phone, is_primary)
SELECT id, 'rep', 'Jes Orozco', 'jorozco@ridgestonecap.com', NULL, true
FROM lenders
WHERE name = 'Ridgestone Capital'
  AND NOT EXISTS (
    SELECT 1 FROM partner_contacts
    WHERE partner_id = lenders.id AND email = 'jorozco@ridgestonecap.com'
  );