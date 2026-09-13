import { db } from "@workspace/db";
import { activityLogTable, leadsTable, usersTable } from "@workspace/db";
import { desc, eq, inArray } from "drizzle-orm";

export async function logActivity(params: {
  userId: number | null;
  leadId?: number | null;
  dealId?: number | null;
  action: string;
  entityType: string;
  entityId: string | number;
  details?: Record<string, unknown>;
}) {
  await db.insert(activityLogTable).values({
    userId: params.userId,
    leadId: params.leadId ?? null,
    dealId: params.dealId ?? null,
    action: params.action,
    entityType: params.entityType,
    entityId: String(params.entityId),
    details: params.details ?? null,
  });

  if (params.leadId) {
    await db
      .update(leadsTable)
      .set({ lastActivityAt: new Date(), updatedAt: new Date() })
      .where(eq(leadsTable.id, params.leadId));
  }
}

/**
 * Fetch the most recent activity for a page of entities in one query.  List
 * endpoints use this instead of loading activity once per row (N+1).
 */
export async function getLatestActivities(
  entity: "lead" | "deal",
  ids: number[],
) {
  if (ids.length === 0) return new Map<number, any>();

  const entityColumn = entity === "lead" ? activityLogTable.leadId : activityLogTable.dealId;
  const rows = await db
    .selectDistinctOn([entityColumn])
    .from(activityLogTable)
    .where(inArray(entityColumn, ids))
    .orderBy(entityColumn, desc(activityLogTable.createdAt), desc(activityLogTable.id));
  const userIds = rows.flatMap((row) => row.userId == null ? [] : [row.userId]);
  const users = userIds.length > 0
    ? await db.select().from(usersTable).where(inArray(usersTable.id, userIds))
    : [];
  const usersById = new Map(users.map((user) => [user.id, user]));
  const latest = new Map<number, { createdAt: Date; user: (typeof users)[number] | null }>();
  for (const row of rows) {
    const entityId = entity === "lead" ? row.leadId : row.dealId;
    if (entityId != null) latest.set(entityId, {
      createdAt: row.createdAt,
      user: row.userId == null ? null : usersById.get(row.userId) ?? null,
    });
  }
  return latest;
}
