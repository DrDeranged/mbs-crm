import { companySettingsTable } from "@workspace/db";

export const USFA_LEAD_SOURCE = "usfundadvisor";

export function isUsfaLead(leadSource: string | null | undefined): boolean {
  return leadSource === USFA_LEAD_SOURCE;
}

export function shouldBlockUsfaMarketing(
  leadSource: string | null | undefined,
  consentConfirmed: boolean,
): boolean {
  return isUsfaLead(leadSource) && !consentConfirmed;
}

export async function isUsfaMarketingBlocked(
  database: { select: typeof import("@workspace/db").db.select },
  leadSource: string | null | undefined,
): Promise<boolean> {
  if (!isUsfaLead(leadSource)) return false;
  const [settings] = await database.select({
    usfaConsentConfirmed: companySettingsTable.usfaConsentConfirmed,
  }).from(companySettingsTable).limit(1);
  return shouldBlockUsfaMarketing(leadSource, settings?.usfaConsentConfirmed === true);
}