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