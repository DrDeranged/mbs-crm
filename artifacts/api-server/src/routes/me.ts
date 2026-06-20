import { Router, type IRouter, type Request, type Response } from "express";
import { requireUser, userToApi } from "../lib/authHelpers";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/me", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  res.json(userToApi(user));
});

// PUT /api/me/mobile — rep sets their call forwarding mobile number
router.put("/me/mobile", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const { mobileNumber } = req.body as { mobileNumber?: string | null };

  const [updated] = await db
    .update(usersTable)
    .set({ mobileNumber: mobileNumber?.trim() || null, updatedAt: new Date() })
    .where(eq(usersTable.id, user.id))
    .returning();

  res.json(userToApi(updated!));
});

// PUT /api/me/push-token — store or clear Expo push notification token
router.put("/me/push-token", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const { pushToken } = req.body as { pushToken?: string | null };

  await db
    .update(usersTable)
    .set({ pushToken: pushToken?.trim() || null, updatedAt: new Date() })
    .where(eq(usersTable.id, user.id));

  res.status(204).end();
});

export default router;
