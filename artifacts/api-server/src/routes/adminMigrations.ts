import { Router, type IRouter, type Request, type Response } from "express";
import { db, getMigrationStatus, runMigrations } from "@workspace/db";
import { requireUser } from "../lib/authHelpers";

function publicReport(report: Awaited<ReturnType<typeof getMigrationStatus>>) {
  return {
    ...report,
    migrations: report.migrations.map(({ sql: _sql, ...migration }) => migration),
  };
}

export function createAdminMigrationsRouter(dependencies: {
  requireUser?: typeof requireUser;
  getMigrationStatus?: typeof getMigrationStatus;
  runMigrations?: typeof runMigrations;
} = {}): IRouter {
  const router: IRouter = Router();
  const requireUserForRoute = dependencies.requireUser ?? requireUser;
  const getMigrationStatusForRoute = dependencies.getMigrationStatus ?? getMigrationStatus;
  const runMigrationsForRoute = dependencies.runMigrations ?? runMigrations;

  router.get("/admin/migrations/status", async (req: Request, res: Response) => {
    const user = await requireUserForRoute(req, res);
    if (!user) return;
    if (user.role !== "admin") {
      res.status(403).json({ error: "Admins only" });
      return;
    }

    try {
      const report = await getMigrationStatusForRoute({ db });
      res.json(publicReport(report));
    } catch (error) {
      res.status(500).json({
        error: "Unable to read migration status",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.post("/admin/migrations/apply", async (req: Request, res: Response) => {
    const user = await requireUserForRoute(req, res);
    if (!user) return;
    if (user.role !== "admin") {
      res.status(403).json({ error: "Admins only" });
      return;
    }

    try {
      const report = await runMigrationsForRoute({ db });
      res.json(publicReport(report));
    } catch (error) {
      res.status(500).json({
        error: "Unable to apply migrations",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}

export default createAdminMigrationsRouter();