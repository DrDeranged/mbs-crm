CREATE TABLE IF NOT EXISTS lender_guideline_versions (
  id serial PRIMARY KEY,
  lender_id integer NOT NULL REFERENCES lenders(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  source varchar(1000),
  effective_at timestamptz,
  snapshot jsonb NOT NULL,
  created_by integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS lender_guideline_versions_lender_version_unique
  ON lender_guideline_versions (lender_id, version);

CREATE INDEX IF NOT EXISTS lender_guideline_versions_lender_created_at_idx
  ON lender_guideline_versions (lender_id, created_at);

INSERT INTO lender_guideline_versions (
  lender_id, version, source, effective_at, snapshot
)
SELECT
  id,
  guideline_version,
  guideline_source,
  guideline_effective_at,
  jsonb_build_object(
    'programTypes', program_types,
    'minAmount', min_amount,
    'maxAmount', max_amount,
    'minCreditScore', min_credit_score,
    'acceptedIndustries', accepted_industries,
    'restrictedIndustries', restricted_industries,
    'prohibitedIndustries', prohibited_industries,
    'minMonthlyRevenue', min_monthly_revenue,
    'minTimeInBusinessMonths', min_time_in_business_months,
    'acceptedStates', accepted_states,
    'maxExistingPositions', max_existing_positions,
    'equipmentRestrictions', equipment_restrictions,
    'pricing', pricing,
    'requiredDocuments', required_documents,
    'turnaroundBusinessDaysMin', turnaround_business_days_min,
    'turnaroundBusinessDaysMax', turnaround_business_days_max,
    'compensation', compensation
  )
FROM lenders
ON CONFLICT (lender_id, version) DO NOTHING;