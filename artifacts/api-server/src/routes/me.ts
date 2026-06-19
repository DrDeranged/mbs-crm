import { Router, type IRouter, type Request, type Response } from "express";
import { requireUser, userToApi } from "../lib/authHelpers";

const router: IRouter = Router();

router.get("/me", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  res.json(userToApi(user));
});

export default router;
