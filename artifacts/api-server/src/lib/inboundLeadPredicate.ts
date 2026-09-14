export const INBOUND_LEAD_SOURCES = ["website", "qr-card"] as const;
export const INBOUND_ASSIGNMENT_AGE_HOURS = 24;

export function inboundAssignmentCutoff(now = new Date()) {
  return new Date(now.getTime() - INBOUND_ASSIGNMENT_AGE_HOURS * 60 * 60 * 1000);
}

export function isUnassignedInboundLead(
  lead: { assignedRepId: number | null; leadSource: string; createdAt: Date },
  now = new Date(),
) {
  return (
    lead.assignedRepId == null &&
    (INBOUND_LEAD_SOURCES as readonly string[]).includes(lead.leadSource) &&
    lead.createdAt < inboundAssignmentCutoff(now)
  );
}
