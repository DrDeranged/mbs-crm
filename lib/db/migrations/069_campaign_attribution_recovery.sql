-- Forward-only repair. Never rewrite the applied 067/068 identities.
-- The runner verifies the complete catalog and adopts this without DDL when
-- publish schema synchronization has already materialized these definitions.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS tracking_since timestamptz;
ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS sent_at timestamptz;
ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS reply_token_digest text;
ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS original_reply_to text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS referred_by_lead_id integer;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS referred_at timestamp;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS referred_by_lead_id integer;

CREATE TABLE IF NOT EXISTS campaign_engagement (
 id serial PRIMARY KEY, campaign_id integer NOT NULL, launch_id integer,
 lead_id integer NOT NULL, email_send_id integer, kind text NOT NULL,
 source_key text, evidence jsonb, occurred_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS campaign_replies (
 id serial PRIMARY KEY, campaign_id integer NOT NULL, lead_id integer NOT NULL,
 email_send_id integer NOT NULL, dedupe_key text NOT NULL, from_email text NOT NULL,
 subject text NOT NULL, body_text text NOT NULL, attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
 forward_to text NOT NULL, forward_status text NOT NULL DEFAULT 'pending',
 failure_reason text, received_at timestamptz NOT NULL DEFAULT now(), forwarded_at timestamptz);
CREATE TABLE IF NOT EXISTS campaign_call_attributions (
 id serial PRIMARY KEY, call_sid text NOT NULL, lead_id integer, campaign_id integer,
 original_at timestamptz NOT NULL, reason text NOT NULL);

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='campaign_engagement' AND column_name='id') THEN
  ALTER TABLE campaign_engagement ADD COLUMN IF NOT EXISTS id serial;
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='campaign_replies' AND column_name='id') THEN
  ALTER TABLE campaign_replies ADD COLUMN IF NOT EXISTS id serial;
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='campaign_call_attributions' AND column_name='id') THEN
  ALTER TABLE campaign_call_attributions ADD COLUMN IF NOT EXISTS id serial;
 END IF;
END $$;
ALTER TABLE campaign_engagement
 ADD COLUMN IF NOT EXISTS campaign_id integer NOT NULL,
 ADD COLUMN IF NOT EXISTS launch_id integer,
 ADD COLUMN IF NOT EXISTS lead_id integer NOT NULL,
 ADD COLUMN IF NOT EXISTS email_send_id integer,
 ADD COLUMN IF NOT EXISTS kind text NOT NULL,
 ADD COLUMN IF NOT EXISTS source_key text,
 ADD COLUMN IF NOT EXISTS evidence jsonb,
 ADD COLUMN IF NOT EXISTS occurred_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE campaign_replies
 ADD COLUMN IF NOT EXISTS campaign_id integer NOT NULL,
 ADD COLUMN IF NOT EXISTS lead_id integer NOT NULL,
 ADD COLUMN IF NOT EXISTS email_send_id integer NOT NULL,
 ADD COLUMN IF NOT EXISTS dedupe_key text NOT NULL,
 ADD COLUMN IF NOT EXISTS from_email text NOT NULL,
 ADD COLUMN IF NOT EXISTS subject text NOT NULL,
 ADD COLUMN IF NOT EXISTS body_text text NOT NULL,
 ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
 ADD COLUMN IF NOT EXISTS forward_to text NOT NULL,
 ADD COLUMN IF NOT EXISTS forward_status text NOT NULL DEFAULT 'pending',
 ADD COLUMN IF NOT EXISTS failure_reason text,
 ADD COLUMN IF NOT EXISTS received_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN IF NOT EXISTS forwarded_at timestamptz;
ALTER TABLE campaign_call_attributions
 ADD COLUMN IF NOT EXISTS call_sid text NOT NULL,
 ADD COLUMN IF NOT EXISTS lead_id integer,
 ADD COLUMN IF NOT EXISTS campaign_id integer,
 ADD COLUMN IF NOT EXISTS original_at timestamptz NOT NULL,
 ADD COLUMN IF NOT EXISTS reason text NOT NULL;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='campaign_engagement'::regclass AND conname='campaign_engagement_pkey') THEN
  ALTER TABLE campaign_engagement ADD CONSTRAINT campaign_engagement_pkey PRIMARY KEY (id);
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='campaign_replies'::regclass AND conname='campaign_replies_pkey') THEN
  ALTER TABLE campaign_replies ADD CONSTRAINT campaign_replies_pkey PRIMARY KEY (id);
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='campaign_call_attributions'::regclass AND conname='campaign_call_attributions_pkey') THEN
  ALTER TABLE campaign_call_attributions ADD CONSTRAINT campaign_call_attributions_pkey PRIMARY KEY (id);
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='leads'::regclass AND conname='leads_referrer_check') THEN
  ALTER TABLE leads ADD CONSTRAINT leads_referrer_check CHECK (
   (referred_by_lead_id IS NULL OR referred_by_partner_id IS NULL) AND (referred_by_lead_id IS NULL OR referred_by_lead_id <> id));
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='deals'::regclass AND conname='deals_referrer_check') THEN
  ALTER TABLE deals ADD CONSTRAINT deals_referrer_check CHECK (
   (referred_by_lead_id IS NULL OR referred_by_partner_id IS NULL) AND (referred_by_lead_id IS NULL OR lead_id IS NULL OR referred_by_lead_id <> lead_id));
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='campaign_engagement'::regclass AND conname='campaign_engagement_kind_check') THEN
  ALTER TABLE campaign_engagement ADD CONSTRAINT campaign_engagement_kind_check CHECK (kind IN ('flyer_click','inbound_call','referral'));
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='campaign_replies'::regclass AND conname='campaign_replies_forward_check') THEN
  ALTER TABLE campaign_replies ADD CONSTRAINT campaign_replies_forward_check CHECK (forward_status IN ('pending','dispatching','forwarded','failed','uncertain'));
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='leads'::regclass AND conname='leads_referred_by_lead_id_leads_id_fk') THEN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='leads'::regclass AND conname='leads_referred_by_lead_id_fkey') THEN
   ALTER TABLE leads RENAME CONSTRAINT leads_referred_by_lead_id_fkey TO leads_referred_by_lead_id_leads_id_fk;
  ELSE
   ALTER TABLE leads ADD CONSTRAINT leads_referred_by_lead_id_leads_id_fk FOREIGN KEY (referred_by_lead_id) REFERENCES leads(id) ON DELETE SET NULL;
  END IF;
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='deals'::regclass AND conname='deals_referred_by_lead_id_leads_id_fk') THEN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='deals'::regclass AND conname='deals_referred_by_lead_id_fkey') THEN
   ALTER TABLE deals RENAME CONSTRAINT deals_referred_by_lead_id_fkey TO deals_referred_by_lead_id_leads_id_fk;
  ELSE
   ALTER TABLE deals ADD CONSTRAINT deals_referred_by_lead_id_leads_id_fk FOREIGN KEY (referred_by_lead_id) REFERENCES leads(id) ON DELETE SET NULL;
  END IF;
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='campaign_engagement'::regclass AND conname='campaign_engagement_campaign_id_campaigns_id_fk') THEN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='campaign_engagement'::regclass AND conname='campaign_engagement_campaign_id_fkey') THEN
   ALTER TABLE campaign_engagement RENAME CONSTRAINT campaign_engagement_campaign_id_fkey TO campaign_engagement_campaign_id_campaigns_id_fk;
  ELSE
   ALTER TABLE campaign_engagement ADD CONSTRAINT campaign_engagement_campaign_id_campaigns_id_fk FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
  END IF;
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='campaign_engagement'::regclass AND conname='campaign_engagement_launch_id_campaign_launches_id_fk') THEN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='campaign_engagement'::regclass AND conname='campaign_engagement_launch_id_fkey') THEN
   ALTER TABLE campaign_engagement RENAME CONSTRAINT campaign_engagement_launch_id_fkey TO campaign_engagement_launch_id_campaign_launches_id_fk;
  ELSE
   ALTER TABLE campaign_engagement ADD CONSTRAINT campaign_engagement_launch_id_campaign_launches_id_fk FOREIGN KEY (launch_id) REFERENCES campaign_launches(id) ON DELETE SET NULL;
  END IF;
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='campaign_engagement'::regclass AND conname='campaign_engagement_lead_id_leads_id_fk') THEN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='campaign_engagement'::regclass AND conname='campaign_engagement_lead_id_fkey') THEN
   ALTER TABLE campaign_engagement RENAME CONSTRAINT campaign_engagement_lead_id_fkey TO campaign_engagement_lead_id_leads_id_fk;
  ELSE
   ALTER TABLE campaign_engagement ADD CONSTRAINT campaign_engagement_lead_id_leads_id_fk FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;
  END IF;
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='campaign_engagement'::regclass AND conname='campaign_engagement_email_send_id_email_sends_id_fk') THEN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='campaign_engagement'::regclass AND conname='campaign_engagement_email_send_id_fkey') THEN
   ALTER TABLE campaign_engagement RENAME CONSTRAINT campaign_engagement_email_send_id_fkey TO campaign_engagement_email_send_id_email_sends_id_fk;
  ELSE
   ALTER TABLE campaign_engagement ADD CONSTRAINT campaign_engagement_email_send_id_email_sends_id_fk FOREIGN KEY (email_send_id) REFERENCES email_sends(id) ON DELETE SET NULL;
  END IF;
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='campaign_replies'::regclass AND conname='campaign_replies_campaign_id_campaigns_id_fk') THEN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='campaign_replies'::regclass AND conname='campaign_replies_campaign_id_fkey') THEN
   ALTER TABLE campaign_replies RENAME CONSTRAINT campaign_replies_campaign_id_fkey TO campaign_replies_campaign_id_campaigns_id_fk;
  ELSE
   ALTER TABLE campaign_replies ADD CONSTRAINT campaign_replies_campaign_id_campaigns_id_fk FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
  END IF;
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='campaign_replies'::regclass AND conname='campaign_replies_lead_id_leads_id_fk') THEN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='campaign_replies'::regclass AND conname='campaign_replies_lead_id_fkey') THEN
   ALTER TABLE campaign_replies RENAME CONSTRAINT campaign_replies_lead_id_fkey TO campaign_replies_lead_id_leads_id_fk;
  ELSE
   ALTER TABLE campaign_replies ADD CONSTRAINT campaign_replies_lead_id_leads_id_fk FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;
  END IF;
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='campaign_replies'::regclass AND conname='campaign_replies_email_send_id_email_sends_id_fk') THEN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='campaign_replies'::regclass AND conname='campaign_replies_email_send_id_fkey') THEN
   ALTER TABLE campaign_replies RENAME CONSTRAINT campaign_replies_email_send_id_fkey TO campaign_replies_email_send_id_email_sends_id_fk;
  ELSE
   ALTER TABLE campaign_replies ADD CONSTRAINT campaign_replies_email_send_id_email_sends_id_fk FOREIGN KEY (email_send_id) REFERENCES email_sends(id) ON DELETE CASCADE;
  END IF;
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='campaign_call_attributions'::regclass AND conname='campaign_call_attributions_lead_id_leads_id_fk') THEN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='campaign_call_attributions'::regclass AND conname='campaign_call_attributions_lead_id_fkey') THEN
   ALTER TABLE campaign_call_attributions RENAME CONSTRAINT campaign_call_attributions_lead_id_fkey TO campaign_call_attributions_lead_id_leads_id_fk;
  ELSE
   ALTER TABLE campaign_call_attributions ADD CONSTRAINT campaign_call_attributions_lead_id_leads_id_fk FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;
  END IF;
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='campaign_call_attributions'::regclass AND conname='campaign_call_attributions_campaign_id_campaigns_id_fk') THEN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='campaign_call_attributions'::regclass AND conname='campaign_call_attributions_campaign_id_fkey') THEN
   ALTER TABLE campaign_call_attributions RENAME CONSTRAINT campaign_call_attributions_campaign_id_fkey TO campaign_call_attributions_campaign_id_campaigns_id_fk;
  ELSE
   ALTER TABLE campaign_call_attributions ADD CONSTRAINT campaign_call_attributions_campaign_id_campaigns_id_fk FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL;
  END IF;
 END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS email_sends_reply_token_uq ON email_sends(reply_token_digest);
CREATE INDEX IF NOT EXISTS leads_referrer_lead_idx ON leads(referred_by_lead_id);
CREATE INDEX IF NOT EXISTS leads_referrer_partner_idx ON leads(referred_by_partner_id);
CREATE INDEX IF NOT EXISTS deals_referrer_lead_idx ON deals(referred_by_lead_id);
CREATE UNIQUE INDEX IF NOT EXISTS campaign_engagement_source_uq ON campaign_engagement(source_key);
CREATE INDEX IF NOT EXISTS campaign_engagement_campaign_lead_idx ON campaign_engagement(campaign_id,lead_id,occurred_at);
CREATE UNIQUE INDEX IF NOT EXISTS campaign_replies_dedupe_uq ON campaign_replies(dedupe_key);
CREATE INDEX IF NOT EXISTS campaign_replies_campaign_idx ON campaign_replies(campaign_id,lead_id);
CREATE UNIQUE INDEX IF NOT EXISTS campaign_call_attributions_sid_uq ON campaign_call_attributions(call_sid);
