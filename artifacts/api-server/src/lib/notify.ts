import { db } from "@workspace/db";
import { notificationsTable, usersTable } from "@workspace/db";
import { eq, or } from "drizzle-orm";
import { sendPushNotification } from "./pushNotifications";

type NotificationType =
  | "lead_assigned"
  | "task_due"
  | "sms_received"
  | "status_changed"
  | "credit_pulled"
  | "application_received"
  | "call_received";

interface NotifyParams {
  userId: number;
  type: NotificationType;
  title: string;
  body: string;
  leadId?: number | null;
}

/**
 * Creates a PERSISTENT in-app notification row, then fires a push as a side-effect.
 * The in-app row is the primary deliverable; push is best-effort.
 */
export async function createNotification(params: NotifyParams): Promise<void> {
  await db.insert(notificationsTable).values({
    userId: params.userId,
    type: params.type,
    title: params.title,
    body: params.body,
    leadId: params.leadId ?? null,
  });

  const user = await db.query.usersTable.findFirst({
    where: eq(usersTable.id, params.userId),
  });
  if (user?.pushToken) {
    sendPushNotification(user.pushToken, params.title, params.body, {
      leadId: params.leadId ?? undefined,
    }).catch(() => {});
  }
}

/** Notify every admin and manager (e.g. a new application arrived). */
export async function notifyAllManagers(
  type: NotificationType,
  title: string,
  body: string,
  leadId?: number | null,
): Promise<void> {
  const managers = await db.query.usersTable.findMany({
    where: or(eq(usersTable.role, "admin"), eq(usersTable.role, "manager")),
  });
  for (const m of managers) {
    await createNotification({ userId: m.id, type, title, body, leadId });
  }
}
