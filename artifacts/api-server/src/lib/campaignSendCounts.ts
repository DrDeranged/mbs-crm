type Recipient = { id: number; campaignId: number; launchId?: number; leadId?: number; status: string; emailSendId?: number | null };
type Send = { id: number; campaignId: number | null; campaignLaunchId?: number | null; leadId?: number | null; sentAt?: Date | string | null; status: string; deliveryKind?: string };

export function acceptedCampaignEmail(send: Send) {
  // A later bounce/unsubscribe doesn't undo provider acceptance.
  return send.sentAt != null && send.deliveryKind !== "test" &&
    ["sent", "delivered", "opened", "clicked", "unsubscribed", "bounced"].includes(send.status);
}

/** Accepted live sends are the source of truth, including the window between
 * provider acceptance and recipient reconciliation. Callers supply live rows only.
 * Legacy accepted recipients remain counted even if their send row is unavailable.
 */
export function campaignSendCounts(campaignId: number, recipients: Recipient[], sends: Send[], leadId?: number) {
  const sentRecipients = recipients.filter(r => r.campaignId === campaignId && r.status === "sent" &&
    (leadId == null || r.leadId === leadId));
  const accepted = sends.filter(s => s.campaignId === campaignId && acceptedCampaignEmail(s) &&
    (leadId == null || s.leadId === leadId));
  const keys = new Set<string>();
  const byLaunch = new Map<number, number>();
  const add = (key: string, launchId?: number | null) => {
    if (keys.has(key)) return;
    keys.add(key);
    if (launchId != null) byLaunch.set(launchId, (byLaunch.get(launchId) ?? 0) + 1);
  };
  for (const r of sentRecipients) add(r.emailSendId == null ? `recipient:${r.id}` : `email:${r.emailSendId}`, r.launchId);
  for (const s of accepted) add(`email:${s.id}`, s.campaignLaunchId);
  return { sent: keys.size, byLaunch };
}
