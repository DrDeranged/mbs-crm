import { and, eq } from "drizzle-orm";
import {
  activityLogTable,
  db,
  leadAssignmentHistoryTable,
  leadsTable,
} from "@workspace/db";
import { buildStaleLeadCondition } from "./staleLeadCondition";
import {
  getRoutingSettings,
  selectNextInboundAssigneeInTransaction,
} from "./leadDistribution";
import { shouldAutoReassignStale } from "./leadRouting";
import { logger } from "./logger";

type CoreSelectDatabase = Pick<typeof db, "select">;

/**
 * Do not express this correlated stale predicate through a relational
 * `findMany`: Drizzle aliases that table and a predicate built from the base
 * table can then bind to the wrong relation. This core builder keeps the
 * predicate and FROM target on the same `leads` table.
 */
export async function listStaleRoundRobinLeadCandidates(
  database: CoreSelectDatabase,
  staleDays: number,
) {
  return database
    .select({
      id: leadsTable.id,
      assignedRepId: leadsTable.assignedRepId,
      leadSource: leadsTable.leadSource,
    })
    .from(leadsTable)
    .where(and(
      eq(leadsTable.leadSource, "website"),
      buildStaleLeadCondition(staleDays),
    ))
    .limit(100);
}

/**
 * Reassign stale ordinary inbound leads only when an administrator explicitly
 * enables both rotation and automatic reassignment. Assignment writes refresh
 * lastActivityAt, so a lead cannot be moved repeatedly by successive runs.
 */
export async function runStaleLeadAutoReassignment(): Promise<number> {
  const settings = await getRoutingSettings();
  if (!shouldAutoReassignStale("website", settings)) return 0;

  const staleLeads = await listStaleRoundRobinLeadCandidates(db, settings.staleDays);

  let reassigned = 0;
  for (const lead of staleLeads) {
    if (!shouldAutoReassignStale(lead.leadSource, settings)) continue;
    const changedAt = new Date();
    const changed = await db.transaction(async (tx) => {
      // Re-read the settings and choose a representative under the same
      // advisory lock that protects the persisted round-robin cursor.
      const selection = await selectNextInboundAssigneeInTransaction(tx, {
        requireAutoReassignStale: true,
      });
      if (!selection || selection.repId === lead.assignedRepId) return false;
      const nextRepId = selection.repId;

      const [updated] = await tx.update(leadsTable)
        .set({ assignedRepId: nextRepId, lastActivityAt: changedAt, updatedAt: changedAt })
        .where(and(
          eq(leadsTable.id, lead.id),
          eq(leadsTable.assignedRepId, lead.assignedRepId!),
          eq(leadsTable.leadSource, "website"),
          // The staleness window comes from the settings row read under the
          // same advisory lock as the cursor selection, not from discovery.
          buildStaleLeadCondition(selection.staleDays),
        ))
        .returning({ id: leadsTable.id });
      if (!updated) return false;

      await tx.insert(leadAssignmentHistoryTable).values({
        leadId: lead.id,
        changedByUserId: null,
        fromRepId: lead.assignedRepId,
        toRepId: nextRepId,
      });
      await tx.insert(activityLogTable).values({
        userId: null,
        leadId: lead.id,
        action: "stale_auto_reassigned",
        entityType: "lead",
        entityId: String(lead.id),
        details: {
          fromRepId: lead.assignedRepId,
          toRepId: nextRepId,
          reason: "routing.autoReassignStale",
        },
      });
      return true;
    });
    if (changed) reassigned++;
  }

  if (reassigned > 0) {
    logger.info({ reassigned }, "Automatically reassigned stale inbound leads");
  }
  return reassigned;
}
