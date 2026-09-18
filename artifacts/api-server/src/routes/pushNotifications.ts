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

async function preferenceResponse(userId: number) {
  const [settings, rows] = await Promise.all([
    db.select().from(notificationSettingsTable).where(eq(notificationSettingsTable.userId, userId)),
    db.select().from(notificationPreferencesTable).where(eq(notificationPreferencesTable.userId, userId)),
  ]);
  const values = Object.fromEntries(notificationPreferenceEvents.map((event) => [
    event, rows.find((row) => row.event === event)?.enabled ?? false,
  ]));
  return { pushEnabled: settings[0]?.pushEnabled ?? false, events: values };
}

const router: IRouter = Router();

router.post("/admin/push/test", async (req: Request, res: Response): Promise<void> => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }
  await sendTestPush(user.id);
  res.json({ ok: true });
});

router.get("/notifications/vapid-public-key", async (req: Request, res: Response): Promise<void> => {
  const user = await requireUser(req, res);
  if (!user) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) {
    res.status(503).json({ error: "Push notifications are not configured" });
    return;
  }
  res.json({ publicKey });
});

router.get("/notifications/preferences", async (req: Request, res: Response): Promise<void> => {
  const user = await requireUser(req, res);
  if (!user) return;
  res.json(await preferenceResponse(user.id));
});

router.put("/notifications/preferences", async (req: Request, res: Response): Promise<void> => {
  const user = await requireUser(req, res);
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
  res.json(await preferenceResponse(user.id));
});

const upsertSubscription = async (req: Request, res: Response): Promise<void> => {
  const user = await requireUser(req, res);
  if (!user) return;
  const parsed = subscriptionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid push subscription", details: parsed.error.issues });
    return;
  }
  const { endpoint, p256dh, auth, userAgent } = parsed.data;
  const now = new Date();
  await db.insert(pushSubscriptionsTable).values({
    userId: user.id, endpoint, p256dh, auth, userAgent: userAgent ?? null, lastSeenAt: now, failedAt: null,
  }).onConflictDoUpdate({
    target: pushSubscriptionsTable.endpoint,
    set: { userId: user.id, p256dh, auth, userAgent: userAgent ?? null, lastSeenAt: now, failedAt: null },
  });
  res.status(204).send();
};
router.put("/notifications/subscriptions", upsertSubscription);
router.post("/notifications/subscriptions", upsertSubscription);

router.delete("/notifications/subscriptions", async (req: Request, res: Response): Promise<void> => {
  const user = await requireUser(req, res);
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

export default router;