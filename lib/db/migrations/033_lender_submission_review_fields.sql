-- Section F: shared lender submission review metadata.
ALTER TABLE lender_submissions
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'crm',
  ADD COLUMN IF NOT EXISTS decision_date timestamp,
  ADD COLUMN IF NOT EXISTS approval_attachment_key text;
ALTER TABLE lender_submissions DROP CONSTRAINT IF EXISTS lender_submissions_status_check;
ALTER TABLE lender_submissions ADD CONSTRAINT lender_submissions_status_check
  CHECK (status IN ('submitted', 'approved', 'declined', 'funded', 'withdrawn'));

ALTER TABLE lender_submissions
  DROP CONSTRAINT IF EXISTS lender_submissions_source_check;
ALTER TABLE lender_submissions
  ADD CONSTRAINT lender_submissions_source_check CHECK (source IN ('crm', 'manual'));
CREATE INDEX IF NOT EXISTS lender_submissions_source_idx ON lender_submissions (source);