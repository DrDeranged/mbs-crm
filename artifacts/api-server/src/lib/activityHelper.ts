import { db } from "@workspace/db";
import { activityLogTable, leadsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export async function logActivity(params: {
  userId: number | null;
  leadId?: number | null;
  action: string;
  entityType: string;
  entityId: string | number;
  details?: Record<string, unknown>;
}) {
  await db.insert(activityLogTable).values({
    userId: params.userId,
    leadId: params.leadId ?? null,
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
