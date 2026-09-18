import { Router, type IRouter } from "express";
import { db, pushSubscriptionsTable, pushDeliveryAttemptsTable } from "@workspace/db";
import { desc, eq, isNull, sql } from "drizzle-orm";
import { requireUser } from "../lib/authHelpers";

type HealthDependencies = { db: any; authenticate: typeof requireUser };

export function createAdminPushHealthRouter({ db: database, authenticate }: HealthDependencies): IRouter {
const router: IRouter = Router();

// This route intentionally lives outside bootCriticalRouter: Clerk must be
// initialized before admin identity and role checks are attempted.
router.get("/admin/push/health", async (req, res) => {
  const user = await authenticate(req, res);
  if (!user) return;
  if (user.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }
  const result = {
    configured: Boolean(process.env.VAPID_SUBJECT && process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
    activeSubscriptions: 0,
    totalSubscriptions: 0,
    lastSuccessfulSendAt: null as string | null,
  };
  try {
    const [active, total, lastSuccess] = await Promise.all([
      database.select({ count: sql<number>`count(*)` }).from(pushSubscriptionsTable)
        .where(isNull(pushSubscriptionsTable.failedAt)),
      database.select({ count: sql<number>`count(*)` }).from(pushSubscriptionsTable),
      database.select({ attemptedAt: pushDeliveryAttemptsTable.attemptedAt })
        .from(pushDeliveryAttemptsTable)
        .where(eq(pushDeliveryAttemptsTable.status, "success"))
        .orderBy(desc(pushDeliveryAttemptsTable.attemptedAt))
        .limit(1),
    ]);
    result.activeSubscriptions = Number(active[0]?.count ?? 0);
    result.totalSubscriptions = Number(total[0]?.count ?? 0);
    result.lastSuccessfulSendAt = lastSuccess[0]?.attemptedAt?.toISOString() ?? null;
  } catch {
    // Keep counts at safe zero/null when an older schema lacks the ledger.
  }
  res.json(result);
});

return router;
}

const router = createAdminPushHealthRouter({ db, authenticate: requireUser });
export default router;