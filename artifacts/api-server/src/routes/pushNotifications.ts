import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, notificationPreferencesTable, notificationPreferenceEvents, notificationSettingsTable, pushSubscriptionsTable } from "@workspace/db";
import { requireUser } from "../lib/authHelpers";
import { sendTestPush } from "../lib/push";
import { z } from "zod/v4";

const subscriptionBody = z.object({
  endpoint: z.string().url().max(2048),
  p256dh: z.string().min(1).max(512),
  auth: z.string().min(1).max(512),
  userAgent: z.string().max(1024).nullable().optional(),
}).strict();
const unsubscribeBody = z.object({ endpoint: z.string().url().max(2048) }).strict();
const preferencesBody = z.object({
  pushEnabled: z.boolean().optional(),
  events: z.record(z.enum(notificationPreferenceEvents), z.boolean()).optional(),
}).strict().refine((body) => body.pushEnabled !== undefined || body.events !== undefined, {
  message: "At least one preference must be provided",
});

type PushRouteDependencies = {
  db: any;
  authenticate: typeof requireUser;
};

/**
 * Browser push endpoints are provider URLs, not arbitrary webhook targets.
 * Match host names (rather than URL prefixes) so provider-specific canonical
 * paths and regional subdomains remain valid without allowing lookalikes.
 */
export function isAllowedPushEndpointOrigin(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  return (
    host === "fcm.googleapis.com" ||
    host === "firebaseinstallations.googleapis.com" ||
    host === "push.services.mozilla.com" ||
    host.endsWith(".push.services.mozilla.com") ||
    host === "updates.push.services.mozilla.com" ||
    host === "web.push.apple.com" ||
    host.endsWith(".web.push.apple.com")
  );
}

async function preferenceResponse(database: any, userId: number) {
  const [settings, rows] = await Promise.all([
    database.select().from(notificationSettingsTable).where(eq(notificationSettingsTable.userId, userId)),
    database.select().from(notificationPreferencesTable).where(eq(notificationPreferencesTable.userId, userId)),
  ]);
  const values = Object.fromEntries(notificationPreferenceEvents.map((event) => [
    event, rows.find((row: { event: string; enabled: boolean }) => row.event === event)?.enabled ?? false,
  ]));
  return { pushEnabled: settings[0]?.pushEnabled ?? false, events: values };
}

export function createPushNotificationsRouter(dependencies: PushRouteDependencies): IRouter {
const { db, authenticate } = dependencies;
const router: IRouter = Router();

router.post("/admin/push/test", async (req: Request, res: Response): Promise<void> => {
  const user = await authenticate(req, res);
  if (!user) return;
  if (user.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }
  await sendTestPush(user.id);
  res.json({ ok: true });
});

router.get("/notifications/vapid-public-key", async (req: Request, res: Response): Promise<void> => {
  const user = await authenticate(req, res);
  if (!user) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) {
    res.status(503).json({ error: "Push notifications are not configured" });
    return;
  }
  res.json({ publicKey });
});

router.get("/notifications/preferences", async (req: Request, res: Response): Promise<void> => {
  const user = await authenticate(req, res);
  if (!user) return;
  res.json(await preferenceResponse(db, user.id));
});

router.put("/notifications/preferences", async (req: Request, res: Response): Promise<void> => {
  const user = await authenticate(req, res);
  if (!user) return;
  const parsed = preferencesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid preferences" });
    return;
  }
  const { pushEnabled, events } = parsed.data;
  if (pushEnabled !== undefined) {
    await db.insert(notificationSettingsTable).values({ userId: user.id, pushEnabled })
      .onConflictDoUpdate({ target: notificationSettingsTable.userId, set: { pushEnabled, updatedAt: new Date() } });
  }
  if (events) {
    for (const [event, enabled] of Object.entries(events)) {
      await db.insert(notificationPreferencesTable).values({ userId: user.id, event: event as typeof notificationPreferenceEvents[number], enabled })
        .onConflictDoUpdate({ target: [notificationPreferencesTable.userId, notificationPreferencesTable.event], set: { enabled } });
    }
  }
  res.json(await preferenceResponse(db, user.id));
});

const upsertSubscription = async (req: Request, res: Response): Promise<void> => {
  const user = await authenticate(req, res);
  if (!user) return;
  const parsed = subscriptionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid push subscription", details: parsed.error.issues });
    return;
  }
  const { endpoint, p256dh, auth, userAgent } = parsed.data;
  if (!isAllowedPushEndpointOrigin(endpoint)) {
    res.status(400).json({ error: "Unsupported push service endpoint" });
    return;
  }
  // An endpoint is a browser credential. It must not be silently transferred
  // between accounts when a client happens to present an existing endpoint.
  const existing = await db.select().from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.endpoint, endpoint));
  if (existing[0] && existing[0].userId !== user.id) {
    res.status(409).json({ error: "Push subscription belongs to another user" });
    return;
  }
  const now = new Date();
  await db.insert(pushSubscriptionsTable).values({
    userId: user.id, endpoint, p256dh, auth, userAgent: userAgent ?? null, lastSeenAt: now, failedAt: null,
  }).onConflictDoUpdate({
    target: pushSubscriptionsTable.endpoint,
    // Never update userId on an endpoint conflict. The WHERE predicate makes
    // the credential update conditional on ownership in the same statement,
    // so concurrent first claims cannot transfer the endpoint.
    set: { p256dh, auth, userAgent: userAgent ?? null, lastSeenAt: now, failedAt: null },
    where: eq(pushSubscriptionsTable.userId, user.id),
  });
  const [owner] = await db.select({ userId: pushSubscriptionsTable.userId })
    .from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.endpoint, endpoint));
  if (owner?.userId !== user.id) {
    res.status(409).json({ error: "Push subscription belongs to another user" });
    return;
  }
  res.status(204).send();
};
router.put("/notifications/subscriptions", upsertSubscription);
router.post("/notifications/subscriptions", upsertSubscription);

router.delete("/notifications/subscriptions", async (req: Request, res: Response): Promise<void> => {
  const user = await authenticate(req, res);
  if (!user) return;
  const parsed = unsubscribeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid push subscription endpoint" });
    return;
  }
  await db.delete(pushSubscriptionsTable).where(and(
    eq(pushSubscriptionsTable.userId, user.id),
    eq(pushSubscriptionsTable.endpoint, parsed.data.endpoint),
  ));
  res.status(204).send();
});

return router;
}

const router = createPushNotificationsRouter({ db, authenticate: requireUser });
export { router };
export default router;