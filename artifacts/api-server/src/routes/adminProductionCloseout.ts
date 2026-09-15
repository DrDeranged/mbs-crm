import { Router, type IRouter, type Request, type Response } from "express";
import { requireUser } from "../lib/authHelpers";
import {
  backfillProductionSlugs,
  correctSeededDealOwnership,
  runProductionCloseout,
  seedNewLenders,
  type LenderSeedOperationResult,
} from "../lib/productionMaintenance";
import { seedStarterEmail } from "./email";
import type { MaintenanceRequireUser } from "./lenders";

// This endpoint deliberately does not wrap the four operations in one
// transaction. Each service owns its transaction/locks; successful earlier
// operations remain committed if a later operation fails.
export function createAdminProductionCloseoutRouter(dependencies: {
  requireUser?: MaintenanceRequireUser;
  runProductionCloseout?: typeof runProductionCloseout;
  correctSeededDealOwnership?: typeof correctSeededDealOwnership;
  backfillProductionSlugs?: typeof backfillProductionSlugs;
  seedStarterEmail?: typeof seedStarterEmail;
  seedNewLenders?: () => Promise<LenderSeedOperationResult>;
} = {}): IRouter {
  const router: IRouter = Router();
  const requireUserForRoute = dependencies.requireUser ?? requireUser;
  const runProductionCloseoutForRoute = dependencies.runProductionCloseout ?? runProductionCloseout;
  const correctOwnershipForRoute = dependencies.correctSeededDealOwnership ?? correctSeededDealOwnership;
  const backfillSlugsForRoute = dependencies.backfillProductionSlugs ?? backfillProductionSlugs;
  const seedStarterEmailForRoute = dependencies.seedStarterEmail ?? seedStarterEmail;
  const seedNewLendersForRoute = dependencies.seedNewLenders ?? seedNewLenders;

  router.post("/admin/production-closeout", async (req: Request, res: Response) => {
    const user = await requireUserForRoute(req, res);
    if (!user) return;
    if (user.role !== "admin") {
      res.status(403).json({ error: "Admins only" });
      return;
    }

    try {
      const result = await runProductionCloseoutForRoute({
        ownership: () => correctOwnershipForRoute(user.id),
        slugs: () => backfillSlugsForRoute(),
        templates: () => seedStarterEmailForRoute(user.id),
        lenders: () => seedNewLendersForRoute(),
      });
      res.status(200).json(result);
    } catch (error) {
      console.error("Failed to run production closeout", error);
      res.status(500).json({ error: "Unable to run production closeout" });
    }
  });

  return router;
}

export default createAdminProductionCloseoutRouter();