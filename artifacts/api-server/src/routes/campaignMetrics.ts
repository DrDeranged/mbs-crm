import { Router } from "express";
import { eq, and, inArray, desc, sql } from "drizzle-orm";
import { db, campaignsTable, campaignRecipientsTable, campaignLaunchesTable, emailSendsTable, campaignEngagementTable, campaignRepliesTable, emailWebhookEventsTable, leadsTable, dealsTable, leadStatusHistoryTable, activityLogTable, dealApprovalsTable } from "@workspace/db";
import { requireUser } from "../lib/authHelpers";
import { replyCaptureConfigured } from "../lib/campaignAttribution";
import { reconcileCampaignMetrics } from "../lib/campaignMetrics";

const router = Router();
async function metrics(campaigns: any[], leadFilter?: number) {
  const ids = campaigns.map(c => c.id); if (!ids.length) return [];
  const [recipients, sends, engagement, replies] = await Promise.all([
    db.select({ id: campaignRecipientsTable.id, campaignId: campaignRecipientsTable.campaignId, leadId: campaignRecipientsTable.leadId,
      channel: campaignRecipientsTable.channel, status: campaignRecipientsTable.status, emailSendId: campaignRecipientsTable.emailSendId, sentAt: campaignRecipientsTable.sentAt })
      .from(campaignRecipientsTable).innerJoin(campaignLaunchesTable, eq(campaignLaunchesTable.id, campaignRecipientsTable.launchId))
      .where(and(inArray(campaignRecipientsTable.campaignId, ids), eq(campaignLaunchesTable.mode, "live"))),
    db.select().from(emailSendsTable).innerJoin(campaignLaunchesTable, eq(campaignLaunchesTable.id, emailSendsTable.campaignLaunchId))
      .where(and(inArray(emailSendsTable.campaignId, ids), eq(campaignLaunchesTable.mode, "live"))).then(rows => rows.map(r => r.email_sends)),
    db.select().from(campaignEngagementTable).where(inArray(campaignEngagementTable.campaignId, ids)),
    db.select().from(campaignRepliesTable).where(inArray(campaignRepliesTable.campaignId, ids)),
  ]);
  const leadIds = [...new Set([...sends.map(s => s.leadId), ...recipients.map(r => r.leadId), ...engagement.map(e => e.leadId)].filter((id): id is number => id != null))];
  const [leads, deals, histories] = leadIds.length ? await Promise.all([
    db.select().from(leadsTable).where(inArray(leadsTable.id, leadIds)),
    db.select().from(dealsTable).where(inArray(dealsTable.leadId, leadIds)),
    db.select().from(leadStatusHistoryTable).where(inArray(leadStatusHistoryTable.leadId, leadIds)),
  ]) : [[], [], []];
  const dealIds = deals.map(d => d.id);
  const messageIds = sends.map(s => s.sendgridMessageId?.replace(/[<>]/g, "").split(".")[0]).filter((id): id is string => Boolean(id));
  const [activities, approvals, webhookEvents] = await Promise.all([
    dealIds.length ? db.select().from(activityLogTable).where(inArray(activityLogTable.dealId, dealIds)) : [],
    dealIds.length ? db.select().from(dealApprovalsTable).where(inArray(dealApprovalsTable.dealId, dealIds)) : [],
    messageIds.length ? db.select().from(emailWebhookEventsTable)
      .where(inArray(sql`split_part(replace(replace(${emailWebhookEventsTable.messageId}, '<', ''), '>', ''), '.', 1)`, messageIds)) : [],
  ]);
  return campaigns.map(c => reconcileCampaignMetrics(c, { recipients, sends, engagement, replies, leads, deals, histories, activities, approvals, webhookEvents }, replyCaptureConfigured(), leadFilter));
}
async function manager(req: any, res: any) {
  const user = await requireUser(req, res); if (!user) return null;
  if (!["admin", "manager"].includes(user.role)) { res.status(403).json({ error: "Manager or admin role required" }); return null; }
  return user;
}
router.get("/campaigns/metrics", async (req, res) => {
  if (!await manager(req, res)) return;
  const campaigns = await db.select().from(campaignsTable).orderBy(desc(campaignsTable.createdAt));
  res.json(await metrics(campaigns));
});
router.get("/campaigns/:id/metrics", async (req, res) => {
  if (!await manager(req, res)) return;
  const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, Number(req.params.id))).limit(1);
  if (!campaign) return void res.status(404).json({ error: "Campaign not found" });
  res.json((await metrics([campaign]))[0]);
});
router.get("/leads/:id/campaign-engagement", async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  const leadId = Number(req.params.id);
  const [lead] = await db.select().from(leadsTable).where(and(eq(leadsTable.id, leadId), user.role === "rep" ? eq(leadsTable.assignedRepId, user.id) : undefined)).limit(1);
  if (!lead) return void res.status(404).json({ error: "Lead not found" });
  const campaignIds = [...new Set([
    ...(await db.select({ id: campaignRecipientsTable.campaignId }).from(campaignRecipientsTable).where(eq(campaignRecipientsTable.leadId, leadId))).map(r => r.id),
    ...(await db.select({ id: campaignEngagementTable.campaignId }).from(campaignEngagementTable).where(eq(campaignEngagementTable.leadId, leadId))).map(r => r.id),
  ])];
  res.json(campaignIds.length ? await metrics(await db.select().from(campaignsTable).where(inArray(campaignsTable.id, campaignIds)), leadId) : []);
});
for (const scope of ["leads", "campaigns"]) {
  router.get(`/${scope}/:id/${scope === "leads" ? "campaign-replies" : "replies"}`, async (req, res) => {
    const user = scope === "campaigns" ? await manager(req, res) : await requireUser(req, res); if (!user) return;
    const id = Number(req.params.id);
    if (scope === "leads") {
      const [lead] = await db.select().from(leadsTable).where(and(eq(leadsTable.id, id), user.role === "rep" ? eq(leadsTable.assignedRepId, user.id) : undefined)).limit(1);
      if (!lead) return void res.status(404).json({ error: "Lead not found" });
    }
    const rows = await db.select().from(campaignRepliesTable).where(eq(scope === "leads" ? campaignRepliesTable.leadId : campaignRepliesTable.campaignId, id)).orderBy(desc(campaignRepliesTable.receivedAt)).limit(500);
    res.json(rows.map(({ dedupeKey: _key, forwardTo: _to, forwardedAt: _at, ...r }) => ({ ...r,
      attachments: r.attachments.map(({ filename, contentType }) => ({ filename, contentType })) })));
  });
}
export default router;
