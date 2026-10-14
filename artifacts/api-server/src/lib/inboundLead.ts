import { leadsTable } from "@workspace/db";
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import {
  inboundAssignmentCutoff,
  INBOUND_LEAD_SOURCES,
  isUnassignedInboundLead,
} from "./inboundLeadPredicate";

export { inboundAssignmentCutoff, INBOUND_LEAD_SOURCES, isUnassignedInboundLead };

/**
 * Keep the dashboard count and the lead-list indicator on one server-side
 * predicate. Including existing call leads here is the idempotent, read-time
 * backfill: no ownership, timestamps or history are rewritten.
 */
export function unassignedInboundLeadCondition(now = new Date()) {
  return and(
    isNull(leadsTable.assignedRepId),
    inArray(leadsTable.leadSource, [...INBOUND_LEAD_SOURCES]),
    or(eq(leadsTable.leadSource, "inbound-call"), lt(leadsTable.createdAt, inboundAssignmentCutoff(now))),
  );
}

