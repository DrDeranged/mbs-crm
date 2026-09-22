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