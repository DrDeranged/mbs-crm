-- Section C: lender submission history and delivery metadata.
-- This migration is deliberately additive/rename-based so existing history is
-- retained.  No uniqueness constraint is used: administrators may override
-- the rolling 24-hour application rate limit.
CREATE TABLE IF NOT EXISTS lender_submissions (
  id serial PRIMARY KEY,
  lead_id integer NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  lender_id integer NOT NULL REFERENCES lenders(id) ON DELETE CASCADE,
  submitted_by integer REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'submitted',
  response_notes text,
  submitted_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT lender_submissions_status_check
    CHECK (status IN ('submitted', 'pending', 'approved', 'declined', 'withdrawn'))
);

ALTER TABLE lender_submissions
  ADD COLUMN IF NOT EXISTS deal_id integer,
  ADD COLUMN IF NOT EXISTS message_id text;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lender_submissions' AND column_name = 'submitted_by')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lender_submissions' AND column_name = 'sent_by') THEN
    ALTER TABLE lender_submissions RENAME COLUMN submitted_by TO sent_by;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lender_submissions' AND column_name = 'submitted_at')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lender_submissions' AND column_name = 'sent_at') THEN
    ALTER TABLE lender_submissions RENAME COLUMN submitted_at TO sent_at;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lender_submissions' AND column_name = 'response_notes')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lender_submissions' AND column_name = 'notes') THEN
    ALTER TABLE lender_submissions RENAME COLUMN response_notes TO notes;
  END IF;
END $$;

UPDATE lender_submissions
SET status = 'submitted'
WHERE status NOT IN ('submitted', 'approved', 'declined', 'funded');

ALTER TABLE lender_submissions
  ADD CONSTRAINT lender_submissions_deal_fk
  FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE SET NULL;

ALTER TABLE lender_submissions
  DROP CONSTRAINT IF EXISTS lender_submissions_status_check;
ALTER TABLE lender_submissions
  ADD CONSTRAINT lender_submissions_status_check
  CHECK (status IN ('submitted', 'approved', 'declined', 'funded'));

CREATE INDEX IF NOT EXISTS lender_submissions_deal_idx ON lender_submissions (deal_id);
CREATE INDEX IF NOT EXISTS lender_submissions_sent_at_idx ON lender_submissions (sent_at);
CREATE INDEX IF NOT EXISTS lender_submissions_lead_idx ON lender_submissions (lead_id);
CREATE INDEX IF NOT EXISTS lender_submissions_lender_idx ON lender_submissions (lender_id);

INSERT INTO email_templates (
  name,
  subject,
  body_html,
  program_type,
  sender_mode,
  created_by,
  is_active
)
SELECT
  'Lender Submission',
  'Lender submission for {{lead_company}}',
  '{{brand_email_header}}<p>Hello {{lender_name}},</p>
<p>Please review the attached signed financing application package for <strong>{{lead_company}}</strong>.</p>
<p><strong>Requested amount:</strong> {{requested_amount}}<br>
<strong>Program:</strong> {{application_type}}<br>
<strong>Applicant:</strong> {{lead_first_name}} {{lead_last_name}}</p>
<p>Please let {{rep_name}} know if you need anything else to complete your review.</p>
<p>Regards,<br>{{rep_name}}<br>{{rep_email}}<br>My Business Solutions</p>',
  NULL,
  'default',
  NULL,
  true
WHERE NOT EXISTS (
  SELECT 1
  FROM email_templates
  WHERE name = 'Lender Submission'
);