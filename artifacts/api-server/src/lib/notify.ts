import { db } from "@workspace/db";
import { notificationsTable, usersTable } from "@workspace/db";
import { eq, or } from "drizzle-orm";
import { sendPushForNotification, type PushEvent } from "./push";
import { sendPushNotification } from "./pushNotifications";

type NotificationType =
  | "lead_assigned"
  | "task_due"
  | "sms_received"
  | "status_changed"
  | "credit_pulled"
  | "application_received"
  | "call_received"
  | "renewal_opportunity";

interface NotifyParams {
  userId: number;
  type: NotificationType;
  title: string;
  body: string;
  leadId?: number | null;
  event?: PushEvent;
}

export type NotificationExecutor = Pick<typeof db, "insert">;
export type NotificationChannels = {
  expo: () => Promise<void>;
  web: () => Promise<void>;
};

export async function insertNotification(
  executor: NotificationExecutor,
  params: NotifyParams,
): Promise<{ id: number }> {
  const [row] = await executor.insert(notificationsTable).values({
    userId: params.userId, type: params.type, title: params.title, body: params.body,
    leadId: params.leadId ?? null,
  }).returning({ id: notificationsTable.id });
  return row;
}

/** Delivers already-persisted notification channels. Call after commit. */
export async function deliverNotification(
  params: NotifyParams,
  channels?: NotificationChannels,
): Promise<void> {
  const selected = channels ?? {
    expo: async () => {
      const [recipient] = await db.select({ pushToken: usersTable.pushToken })
        .from(usersTable).where(eq(usersTable.id, params.userId)).limit(1);
      if (recipient?.pushToken) {
        await sendPushNotification(recipient.pushToken, params.title, params.body, {
          type: params.type, leadId: params.leadId ?? null,
        });
      }
    },
    web: () => sendPushForNotification(params),
  };
  void Promise.allSettled([
    selected.expo(),
    selected.web(),
  ]);
}

/**
 * Creates a PERSISTENT in-app notification row, then fires a push as a side-effect.
 * The in-app row is the primary deliverable; push is best-effort.
 */
export async function createNotification(params: NotifyParams): Promise<void> {
  await insertNotification(db, params);
  await deliverNotification(params);
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

/** Notify administrators about an integration event requiring review. */
export async function notifyAllAdmins(
  type: NotificationType,
  title: string,
  body: string,
  leadId?: number | null,
): Promise<void> {
  const admins = await db.query.usersTable.findMany({
    where: eq(usersTable.role, "admin"),
  });
  for (const admin of admins) {
    await createNotification({ userId: admin.id, type, title, body, leadId });
  }
}
