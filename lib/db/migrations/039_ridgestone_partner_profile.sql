ALTER TABLE lenders
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS website text;

UPDATE lenders
SET
  partner_type = 'broker_out',
  is_active = true,
  address = '18565 Jamboree Rd #275, Irvine, CA 92612',
  phone = '(877) 999-4589',
  website = 'ridgestonecap.com',
  program_types = ARRAY['equipment', 'working_capital'],
  notes = 'Super-broker — MBS places deals here when no direct lender fits.',
  updated_at = now()
WHERE name = 'Ridgestone Capital';

UPDATE partner_contacts
SET
  role = 'rep',
  name = 'Jes Orozco',
  email = 'jorozco@ridgestonecap.com',
  phone = NULL,
  is_primary = true,
  updated_at = now()
WHERE partner_id = (SELECT id FROM lenders WHERE name = 'Ridgestone Capital')
  AND email = 'jorozco@ridgestonecap.com';