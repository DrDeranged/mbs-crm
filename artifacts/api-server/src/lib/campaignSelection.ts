import { getTableColumns, sql } from "drizzle-orm";
import { campaignsTable } from "@workspace/db";

// Drizzle removes table qualification from Column chunks in single-table SELECTs.
// A raw, fixed identifier keeps subquery "id" bound to the outer campaign rather
// than the inner approval/launch/send row. Never substitute caller input here.
const outerCampaignId = sql.raw('"campaigns"."id"');

export const campaignSelection = {
  ...getTableColumns(campaignsTable),
  canDelete: sql<boolean>`${campaignsTable.status} = 'draft'
    AND NOT EXISTS (SELECT 1 FROM campaign_approvals a WHERE a.campaign_id = ${outerCampaignId})
    AND NOT EXISTS (SELECT 1 FROM campaign_launches l WHERE l.campaign_id = ${outerCampaignId})
    AND NOT EXISTS (SELECT 1 FROM campaign_audit_events a WHERE a.campaign_id = ${outerCampaignId} AND a.action IN ('approved', 'launched'))`,
  sendDate: sql<string | null>`coalesce(
    (SELECT min(e.sent_at) FROM email_sends e WHERE e.campaign_id = ${outerCampaignId}),
    (SELECT min(l.created_at) FROM campaign_launches l WHERE l.campaign_id = ${outerCampaignId} AND l.mode = 'live'))`,
};
