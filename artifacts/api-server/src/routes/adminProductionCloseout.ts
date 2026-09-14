import { Router, type IRouter, type Request, type Response } from "express";
import { requireUser } from "../lib/authHelpers";
import {
  backfillProductionSlugs,
  correctSeededDealOwnership,
  runProductionCloseout,
  seedNewLenders,
} from "../lib/productionMaintenance";
import { seedStarterEmail } from "./email";

const router: IRouter = Router();

// This endpoint deliberately does not wrap the four operations in one
// transaction. Each service owns its transaction/locks; successful earlier
// operations remain committed if a later operation fails.
router.post("/admin/production-closeout", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") {
    res.status(403).json({ error: "Admins only" });
    return;
  }

  const result = await runProductionCloseout({
    ownership: () => correctSeededDealOwnership(user.id),
    slugs: () => backfillProductionSlugs(),
    templates: () => seedStarterEmail(user.id),
    lenders: () => seedNewLenders(),
  });
  res.status(200).json(result);
});

export default router;