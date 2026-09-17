import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { usersTable, retiredRepSlugsTable, userIdentitiesTable, adminAuditLogTable, activityLogTable } from "@workspace/db";
import { eq, and, inArray, ne, sql } from "drizzle-orm";
import { requireUser, userToApi } from "../lib/authHelpers";
import { logActivity } from "../lib/activityHelper";
import { ListUsersQueryParams, UpdateUserParams, UpdateUserBody } from "@workspace/api-zod";
import { backfillProductionSlugs, ProductionMaintenanceError } from "../lib/productionMaintenance";
import { retireRepSlug } from "./repPublic";
import { isSlugRetirementAuthorized, requiresSlugRetirement } from "../lib/repSlugPolicy";
import applicationFormRouter from "./applicationForm";

const router: IRouter = Router();

function parseRetirementBody(body: unknown): { newSlug: string; displayName?: string | null } | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  // `slug`/`name` are accepted as compatibility aliases for administrative
  // callers that use the database field names; OpenAPI documents the clearer
  // newSlug/displayName names.
  const newSlug = value.newSlug ?? value.slug;
  const displayName = value.displayName ?? value.name;
  if (typeof newSlug !== "string") return null;
  if (displayName !== undefined && displayName !== null && typeof displayName !== "string") return null;
  return {
    newSlug,
    displayName: displayName as string | null | undefined,
  };
}

async function handleRetireSlug(req: Request, res: Response, userId: number) {
  const actor = await requireUser(req, res);
  if (!actor) return;
  if (!isSlugRetirementAuthorized(actor)) {
    res.status(403).json({ error: "Admins only" });
    return;
  }

  const body = parseRetirementBody(req.body);
  if (!body) {
    res.status(400).json({ error: "newSlug is required and displayName must be a string or null" });
    return;
  }

  try {
    const updated = await retireRepSlug({ userId, ...body });
    res.json(userToApi(updated));
  } catch (error) {
    const status = typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status: unknown }).status)
      : 500;
    if (status >= 400 && status < 500) {
      res.status(status).json({ error: error instanceof Error ? error.message : "Unable to retire slug" });
      return;
    }
    throw error;
  }
}

// The user-scoped route is convenient for the existing admin user table.
router.post("/admin/users/:id/retire-slug", async (req: Request, res: Response) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }
  await handleRetireSlug(req, res, userId);
});

// Generic form for administrative tooling that already has a user id in its
// payload. Both routes share the exact transactional implementation.
router.post("/admin/rep-slugs/retire", async (req: Request, res: Response) => {
  const userId = Number((req.body as Record<string, unknown> | null)?.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    res.status(400).json({ error: "Invalid userId" });
    return;
  }
  await handleRetireSlug(req, res, userId);
});

router.post("/admin/users/backfill-slugs", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") {
    res.status(403).json({ error: "Admins only" });
    return;
  }

  try {
    res.json(await backfillProductionSlugs());
  } catch (error) {
    if (error instanceof ProductionMaintenanceError) {
      res.status(409).json({ error: error.message, ...error.details });
      return;
    }
    throw error;
  }
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

router.post("/admin/users/merge", async (req: Request, res: Response) => {
  const actor = await requireUser(req, res);
  if (!actor) return;
  if (actor.role !== "admin") {
    res.status(403).json({ error: "Admins only" });
    return;
  }
  const sourceId = Number(req.body?.sourceUserId);
  const targetId = Number(req.body?.targetUserId);
  const confirmReassignment = req.body?.confirmReassignment === true;
  if (!Number.isInteger(sourceId) || !Number.isInteger(targetId) || sourceId <= 0 || targetId <= 0 || sourceId === targetId) {
    res.status(400).json({ error: "Valid, different sourceUserId and targetUserId are required" });
    return;
  }

  try {
    const result = await db.transaction(async (tx: any) => {
      // Lock in ID order so concurrent inverse merges cannot deadlock.
      const lockIds = sourceId < targetId ? [sourceId, targetId] : [targetId, sourceId];
      const locked = await tx.select().from(usersTable).where(inArray(usersTable.id, lockIds)).for("update");
      const source = locked.find((row: any) => row.id === sourceId);
      const target = locked.find((row: any) => row.id === targetId);
      if (!source || !target) throw Object.assign(new Error("Source or target user not found"), { status: 404 });
      if (source.role !== "pending") throw Object.assign(new Error("Source user must have the pending role"), { status: 409 });
      if (!target.isActive) throw Object.assign(new Error("Target user must be active"), { status: 409 });
      if (!source.isActive) throw Object.assign(new Error("Source user is already inactive"), { status: 409 });

      const tables = [
        ["leads", "assigned_rep_id"], ["deals", "assigned_to"], ["notes", "user_id"],
        ["tasks", "user_id"], ["documents", "user_id"], ["activity_log", "user_id"],
        ["lender_submissions", "sent_by"], ["lender_submission_deliveries", "sent_by"],
        ["collateral_renders", "user_id"], ["lead_status_history", "changed_by_user_id"],
        ["lead_assignment_history", "changed_by_user_id"], ["lead_assignment_history", "from_rep_id"],
        ["lead_assignment_history", "to_rep_id"],
      ] as const;
      const counts: Record<string, number> = {};
      for (const [table, column] of tables) {
        const rows = await tx.execute(sql.raw(`SELECT count(*)::int AS count FROM ${table} WHERE ${column} = ${sourceId}`));
        counts[`${table}.${column}`] = Number((rows.rows?.[0] as any)?.count ?? 0);
      }
      const totalRecords = Object.values(counts).reduce((sum, count) => sum + count, 0);
      if (totalRecords > 0 && !confirmReassignment) {
        const error = Object.assign(new Error("Reassignment confirmation is required"), { status: 409 });
        (error as any).details = { code: "CONFIRM_REASSIGNMENT_REQUIRED", counts };
        throw error;
      }

      // Identical cached renders represent the same durable file; retain the target row,
      // then move every non-colliding render.
      await tx.execute(sql`DELETE FROM collateral_renders source
        USING collateral_renders target
        WHERE source.user_id = ${sourceId} AND target.user_id = ${targetId}
          AND source.template_id = target.template_id AND source.sha256 = target.sha256
          AND source.id <> target.id`);
      for (const [table, column] of tables) {
        await tx.execute(sql.raw(`UPDATE ${table} SET ${column} = ${targetId} WHERE ${column} = ${sourceId}`));
      }

      if (source.slug) {
        if (!target.slug) throw Object.assign(new Error("Target must have a slug before a slotted user can be merged"), { status: 409 });
        await tx.insert(retiredRepSlugsTable).values({
          slug: source.slug,
          replacementSlug: target.slug,
          userId: target.id,
        }).onConflictDoNothing({ target: retiredRepSlugsTable.slug });
      }

      await tx.execute(sql`UPDATE user_identities
        SET user_id = ${targetId}
        WHERE user_id = ${sourceId}
          AND clerk_id NOT IN (SELECT clerk_id FROM user_identities WHERE user_id = ${targetId})`);
      await tx.delete(userIdentitiesTable).where(eq(userIdentitiesTable.userId, sourceId));
      await tx.update(usersTable).set({
        slug: null,
        isActive: false,
        mergedInto: targetId,
        updatedAt: new Date(),
      }).where(eq(usersTable.id, sourceId));

      const details = { sourceUserId: sourceId, targetUserId: targetId, counts, sourceEmail: source.email };
      await tx.insert(activityLogTable).values({
        userId: targetId,
        action: "user_merged",
        entityType: "user",
        entityId: String(targetId),
        details,
      });
      await tx.insert(adminAuditLogTable).values({
        actorUserId: actor.id,
        action: "merge_user",
        entityType: "user",
        entityId: String(targetId),
        details,
      });
      return { sourceUserId: sourceId, targetUserId: targetId, counts, reassigned: totalRecords };
    });
    res.json(result);
  } catch (error) {
    const status = typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status: unknown }).status) : 500;
    if (status >= 400 && status < 500) {
      res.status(status).json({
        error: error instanceof Error ? error.message : "Unable to merge users",
        ...((error as any).details ?? {}),
      });
      return;
    }
    throw error;
  }
});

router.use(applicationFormRouter);

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
  if (requiresSlugRetirement(existing.slug, body.data.slug)) {
    res.status(409).json({
      error: "Representative slugs must be changed through the retirement endpoint so the old slug remains permanently reserved.",
      code: "SLUG_RETIREMENT_REQUIRED",
    });
    return;
  }
  if (body.data.slug !== undefined && body.data.slug !== existing.slug) {
    const activeTarget = await db.query.usersTable.findFirst({
      where: and(eq(usersTable.slug, body.data.slug), ne(usersTable.id, existing.id)),
    });
    if (activeTarget) {
      res.status(409).json({
        error: "This slug is already assigned to an active or inactive user.",
        code: "SLUG_IN_USE",
      });
      return;
    }
    const retired = await db.query.retiredRepSlugsTable.findFirst({
      where: eq(retiredRepSlugsTable.slug, body.data.slug),
    });
    if (retired) {
      res.status(409).json({
        error: "This slug is permanently reserved because it was retired.",
        code: "SLUG_RETIRED",
      });
      return;
    }
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
