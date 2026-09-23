export const CAMPAIGN_FLYER_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"] as const;
export const MAX_CAMPAIGN_FLYER_BYTES = 15 * 1024 * 1024;

export function validateCampaignFlyerFile(file: Pick<File, "type" | "size">): string | null {
  if (!(CAMPAIGN_FLYER_TYPES as readonly string[]).includes(file.type) || file.size <= 0 || file.size > MAX_CAMPAIGN_FLYER_BYTES) {
    return "Choose a PNG, JPG, WebP, or PDF file up to 15 MB.";
  }
  return null;
}

export function serializeAudienceRules(rules: {
  statuses?: string[];
  programTypes?: string[];
  assignedRepId?: string | null;
  leadSources?: string[];
  createdFrom?: string | null;
  createdTo?: string | null;
  minAmount?: string | null;
  maxAmount?: string | null;
}) {
  return {
    ...rules,
    assignedRepId: !rules.assignedRepId || rules.assignedRepId === "__none__" ? null : Number(rules.assignedRepId),
    createdFrom: rules.createdFrom || null,
    createdTo: rules.createdTo || null,
    minAmount: rules.minAmount ? Number(rules.minAmount) : null,
    maxAmount: rules.maxAmount ? Number(rules.maxAmount) : null,
  };
}

export function isCampaignPreviewFresh(input: {
  dirty: boolean;
  previewedVersion: number | null;
  campaignVersion: number;
  previewToken?: string | null;
}) {
  return !input.dirty && input.previewedVersion === input.campaignVersion && Boolean(input.previewToken);
}

export type CampaignReadinessBlocker = {
  code: "unsaved_changes" | "missing_preview" | "missing_template" | "inactive_template" | "claims_affirmation" | "empty_audience" | "wrong_status";
  label: string;
  action: "save" | "preview" | "content" | "affirm" | "audience" | "none";
};

export function getCampaignReadiness(input: {
  status: string;
  dirty: boolean;
  previewFresh: boolean;
  eligibleCount?: number;
  requiresEmailTemplate: boolean;
  hasTemplate: boolean;
  templateActive: boolean;
  claimsAffirmed: boolean;
}) {
  const blockers: CampaignReadinessBlocker[] = [];
  if (input.status !== "draft") blockers.push({ code: "wrong_status", label: "Campaign is not in draft status.", action: "none" });
  if (input.dirty) blockers.push({ code: "unsaved_changes", label: "Save your campaign changes.", action: "save" });
  if (!input.previewFresh) blockers.push({ code: "missing_preview", label: "Calculate a fresh audience preview.", action: "preview" });
  if (input.requiresEmailTemplate && !input.hasTemplate) blockers.push({ code: "missing_template", label: "Select an email template.", action: "content" });
  if (input.requiresEmailTemplate && input.hasTemplate && !input.templateActive) blockers.push({ code: "inactive_template", label: "Select an active email template.", action: "content" });
  if (!input.claimsAffirmed) blockers.push({ code: "claims_affirmation", label: "Complete the required campaign affirmation.", action: "affirm" });
  if (input.previewFresh && input.eligibleCount === 0) blockers.push({ code: "empty_audience", label: "The fresh preview has no eligible recipients.", action: "audience" });
  return { ready: blockers.length === 0, blockers };
}

export function explainEmptyAudience(totalMatching: number, excluded: number) {
  return totalMatching === 0
    ? "No leads match the current audience filters. Adjust the filters and calculate again."
    : `${excluded} matching lead${excluded === 1 ? " is" : "s are"} ineligible because of contact, consent, suppression, duplicate, or capacity checks.`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function campaignValuesChanged(current: unknown, saved: unknown) {
  return canonicalJson(current) !== canonicalJson(saved);
}

export function canConfirmCampaignLaunch(input: {
  status: string;
  dirty: boolean;
  approvedAudience: { eligible: number } | null | undefined;
}) {
  return input.status === "approved" && !input.dirty &&
    Boolean(input.approvedAudience && input.approvedAudience.eligible > 0);
}