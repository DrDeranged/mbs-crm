-- Append-only campaign engagement and typed lead referrals.
ALTER TABLE campaigns ADD COLUMN tracking_since timestamptz;
ALTER TABLE campaign_recipients ADD COLUMN sent_at timestamptz;
ALTER TABLE email_sends ADD COLUMN reply_token_digest text;
ALTER TABLE email_sends ADD COLUMN original_reply_to text;
CREATE UNIQUE INDEX email_sends_reply_token_uq ON email_sends(reply_token_digest);
ALTER TABLE leads ADD COLUMN referred_by_lead_id integer REFERENCES leads(id) ON DELETE SET NULL;
ALTER TABLE leads ADD COLUMN referred_at timestamp;
CREATE INDEX leads_referrer_lead_idx ON leads(referred_by_lead_id);
CREATE INDEX leads_referrer_partner_idx ON leads(referred_by_partner_id);
ALTER TABLE leads ADD CONSTRAINT leads_referrer_check CHECK (
 (referred_by_lead_id IS NULL OR referred_by_partner_id IS NULL)
 AND (referred_by_lead_id IS NULL OR referred_by_lead_id <> id));
ALTER TABLE deals ADD COLUMN referred_by_lead_id integer REFERENCES leads(id) ON DELETE SET NULL;
CREATE INDEX deals_referrer_lead_idx ON deals(referred_by_lead_id);
ALTER TABLE deals ADD CONSTRAINT deals_referrer_check CHECK (
 (referred_by_lead_id IS NULL OR referred_by_partner_id IS NULL)
 AND (referred_by_lead_id IS NULL OR lead_id IS NULL OR referred_by_lead_id <> lead_id));
CREATE TABLE campaign_engagement (
 id serial PRIMARY KEY,
 campaign_id integer NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
 launch_id integer REFERENCES campaign_launches(id) ON DELETE SET NULL,
 lead_id integer NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
 email_send_id integer REFERENCES email_sends(id) ON DELETE SET NULL,
 kind text NOT NULL,
 source_key text,
 evidence jsonb,
 occurred_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT campaign_engagement_kind_check CHECK (kind IN ('flyer_click','inbound_call','referral')));
CREATE UNIQUE INDEX campaign_engagement_source_uq ON campaign_engagement(source_key);
CREATE INDEX campaign_engagement_campaign_lead_idx ON campaign_engagement(campaign_id,lead_id,occurred_at);
CREATE TABLE campaign_replies (
 id serial PRIMARY KEY,
 campaign_id integer NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
 lead_id integer NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
 email_send_id integer NOT NULL REFERENCES email_sends(id) ON DELETE CASCADE,
 dedupe_key text NOT NULL,
 from_email text NOT NULL,
 subject text NOT NULL,
 body_text text NOT NULL,
 attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
 forward_to text NOT NULL,
 forward_status text NOT NULL DEFAULT 'pending',
 failure_reason text,
 received_at timestamptz NOT NULL DEFAULT now(),
 forwarded_at timestamptz,
 CONSTRAINT campaign_replies_forward_check CHECK (forward_status IN ('pending','dispatching','forwarded','failed','uncertain')));
CREATE UNIQUE INDEX campaign_replies_dedupe_uq ON campaign_replies(dedupe_key);
CREATE INDEX campaign_replies_campaign_idx ON campaign_replies(campaign_id,lead_id);
CREATE TABLE campaign_call_attributions (
 id serial PRIMARY KEY,
 call_sid text NOT NULL,
 lead_id integer REFERENCES leads(id) ON DELETE SET NULL,
 campaign_id integer REFERENCES campaigns(id) ON DELETE SET NULL,
 original_at timestamptz NOT NULL,
 reason text NOT NULL);
CREATE UNIQUE INDEX campaign_call_attributions_sid_uq ON campaign_call_attributions(call_sid);
