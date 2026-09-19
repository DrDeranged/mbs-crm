-- Migration: Create credit_pulls and credit_compliance_log tables
-- Must run BEFORE credit_compliance_log_append_only.sql

CREATE TABLE IF NOT EXISTS credit_pulls (
  id              serial PRIMARY KEY,
  lead_id         integer NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  pulled_by       integer NOT NULL REFERENCES users(id),
  pull_type       text NOT NULL CHECK (pull_type IN ('soft', 'hard')),
  consent_captured_at  timestamp,
  consent_ip      text,
  credit_score    integer,
  report_summary  jsonb,
  request_payload_encrypted   text,
  response_payload_encrypted  text,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'error')),
  error_message   text,
  created_at      timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credit_pulls_lead_idx ON credit_pulls(lead_id);

CREATE TABLE IF NOT EXISTS credit_compliance_log (
  id                  serial PRIMARY KEY,
  credit_pull_id      integer REFERENCES credit_pulls(id),
  lead_id             integer NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id             integer NOT NULL REFERENCES users(id),
  action              text NOT NULL,
  permissible_purpose text NOT NULL,
  details             jsonb,
  created_at          timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credit_compliance_log_lead_idx ON credit_compliance_log(lead_id);
CREATE INDEX IF NOT EXISTS credit_compliance_log_user_idx ON credit_compliance_log(user_id);
