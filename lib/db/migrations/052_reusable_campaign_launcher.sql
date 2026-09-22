CREATE TABLE IF NOT EXISTS campaigns (
  id serial PRIMARY KEY,
  name text NOT NULL,
  description text,
  channel text NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'sms', 'email_sms')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'scheduled', 'running', 'paused', 'completed', 'cancelled', 'failed')),
  email_template_id integer REFERENCES email_templates(id) ON DELETE SET NULL,
  sms_body text,
  audience_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  scheduled_at timestamptz,
  launched_at timestamptz,
  completed_at timestamptz,
  owner_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_by integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campaigns_status_idx ON campaigns(status);
CREATE INDEX IF NOT EXISTS campaigns_owner_idx ON campaigns(owner_id);

CREATE TABLE IF NOT EXISTS campaign_audience_presets (
  id serial PRIMARY KEY,
  name text NOT NULL,
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  owner_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id, name)
);

CREATE TABLE IF NOT EXISTS campaign_approvals (
  id serial PRIMARY KEY,
  campaign_id integer NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  approval_type text NOT NULL,
  content_version integer NOT NULL,
  approved_by integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_at timestamptz NOT NULL DEFAULT now(),
  invalidated_at timestamptz,
  invalidated_reason text
);
CREATE INDEX IF NOT EXISTS campaign_approvals_campaign_idx ON campaign_approvals(campaign_id);

CREATE TABLE IF NOT EXISTS campaign_launches (
  id serial PRIMARY KEY,
  campaign_id integer NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL UNIQUE,
  requested_by integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  mode text NOT NULL DEFAULT 'live',
  status text NOT NULL DEFAULT 'queued',
  eligible_count integer NOT NULL DEFAULT 0,
  excluded_count integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campaign_launches_campaign_idx ON campaign_launches(campaign_id);

CREATE TABLE IF NOT EXISTS campaign_recipients (
  id serial PRIMARY KEY,
  launch_id integer NOT NULL REFERENCES campaign_launches(id) ON DELETE CASCADE,
  campaign_id integer NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  lead_id integer NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('email', 'sms')),
  status text NOT NULL DEFAULT 'eligible' CHECK (status IN ('eligible', 'excluded', 'queued', 'sent', 'failed', 'deferred')),
  exclusion_reason text,
  email_send_id integer REFERENCES email_sends(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(launch_id, lead_id, channel)
);
CREATE INDEX IF NOT EXISTS campaign_recipients_campaign_idx ON campaign_recipients(campaign_id);
CREATE INDEX IF NOT EXISTS campaign_recipients_status_idx ON campaign_recipients(status);

CREATE TABLE IF NOT EXISTS campaign_audit_events (
  id serial PRIMARY KEY,
  campaign_id integer NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  actor_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  from_status text,
  to_status text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campaign_audit_campaign_idx ON campaign_audit_events(campaign_id, created_at);

ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS campaign_id integer;
ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS campaign_launch_id integer;
CREATE INDEX IF NOT EXISTS email_sends_campaign_idx ON email_sends(campaign_id, campaign_launch_id);

-- Preserve the financing page as a reusable, unapproved draft. It remains
-- unavailable to live-send workflows until an authorized user approves it.
INSERT INTO campaigns (name, description, channel, status, email_template_id, audience_rules, owner_id, created_by)
SELECT
  'Financing Campaign',
  'Reusable financing outreach campaign seeded from the review-only campaign page.',
  'email',
  'draft',
  et.id,
  '{"programTypes":["equipment","working_capital"]}'::jsonb,
  u.id,
  u.id
FROM email_templates et
JOIN LATERAL (SELECT id FROM users WHERE role IN ('admin', 'manager') ORDER BY id LIMIT 1) u ON true
WHERE et.name = 'Equipment Financing — Review Before You Buy'
  AND NOT EXISTS (SELECT 1 FROM campaigns WHERE name = 'Financing Campaign');