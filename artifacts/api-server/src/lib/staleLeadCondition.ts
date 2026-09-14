import { aliasedTable, sql } from "drizzle-orm";
import { activityLogTable, leadsTable } from "@workspace/db/schema";
const staleLeadActivity = aliasedTable(activityLogTable, "stale_lead_activity");

// Keep the activity table explicitly aliased. Relational queries can rewrite
// references to the unaliased table in correlated expressions; an explicit
// alias keeps this subquery correlated to the outer lead row.
export function buildStaleLeadCondition(staleThresholdDays: number, now = Date.now()) {
  const cutoff = new Date(now - staleThresholdDays * 24 * 60 * 60 * 1000);
  return sql`${leadsTable.assignedRepId} is not null and coalesce(
    (select max(${staleLeadActivity.createdAt}) from ${activityLogTable} as ${staleLeadActivity}
      where ${staleLeadActivity.leadId} = ${leadsTable.id}),
    ${leadsTable.createdAt}
  ) < ${cutoff}`;
}