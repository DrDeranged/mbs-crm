INSERT INTO collateral_templates (
  name,
  category,
  kind,
  source_key,
  status
)
SELECT
  'Finance Application',
  'application',
  'html',
  'mbs://finance-application',
  'published'
WHERE NOT EXISTS (
  SELECT 1
  FROM collateral_templates
  WHERE source_key = 'mbs://finance-application'
);