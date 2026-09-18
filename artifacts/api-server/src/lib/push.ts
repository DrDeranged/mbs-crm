import webpush from "web-push";
import {
  db,
  notificationPreferencesTable,
  notificationPreferenceEvents,
  notificationSettingsTable,
  pushSubscriptionsTable,
  pushDeliveryAttemptsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "./logger";

export type PushEvent = typeof notificationPreferenceEvents[number];

/** Existing in-app notification names intentionally remain unchanged. */
const eventByNotificationType: Record<string, PushEvent | undefined> = {
  application_received: "new_application",
  lead_assigned: "new_lead_assigned",
  sms_received: "lead_replied",
  submission_status_changed: "submission_status_changed",
  task_due: "task_due",
  stale_lead: "stale_lead",
};

export function inferPushEvent(type: string): PushEvent | undefined {
  return eventByNotificationType[type];
}

export interface PushNotificationInput {
  userId: number;
  type: string;
  title: string;
  body: string;
  leadId?: number | null;
  url?: string;
  event?: PushEvent;
  bypassPreferences?: boolean;
  tag?: string;
}

function configured(): boolean {
  return Boolean(
    process.env.VAPID_SUBJECT &&
      process.env.VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY,
  );
}

export function isPrunablePushError(error: unknown): boolean {
  const statusCode = (error as { statusCode?: number })?.statusCode;
  return statusCode === 404 || statusCode === 410;
}

export function pushPreferenceEnabled(
  pushEnabled: boolean | undefined,
  eventEnabled: boolean | undefined,
  bypassPreferences = false,
): boolean {
  return bypassPreferences || (pushEnabled === true && eventEnabled === true);
}

/**
 * Sends browser push notifications without allowing delivery failures to
 * affect creation of the durable in-app notification.
 */
export async function sendPushForNotification(
  input: PushNotificationInput,
): Promise<void> {
  try {
    const event = input.event ?? inferPushEvent(input.type);
    if (!event || !configured()) return;

    const [settings, preference, subscriptions] = await Promise.all([
      db.select().from(notificationSettingsTable)
        .where(eq(notificationSettingsTable.userId, input.userId)),
      db.select().from(notificationPreferencesTable).where(and(
        eq(notificationPreferencesTable.userId, input.userId),
        eq(notificationPreferencesTable.event, event),
      )),
      db.select().from(pushSubscriptionsTable).where(and(
        eq(pushSubscriptionsTable.userId, input.userId),
      )),
    ]);
    if (!pushPreferenceEnabled(settings[0]?.pushEnabled, preference[0]?.enabled, input.bypassPreferences)) return;
    if (subscriptions.length === 0) return;

    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT!,
      process.env.VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!,
    );
    const payload = JSON.stringify({
      title: input.title,
      body: input.body,
      url: input.url ?? (input.leadId ? `/leads/${input.leadId}` : "/notifications"),
      tag: input.tag ?? `crm-${event}-${input.leadId ?? "general"}`,
      icon: "/favicon-192x192.png",
      data: {
        url: input.url ?? (input.leadId ? `/leads/${input.leadId}` : "/notifications"),
        tag: input.tag ?? `crm-${event}-${input.leadId ?? "general"}`,
      },
    });

    await Promise.allSettled(subscriptions.map(async (subscription) => {
      try {
        const response = await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        }, payload);
        await recordDeliveryAttempt(input.userId, subscription.id, "success");
        try {
          await db.update(pushSubscriptionsTable).set({
            lastSeenAt: new Date(),
            failedAt: null,
          }).where(eq(pushSubscriptionsTable.id, subscription.id));
        } catch (error) {
          logger.warn({ err: error, subscriptionId: subscription.id }, "Unable to update push subscription after delivery");
        }
        return response;
      } catch (error) {
        const statusCode = (error as { statusCode?: number })?.statusCode;
        if (isPrunablePushError(error)) {
          await recordDeliveryAttempt(input.userId, subscription.id, "pruned", `HTTP ${statusCode}`);
          try {
            await db.delete(pushSubscriptionsTable)
              .where(eq(pushSubscriptionsTable.id, subscription.id));
          } catch (deleteError) {
            logger.warn({ err: deleteError, subscriptionId: subscription.id }, "Unable to prune expired push subscription");
          }
          return;
        }
        await recordDeliveryAttempt(input.userId, subscription.id, "failed", statusCode ? `HTTP ${statusCode}` : "delivery failed");
        try {
          await db.update(pushSubscriptionsTable).set({ failedAt: new Date() })
            .where(eq(pushSubscriptionsTable.id, subscription.id));
        } catch (updateError) {
          logger.warn({ err: updateError, subscriptionId: subscription.id }, "Unable to mark failed push subscription");
        }
        logger.warn({ err: error, subscriptionId: subscription.id }, "Browser push delivery failed");
        return undefined;
      }
    }));
  } catch (error) {
    logger.warn({ err: error, userId: input.userId }, "Browser push notification skipped after error");
  }
}

async function recordDeliveryAttempt(
  userId: number,
  subscriptionId: number,
  status: "success" | "failed" | "pruned",
  errorMessage?: string,
): Promise<void> {
  try {
    await db.insert(pushDeliveryAttemptsTable).values({ userId, subscriptionId, status, errorMessage });
  } catch (error) {
    logger.warn({ err: error, userId, subscriptionId, status }, "Unable to record push delivery attempt");
  }
}

export function sendTestPush(userId: number): Promise<void> {
  return sendPushForNotification({
    userId,
    type: "push_test",
    event: "task_due",
    title: "Test push notification",
    body: "Your browser push notifications are working.",
    url: "/system-health",
    tag: "crm-test-push",
    bypassPreferences: true,
  });
}