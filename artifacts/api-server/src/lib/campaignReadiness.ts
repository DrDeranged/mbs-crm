export function hasEligibleCampaignAudience(counts: unknown): boolean {
  if (!counts || typeof counts !== "object") return false;
  const eligible = (counts as { eligible?: unknown }).eligible;
  return typeof eligible === "number" && Number.isInteger(eligible) && eligible > 0;
}

export function buildCampaignValidationResult(input: {
  toEmail: string;
  eligibleCount: number;
  validatedAt?: Date;
}) {
  return {
    mode: "dry_run" as const,
    toEmail: input.toEmail,
    eligibleCount: input.eligibleCount,
    validatedAt: (input.validatedAt ?? new Date()).toISOString(),
    message: "No provider message was sent. Use Launch Campaign after approval to deliver.",
  };
}

export function validateCampaignRender(
  template: { subject: string; bodyHtml: string; isActive: boolean } | null,
  render: (value: string) => string,
): string | null {
  if (!template?.isActive) return "An active email template is required for provider-free validation";
  if (!template.subject.trim() || !template.bodyHtml.trim()) return "The email template needs a subject and body";
  if (!render(template.subject).trim() || !render(template.bodyHtml).trim()) return "The email template rendered empty content";
  return null;
}

export function approvedAudienceSummary(
  status: string,
  version: number,
  approval: { contentVersion: number; invalidatedAt: Date | null; snapshot: unknown } | undefined,
) {
  if (status !== "approved" || !approval || approval.contentVersion !== version || approval.invalidatedAt) return null;
  const snapshot = approval.snapshot as { counts?: unknown } | null;
  const counts = snapshot?.counts as { eligible?: unknown; excluded?: unknown; emailCapacityRemaining?: unknown } | undefined;
  if (!hasEligibleCampaignAudience(counts) || typeof counts?.excluded !== "number") return null;
  return { eligible: counts.eligible as number, excluded: counts.excluded, emailCapacityRemaining: typeof counts.emailCapacityRemaining === "number" ? counts.emailCapacityRemaining : 0 };
}