import { Router, type IRouter, type Request, type Response } from "express";
import { requireUser, userToApi } from "../lib/authHelpers";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";

const router: IRouter = Router();
const optionalStringBody = z.object({
  mobileNumber: z.string().nullable().optional(),
}).strict();
const optionalPushTokenBody = z.object({
  pushToken: z.string().nullable().optional(),
}).strict();

function invalidInput(res: Response, parsed: z.ZodSafeParseError<unknown>): void {
  const field = parsed.error.issues[0]?.path.join(".") || "body";
  res.status(400).json({ error: `Invalid ${field}` });
}

router.get("/me", async (req: Request, res: Response) => {
  const user = await requireUser(req, res, { allowPending: true });
  if (!user) return;
  res.json(userToApi(user));
});

// PUT /api/me/mobile — rep sets their call forwarding mobile number
router.put("/me/mobile", async (req: Request, res: Response) => {
  const user = await requireUser(req, res, { allowPending: true });
  if (!user) return;

  const body = optionalStringBody.safeParse(req.body);
  if (!body.success) return invalidInput(res, body);
  const { mobileNumber } = body.data;

  const [updated] = await db
    .update(usersTable)
    .set({ mobileNumber: mobileNumber?.trim() || null, updatedAt: new Date() })
    .where(eq(usersTable.id, user.id))
    .returning();

  res.json(userToApi(updated!));
});

// PUT /api/me/push-token — store or clear Expo push notification token
router.put("/me/push-token", async (req: Request, res: Response) => {
  const user = await requireUser(req, res, { allowPending: true });
  if (!user) return;

  const body = optionalPushTokenBody.safeParse(req.body);
  if (!body.success) return invalidInput(res, body);
  const { pushToken } = body.data;

  await db
    .update(usersTable)
    .set({ pushToken: pushToken?.trim() || null, updatedAt: new Date() })
    .where(eq(usersTable.id, user.id));

  res.status(204).end();
});

export default router;
