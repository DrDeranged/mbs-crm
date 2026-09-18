ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS equipment_category text,
  ADD COLUMN IF NOT EXISTS is_homeowner boolean;

ALTER TABLE applications
  DROP CONSTRAINT IF EXISTS applications_equipment_category_check;

ALTER TABLE applications
  ADD CONSTRAINT applications_equipment_category_check
  CHECK (equipment_category IS NULL OR equipment_category IN ('vocational', 'otr_truck', 'trailer', 'construction', 'other'));