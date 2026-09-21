ALTER TABLE lenders ADD COLUMN IF NOT EXISTS guideline_version integer NOT NULL DEFAULT 1;
ALTER TABLE lenders ADD COLUMN IF NOT EXISTS guideline_source text;
ALTER TABLE lenders ADD COLUMN IF NOT EXISTS guideline_effective_at timestamptz;
ALTER TABLE lenders ADD COLUMN IF NOT EXISTS equipment_restrictions text[] NOT NULL DEFAULT '{}';
ALTER TABLE lenders ADD COLUMN IF NOT EXISTS pricing jsonb;
ALTER TABLE lenders ADD COLUMN IF NOT EXISTS required_documents text[] NOT NULL DEFAULT '{}';
ALTER TABLE lenders ADD COLUMN IF NOT EXISTS turnaround_business_days_min integer;
ALTER TABLE lenders ADD COLUMN IF NOT EXISTS turnaround_business_days_max integer;
ALTER TABLE lenders ADD COLUMN IF NOT EXISTS compensation jsonb;

ALTER TABLE lenders DROP CONSTRAINT IF EXISTS lenders_guideline_version_check;
ALTER TABLE lenders ADD CONSTRAINT lenders_guideline_version_check CHECK (guideline_version > 0);
ALTER TABLE lenders DROP CONSTRAINT IF EXISTS lenders_turnaround_check;
ALTER TABLE lenders ADD CONSTRAINT lenders_turnaround_check CHECK (
  turnaround_business_days_min IS NULL OR turnaround_business_days_max IS NULL
  OR turnaround_business_days_min <= turnaround_business_days_max
);

CREATE TABLE IF NOT EXISTS underwriting_corrections (
  id serial PRIMARY KEY,
  lead_id integer NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  field text NOT NULL,
  corrected_value jsonb NOT NULL,
  reason text NOT NULL,
  evidence_document_id integer REFERENCES documents(id) ON DELETE SET NULL,
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT underwriting_corrections_field_check CHECK (field IN (
    'requestedAmount', 'creditScore', 'industry', 'businessState', 'timeInBusinessMonths',
    'monthlyRevenue', 'existingPositions', 'equipmentDescription', 'equipmentCategory',
    'equipmentYear', 'vendorName', 'transactionAmount', 'intendedUse'
  )),
  CONSTRAINT underwriting_corrections_reason_check CHECK (length(trim(reason)) > 0)
);
CREATE INDEX IF NOT EXISTS underwriting_corrections_lead_field_idx
  ON underwriting_corrections (lead_id, field, created_at DESC);