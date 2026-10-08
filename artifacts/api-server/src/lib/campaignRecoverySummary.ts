import { pendingCampaignRecipient, type RemainingRecipient, type PriorEmailAttempt } from "./campaignRemaining";

type Recipient = RemainingRecipient & { campaignId: number };
type Lead = { id: number; email: string | null; isUnsubscribed: boolean | null };
type Recovery = { id: number; name: string; status: string };

/** Distinct-person accounting. Provider attempts remain a retry barrier, not a delivery claim. */
export async function campaignRecoverySummary(input: {
  sourceId: number;
  recipients: Recipient[];
  attempts: PriorEmailAttempt[];
  leads: Lead[];
  recoveries: Recovery[];
  reservedLeadIds?: number[];
  bouncedEmails: Set<string>;
  suppressed: (email: string) => Promise<boolean>;
}) {
  const live = input.recipients.filter(r => r.mode !== "dry_run" && r.channel === "email");
  const sourceSent = new Set(live.filter(r => r.campaignId === input.sourceId && r.status === "sent").map(r => r.leadId));
  const source = new Map(live.filter(r => r.campaignId === input.sourceId && !sourceSent.has(r.leadId)).map(r => [r.leadId, r]));
  const delivered = new Set(live.filter(r => r.campaignId !== input.sourceId && r.status === "sent").map(r => r.leadId));
  const attemptedIds = new Set(input.attempts.flatMap(a => a.leadId == null ? [] : [a.leadId]));
  const attemptedEmails = new Set(input.attempts.map(a => a.toEmail.trim().toLowerCase()));
  const reserved = new Set([
    ...(input.reservedLeadIds ?? []),
    ...live.filter(r => r.campaignId !== input.sourceId && pendingCampaignRecipient(r.status)).map(r => r.leadId),
  ]);
  const leads = new Map(input.leads.map(l => [l.id, l]));
  const seen = new Set<string>();
  const reasons = new Map<string, number>();
  let sentViaRecovery = 0, eligibleRemaining = 0, pendingViaRecovery = 0;
  for (const [id, row] of [...source.entries()].sort((a, b) => a[0] - b[0])) {
    if (delivered.has(id)) { sentViaRecovery++; continue; }
    const lead = leads.get(id);
    const email = lead?.email?.trim().toLowerCase() ?? "";
    let reason: string | null = null;
    if (!pendingCampaignRecipient(row.status)) reason = row.status === "failed" ? "Failed in original campaign" : "Excluded in original campaign";
    else if (reserved.has(id)) { pendingViaRecovery++; continue; }
    else if (attemptedIds.has(id) || attemptedEmails.has(email)) reason = "Prior delivery attempt — not safe to resend";
    else if (!lead) reason = "Lead no longer available";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) reason = "Missing or invalid email";
    else if (input.bouncedEmails.has(email) && (lead.isUnsubscribed || await input.suppressed(email))) reason = "Suppressed — bounce/block";
    else if (lead.isUnsubscribed) reason = "Opted out / suppressed";
    else if (await input.suppressed(email)) reason = "Suppressed — shared email opt-out";
    else if (seen.has(email)) reason = "Duplicate email address";
    if (reason) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    else { seen.add(email); eligibleRemaining++; }
  }
  return {
    notSentHere: source.size, sentViaRecovery, eligibleRemaining, pendingViaRecovery,
    exclusions: [...reasons].map(([reason, count]) => ({ reason, count })),
    recoveries: input.recoveries,
  };
}
