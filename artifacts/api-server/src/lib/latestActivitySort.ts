import { aliasedTable, sql } from "drizzle-orm";
import { activityLogTable, dealsTable } from "@workspace/db/schema";

// This alias must remain distinct from the outer relational query's activity
// table references. Otherwise Drizzle may rewrite the correlated subquery to
// the relation alias used by the surrounding query.
const latestDealActivity = aliasedTable(activityLogTable, "latest_deal_activity");

export function latestDealActivitySort() {
  return sql`(select max(${latestDealActivity.createdAt}) from ${activityLogTable} as ${latestDealActivity}
    where ${latestDealActivity.dealId} = ${dealsTable.id})`;
}