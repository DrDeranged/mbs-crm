-- Preserve the applied attribution migration; align PostgreSQL's implicit
-- constraint names with the schema model without replacing any relationship.
DO $$
DECLARE
  relation_name text;
  old_name text;
  new_name text;
BEGIN
  FOR relation_name, old_name, new_name IN SELECT * FROM (VALUES
    ('leads', 'leads_referred_by_lead_id_fkey', 'leads_referred_by_lead_id_leads_id_fk'),
    ('deals', 'deals_referred_by_lead_id_fkey', 'deals_referred_by_lead_id_leads_id_fk'),
    ('campaign_engagement', 'campaign_engagement_campaign_id_fkey', 'campaign_engagement_campaign_id_campaigns_id_fk'),
    ('campaign_engagement', 'campaign_engagement_launch_id_fkey', 'campaign_engagement_launch_id_campaign_launches_id_fk'),
    ('campaign_engagement', 'campaign_engagement_lead_id_fkey', 'campaign_engagement_lead_id_leads_id_fk'),
    ('campaign_engagement', 'campaign_engagement_email_send_id_fkey', 'campaign_engagement_email_send_id_email_sends_id_fk'),
    ('campaign_replies', 'campaign_replies_campaign_id_fkey', 'campaign_replies_campaign_id_campaigns_id_fk'),
    ('campaign_replies', 'campaign_replies_lead_id_fkey', 'campaign_replies_lead_id_leads_id_fk'),
    ('campaign_replies', 'campaign_replies_email_send_id_fkey', 'campaign_replies_email_send_id_email_sends_id_fk'),
    ('campaign_call_attributions', 'campaign_call_attributions_lead_id_fkey', 'campaign_call_attributions_lead_id_leads_id_fk'),
    ('campaign_call_attributions', 'campaign_call_attributions_campaign_id_fkey', 'campaign_call_attributions_campaign_id_campaigns_id_fk')
  ) AS names(relation_name, old_name, new_name)
  LOOP
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = old_name AND conrelid = relation_name::regclass) THEN
      EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', relation_name, old_name, new_name);
    END IF;
  END LOOP;
END $$;
