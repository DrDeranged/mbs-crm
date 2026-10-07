export type RemainingRecipient = { leadId: number; channel: string; status: string; mode?: string };
export type PriorEmailAttempt = { leadId: number | null; toEmail: string };
export const pendingCampaignRecipient = (status: string) =>
  ["eligible", "queued", "deferred", "cancelled"].includes(status);

/** Fail closed on any provider attempt, including unresolved delivery outcomes. */
export function remainingCampaignLeadIds(
  recipients: RemainingRecipient[], attempts: PriorEmailAttempt[],
) {
  const blocked = new Set([
    ...recipients.filter(row => row.status === "sent").map(row => row.leadId),
    ...attempts.flatMap(row => row.leadId == null ? [] : [row.leadId]),
  ]);
  return [...new Set(recipients.filter(row =>
    row.mode !== "dry_run" && row.channel === "email" && pendingCampaignRecipient(row.status) && !blocked.has(row.leadId),
  ).map(row => row.leadId))];
}

export async function eligibleRemainingLeadIds(
  candidates: Array<{ id: number; email: string | null; isUnsubscribed: boolean | null }>,
  attempts: PriorEmailAttempt[],
  suppressed: (email: string) => Promise<boolean>,
) {
  const attemptedAddresses = new Set(attempts.map(row => row.toEmail.trim().toLowerCase()));
  const seen = new Set<string>();
  const ids: number[] = [];
  for (const lead of candidates) {
    const email = lead.email?.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      lead.isUnsubscribed || attemptedAddresses.has(email) || seen.has(email) ||
      await suppressed(email)) continue;
    seen.add(email);
    ids.push(lead.id);
  }
  return ids;
}
