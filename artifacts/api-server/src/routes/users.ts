import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { usersTable, retiredRepSlugsTable } from "@workspace/db";
import { eq, and, inArray, ne } from "drizzle-orm";
import { requireUser, userToApi } from "../lib/authHelpers";
import { logActivity } from "../lib/activityHelper";
import { ListUsersQueryParams, UpdateUserParams, UpdateUserBody } from "@workspace/api-zod";
import { backfillProductionSlugs, ProductionMaintenanceError } from "../lib/productionMaintenance";
import { retireRepSlug } from "./repPublic";
import { isSlugRetirementAuthorized, requiresSlugRetirement } from "../lib/repSlugPolicy";

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
