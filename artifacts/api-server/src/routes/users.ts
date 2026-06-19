import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireUser, userToApi } from "../lib/authHelpers";
import { logActivity } from "../lib/activityHelper";
import { ListUsersQueryParams, UpdateUserParams, UpdateUserBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/users", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin" && user.role !== "manager") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const params = ListUsersQueryParams.safeParse(req.query);
  const users = await db.query.usersTable.findMany({
    where: params.success && params.data.role ? eq(usersTable.role, params.data.role) : undefined,
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

export default router;
