import { leadsTable } from "@workspace/db";
import { and, inArray, isNull, lt } from "drizzle-orm";
import {
  inboundAssignmentCutoff,
  INBOUND_LEAD_SOURCES,
  isUnassignedInboundLead,
} from "./inboundLeadPredicate";

export { inboundAssignmentCutoff, INBOUND_LEAD_SOURCES, isUnassignedInboundLead };

/**
 * Keep the dashboard count and the lead-list indicator on one server-side
 * predicate. Public application submissions are persisted as website/qr-card
 * leads, so no application-table join is needed here.
 */
export function unassignedInboundLeadCondition(now = new Date()) {
  return and(
    isNull(leadsTable.assignedRepId),
    inArray(leadsTable.leadSource, [...INBOUND_LEAD_SOURCES]),
    lt(leadsTable.createdAt, inboundAssignmentCutoff(now)),
  );
}

