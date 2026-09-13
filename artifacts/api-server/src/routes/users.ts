import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { usersTable, activityLogTable } from "@workspace/db";
import { eq, and, inArray, notInArray } from "drizzle-orm";
import { requireUser, userToApi } from "../lib/authHelpers";
import { logActivity } from "../lib/activityHelper";
import { ListUsersQueryParams, UpdateUserParams, UpdateUserBody } from "@workspace/api-zod";

const router: IRouter = Router();

const PRODUCTION_SLUG_BACKFILL = [
  { id: 7, slug: "arslan", duplicateForReview: false },
  { id: 12, slug: "arslan-d2", duplicateForReview: true },
  { id: 16, slug: "nate", duplicateForReview: false },
] as const;

router.post("/admin/users/backfill-slugs", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") {
    res.status(403).json({ error: "Admins only" });
    return;
  }

  const targetIds = PRODUCTION_SLUG_BACKFILL.map((target) => target.id);
  const targetSlugs = PRODUCTION_SLUG_BACKFILL.map((target) => target.slug);
  const targets = await db.query.usersTable.findMany({
    where: inArray(usersTable.id, targetIds),
  });
  const targetsById = new Map(targets.map((target) => [target.id, target]));
  const missingUserIds = targetIds.filter((id) => !targetsById.has(id));

  if (missingUserIds.length > 0) {
    res.status(409).json({
      error: "Slug backfill aborted because one or more target users do not exist",
      missingUserIds,
    });
    return;
  }

  const conflictingUsers = await db.query.usersTable.findMany({
    where: and(
      inArray(usersTable.slug, targetSlugs),
      notInArray(usersTable.id, targetIds),
    ),
  });
  if (conflictingUsers.length > 0) {
    res.status(409).json({
      error: "Slug backfill aborted because one or more target slugs are already assigned",
      conflicts: conflictingUsers.map((conflict) => ({
        userId: conflict.id,
        slug: conflict.slug,
      })),
    });
    return;
  }

  const results = await db.transaction(async (tx) => {
    const summary = [];
    for (const target of PRODUCTION_SLUG_BACKFILL) {
      const existing = targetsById.get(target.id)!;
      const changed = existing.slug !== target.slug;
      if (changed) {
        await tx
          .update(usersTable)
          .set({ slug: target.slug, updatedAt: new Date() })
          .where(eq(usersTable.id, target.id));
      }
      summary.push({
        userId: target.id,
        previousSlug: existing.slug,
        slug: target.slug,
        changed,
        duplicateForReview: target.duplicateForReview,
      });
    }
    return summary;
  });

  const changed = results.filter((result) => result.changed).length;
  res.json({
    changed,
    unchanged: results.length - changed,
    users: results,
  });
});

router.get("/users", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin" && user.role !== "manager") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const params = ListUsersQueryParams.safeParse(req.query);
  const users = await db.query.usersTable.findMany({
    where: params.success
      ? and(
          params.data.role ? eq(usersTable.role, params.data.role) : undefined,
          params.data.isActive === undefined ? undefined : eq(usersTable.isActive, params.data.isActive),
        )
      : undefined,
    orderBy: (t, { asc }) => [asc(t.name)],
  });

  res.json(users.map(userToApi));
});

router.put("/users/:id", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") {
    res.status(403).json({ error: "Forbidden: admin only" });
    return;
  }

  const params = UpdateUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const body = UpdateUserBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }

  const existing = await db.query.usersTable.findFirst({ where: eq(usersTable.id, params.data.id) });
  if (!existing) { res.status(404).json({ error: "User not found" }); return; }
  if (body.data.slug && body.data.slug !== existing.slug) {
    const used = await db.query.activityLogTable.findFirst({
      where: (a, { and, eq }) => and(eq(a.entityType, "rep_slug_visit"), eq(a.entityId, existing.slug ?? "")),
    });
    if (used) { res.status(409).json({ error: "This slug is locked because it has served traffic." }); return; }
  }
  const [updated] = await db
    .update(usersTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(eq(usersTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  await logActivity({
    userId: user.id,
    action: "updated",
    entityType: "user",
    entityId: params.data.id,
    details: { fields: Object.keys(body.data) },
  });

  res.json(userToApi(updated));
});

// PUT /api/users/:id/push-token — own-user push token update
router.put("/users/:id/push-token", async (req: Request, res: Response) => {
  const user = await requireUser(req, res, { allowPending: true });
  if (!user) return;

  const targetId = parseInt(req.params["id"] as string, 10);
  if (isNaN(targetId)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  if (user.id !== targetId) {
    res.status(403).json({ error: "Forbidden: can only update own push token" });
    return;
  }

  const { pushToken } = req.body as { pushToken?: string | null };

  await db
    .update(usersTable)
    .set({ pushToken: pushToken?.trim() || null, updatedAt: new Date() })
    .where(eq(usersTable.id, user.id));

  res.status(204).end();
});

export default router;
