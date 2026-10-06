export interface LeadIdentitySource {
  id?: number | string | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  contactName?: string | null;
  entityLabel?: string | null;
}

export interface DealIdentitySource {
  id?: number | string | null;
  entityLabel?: string | null;
  dealName?: string | null;
  lead?: LeadIdentitySource | null;
  contact?: LeadIdentitySource | null;
  companyName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  contactName?: string | null;
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function recordFallback(kind: "Lead" | "Deal", id?: number | string | null): string {
  if (kind === "Deal") return "Deal";
  return id !== undefined && id !== null && String(id).trim()
    ? `${kind} #${id}`
    : kind;
}

/** Contact person's name, with whitespace-only name fields treated as absent. */
export function contactName(lead: LeadIdentitySource | null | undefined): string {
  if (!lead) return "";
  return [clean(lead.firstName), clean(lead.lastName)].filter(Boolean).join(" ") || clean(lead.contactName);
}

/** The canonical company-first label for a lead or its contact. */
export function formatLeadIdentity(lead: LeadIdentitySource | null | undefined): string {
  const company = clean(lead?.companyName);
  const contact = contactName(lead);
  if (company && contact) return `${company} — ${contact}`;
  return company || contact || clean(lead?.entityLabel) || recordFallback("Lead", lead?.id);
}

/**
 * The canonical company-first label for a deal. A linked lead is authoritative
 * for contact identity. Incomplete or inaccessible projections use the neutral
 * "Deal" fallback, never a stored custom name or numeric identifier.
 */
export function formatDealIdentity(deal: DealIdentitySource | null | undefined): string {
  if (!deal) return "Deal";
  const linkedLead = deal.lead ?? deal.contact;
  const company = linkedLead ? clean(linkedLead.companyName) : clean(deal.companyName);
  const contact = linkedLead ? contactName(linkedLead) : clean(deal.contactName) || contactName(deal);
  if (company && contact) return `${company} — ${contact}`;
  if (company || contact) return company || contact;
  if (linkedLead) return "Deal";
  const label = clean(deal.entityLabel);
  return label && !/\bdeal\s*#?\s*\d+/i.test(label) ? label : "Deal";
}