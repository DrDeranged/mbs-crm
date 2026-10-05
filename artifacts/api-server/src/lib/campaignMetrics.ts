import { calculateRatePoints } from "./ratePoints";

export const CAMPAIGN_METRIC_DEFINITIONS = [
  "Sent counts accepted live recipient/channel sends, including SMS. Delivery percentage uses accepted email sends only; bounce and block count distinct email sends.",
  "Opens are approximate and may include privacy proxies. Flyer unique counts distinct leads; total counts every validated request, including scanners/repeated requests. First-click time is the earliest recorded request.",
  "Calls and referrals use the most recent successful campaign receipt within 30 days (inclusive). Queued, failed, suppressed, test and known bounced/blocked sends cannot qualify. Signed referral provenance takes precedence.",
  "Referral campaign credit is fixed at creation. Later referral corrections are audited and do not silently change historical campaign credit.",
  "Conversion counts distinct leads across recipients and attributed referrals, using submitted/approved/funded milestones at or after cohort entry. A lead in both groups counts once.",
  "Funded dollars and MBS points count distinct referred deals only, funded at or after referral attribution. MBS points are summed authoritative rate/points calculations, not guessed GM splits. Unpriced deals are disclosed.",
  "Not tracked means historical provenance is unavailable; zero means tracking was available and no matching event was recorded.",
];
const dateMs = (date: Date | string | null | undefined) => date == null ? null : new Date(date).getTime();

/** Pure reconciler: all source sets are deduplicated BEFORE financial sums. */
export function reconcileCampaignMetrics(campaign: any, data: {
  recipients: any[]; sends: any[]; engagement: any[]; replies: any[];
  webhookEvents: any[]; leads: any[]; deals: any[]; histories: any[]; activities: any[]; approvals: any[];
}, replyCaptureConfigured: boolean, leadFilter?: number) {
  const matches = (r: any) => r.campaignId === campaign.id && (leadFilter == null || r.leadId === leadFilter);
  const sends = data.sends.filter(matches).filter(s => s.sentAt != null && s.deliveryKind !== "test" &&
    ["sent", "delivered", "opened", "clicked", "unsubscribed", "bounced"].includes(s.status));
  const recipients = data.recipients.filter(matches).filter(r => r.status === "sent");
  const engagement = data.engagement.filter(matches);
  const emailIds = new Set(sends.map(s => s.id));
  const eventMatches = (s: any, type: string) => data.webhookEvents.some(e => e.eventType === type &&
    e.messageId && s.sendgridMessageId &&
    String(e.messageId).replace(/[<>]/g, "").split(".")[0] === String(s.sendgridMessageId).replace(/[<>]/g, "").split(".")[0]);
  const delivered = sends.filter(s => s.status === "delivered" || eventMatches(s, "delivered")).length;
  const blocked = sends.filter(s => eventMatches(s, "blocked") || eventMatches(s, "dropped")).length;
  const bounced = sends.filter(s => eventMatches(s, "bounce") || (s.status === "bounced" && !eventMatches(s, "blocked") && !eventMatches(s, "dropped"))).length;
  const cohort = new Map<number, number>();
  const enter = (id: number, at: Date | string | null) => {
    const time = dateMs(at); if (time === null || !Number.isFinite(time)) return;
    cohort.set(id, Math.min(cohort.get(id) ?? Infinity, time));
  };
  for (const s of sends) if (s.leadId && s.status !== "bounced" && !eventMatches(s, "bounce") && !eventMatches(s, "blocked") && !eventMatches(s, "dropped")) enter(s.leadId, s.sentAt);
  for (const r of recipients) if (r.channel === "sms") enter(r.leadId, r.sentAt);
  const referrals = engagement.filter(e => e.kind === "referral");
  for (const e of referrals) enter(e.leadId, e.occurredAt);
  const referredAt = new Map<number, number>();
  for (const e of referrals) referredAt.set(e.leadId, Math.min(referredAt.get(e.leadId) ?? Infinity, dateMs(e.occurredAt)!));
  const conversion = { submitted: new Set<number>(), approved: new Set<number>(), funded: new Set<number>() };
  function milestone(id: number | null, kind: keyof typeof conversion, at: any) {
    const since = id == null ? undefined : cohort.get(id), time = dateMs(at);
    if (id != null && since != null && time != null && time >= since) conversion[kind].add(id);
  }
  for (const h of data.histories) {
    if (h.toStatus === "submitted_to_underwriting") milestone(h.leadId, "submitted", h.createdAt);
    if (h.toStatus === "approved") milestone(h.leadId, "approved", h.createdAt);
    if (h.toStatus === "funded") milestone(h.leadId, "funded", h.createdAt);
  }
  for (const lead of data.leads) if (lead.fundedAt) milestone(lead.id, "funded", lead.fundedAt);
  for (const a of data.activities) {
    const stage = a.action === "stage_changed" ? a.details?.to :
      a.action === "created" && a.entityType === "deal" ? a.details?.initialStage : null;
    const deal = data.deals.find(d => d.id === a.dealId);
    if (deal && ["submitted", "approved", "funded"].includes(stage)) milestone(deal.leadId, stage, a.createdAt);
  }
  for (const a of data.approvals) {
    const deal = data.deals.find(d => d.id === a.dealId);
    if (deal) milestone(deal.leadId, "approved", a.createdAt);
  }
  for (const deal of data.deals) {
    // The row's current stage cannot date an earlier business event, including
    // imported/backdated deals. Only actual audit events or milestone dates count.
    if (deal.fundedAt) milestone(deal.leadId, "funded", deal.fundedAt);
  }
  const fundedDeals = [...new Map(data.deals.filter(d => d.stage === "funded" && d.leadId != null &&
    referredAt.has(d.leadId) && dateMs(d.fundedAt) != null && dateMs(d.fundedAt)! >= referredAt.get(d.leadId)!).map(d => [d.id, d])).values()];
  let mbsPoints = 0, unpricedFundedDeals = 0;
  for (const d of fundedDeals) {
    const saved = data.activities.filter(a => a.dealId === d.id && a.action === "rate_points_saved")
      .sort((a, b) => dateMs(b.createdAt)! - dateMs(a.createdAt)! || b.id - a.id)[0];
    const details = saved?.details;
    const calculation = details && calculateRatePoints({ advance: details.advance, payment: details.payment,
      term: details.term, timing: details.timing, buyNominalRate: details.buyNominalRate });
    if (calculation && Number.isFinite(calculation.points) && d.actualGm != null &&
      Math.abs(Number(d.actualGm) - calculation.totalCommission) <= 1) mbsPoints += calculation.points;
    else unpricedFundedDeals++;
  }
  const clicks = engagement.filter(e => e.kind === "flyer_click").sort((a, b) => dateMs(a.occurredAt)! - dateMs(b.occurredAt)!);
  const countedReplies = data.replies.filter(matches).filter(r => emailIds.has(r.emailSendId));
  const engagedIds = [...new Set([...engagement.map(e => e.leadId), ...countedReplies.map(r => r.leadId)])]
    .filter(id => Number.isSafeInteger(id) && id > 0).sort((a, b) => a - b);
  const engagedLeads = engagedIds.map(leadId => {
    const lead = data.leads.find(l => l.id === leadId);
    const leadClicks = clicks.filter(e => e.leadId === leadId);
    return {
      leadId, label: lead?.companyName || `${lead?.firstName ?? ""} ${lead?.lastName ?? ""}`.trim() || `Lead #${leadId}`,
      firstClickAt: leadClicks[0] ? new Date(leadClicks[0].occurredAt).toISOString() : null,
      totalFlyerClicks: leadClicks.length,
      replies: new Set(countedReplies.filter(r => r.leadId === leadId).map(r => r.id)).size,
      calls: new Set(engagement.filter(e => e.kind === "inbound_call" && e.leadId === leadId).map(e => e.sourceKey ?? e.id)).size,
    };
  });
  const tracked = campaign.trackingSince != null;
  return {
    campaignId: campaign.id, name: campaign.name, trackingSince: campaign.trackingSince ? new Date(campaign.trackingSince).toISOString() : null, replyCaptureConfigured,
    sent: new Set([...recipients.map(r => `recipient:${r.id}`), ...sends.filter(s => !recipients.some(r => r.emailSendId === s.id)).map(s => `email:${s.id}`)]).size,
    delivered, deliveredPct: sends.length ? Math.round(delivered / sends.length * 10000) / 100 : null,
    bounced, blocked, opensApproximate: sends.filter(s => s.openedAt || s.status === "opened" || eventMatches(s, "open")).length,
    uniqueFlyerClicks: tracked ? new Set(clicks.map(e => e.leadId)).size : null, totalFlyerClicks: tracked ? clicks.length : null,
    firstClickAt: clicks[0] ? new Date(clicks[0].occurredAt).toISOString() : null,
    replies: tracked ? new Set(countedReplies.map(r => r.id)).size : null,
    calls: tracked ? new Set(engagement.filter(e => e.kind === "inbound_call").map(e => e.sourceKey ?? e.id)).size : null,
    referredLeads: tracked ? new Set(referrals.map(e => e.leadId)).size : null,
    submitted: tracked ? conversion.submitted.size : null, approved: tracked ? conversion.approved.size : null, funded: tracked ? conversion.funded.size : null,
    fundedDollars: tracked ? fundedDeals.reduce((sum, d) => sum + Number(d.amount ?? 0), 0) : null,
    mbsPoints: tracked ? Math.round(mbsPoints * 10000) / 10000 : null, unpricedFundedDeals,
    definitions: CAMPAIGN_METRIC_DEFINITIONS, engagedLeads: tracked ? engagedLeads : [],
  };
}
