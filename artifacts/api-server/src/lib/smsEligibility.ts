import { and, desc, eq } from "drizzle-orm";
import { applicationsTable, leadsTable } from "@workspace/db";

export type SmsEligibility = { eligible: boolean; reason: string };
export type SmsConsentRecord = {
  smsConsent: boolean;
  smsConsentAt: Date | null;
  smsConsentIp: string | null;
};

export function applicationSmsConsentFields(
  consent: boolean,
  clientIp: string | null,
  capturedAt = new Date(),
): SmsConsentRecord {
  return {
    smsConsent: consent,
    smsConsentAt: consent ? capturedAt : null,
    smsConsentIp: consent ? clientIp : null,
  };
}

export function evaluateLeadSmsEligibility(
  lead: { phone: string | null; isUnsubscribed: boolean } | null,
  application: SmsConsentRecord | null,
): SmsEligibility {
  if (!lead) return { eligible: false, reason: "lead_not_found" };
  if (!lead.phone) return { eligible: false, reason: "missing_phone" };
  if (lead.isUnsubscribed) return { eligible: false, reason: "unsubscribed" };
  if (!application?.smsConsent || !application.smsConsentAt || !application.smsConsentIp) {
    return { eligible: false, reason: "application_sms_consent_required" };
  }
  return { eligible: true, reason: "eligible" };
}

/** Consent is application-scoped: never infer it from a lead or an old record. */
export async function getLeadSmsEligibility(database: any, leadId: number): Promise<SmsEligibility> {
  const lead = await database.query.leadsTable.findFirst({ where: eq(leadsTable.id, leadId) });
  if (!lead) return evaluateLeadSmsEligibility(null, null);
  const application = await database.query.applicationsTable.findFirst({
    where: eq(applicationsTable.leadId, leadId),
    orderBy: [desc(applicationsTable.submittedAt), desc(applicationsTable.id)],
  });
  return evaluateLeadSmsEligibility(lead, application ?? null);
}