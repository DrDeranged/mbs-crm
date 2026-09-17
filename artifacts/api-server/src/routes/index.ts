import { getAuth } from "@clerk/express";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import healthRouter from "./health";
import meRouter from "./me";
import usersRouter from "./users";
import leadsRouter from "./leads";
import importRouter from "./import";
import notesRouter from "./notes";
import tasksRouter from "./tasks";
import documentsRouter from "./documents";
import lenderPackageRouter from "./lenderPackage";
import activityRouter from "./activity";
import dashboardRouter from "./dashboard";
import storageRouter from "./storage";
import twilioRouter from "./twilio";
import communicationsRouter from "./communications";
import emailRouter from "./email";
import dripRouter from "./drip";
import sendgridRouter from "./sendgrid";
import analyticsRouter from "./analytics";
import lendersRouter from "./lenders";
import flyerTemplatesRouter from "./flyer-templates";
import flyersRouter from "./flyers";
import applicationsRouter from "./applications";
import creditRouter from "./credit";
import workflowRulesRouter from "./workflowRules";
import notificationsRouter from "./notifications";
import aiRouter from "./ai";
import settingsRouter from "./settings";
import adminErrorsRouter from "./adminErrors";
import adminBackupRouter from "./adminBackup";
import piiAccessLogRouter from "./piiAccessLog";
import adminGovernanceRouter from "./adminGovernance";
import repPublicRouter from "./repPublic";
import dealsRouter from "./deals";
import adminProductionCloseoutRouter from "./adminProductionCloseout";
import adminMigrationsRouter from "./adminMigrations";
import adminUsfaIntakeRouter from "./adminUsfaIntake";
import usfaIntakeRouter from "./usfaIntake";
import usfaPrefillRouter from "./usfaPrefill";
import collateralRouter from "./collateral";

const router: IRouter = Router();

/**
 * These are the only unauthenticated state-changing API endpoints. Public
 * form intake is rate limited and validates its body; provider callbacks must
 * independently reject an invalid provider signature before they write.
 */
export const PUBLIC_MUTATION_PATHS = new Set([
  "/applications/submit",
  "/leads/capture",
  "/sendgrid/webhook",
  "/intake/usfa",
  "/twilio/voice",
  "/twilio/voice/inbound",
  "/twilio/voice/status",
  "/twilio/voice/recording",
  "/twilio/sms/inbound",
  "/twilio/sms/status",
]);

type IsAuthenticated = (req: Request) => boolean;

/**
 * Defense in depth for every router registered below. Route handlers retain
 * their authorization and ownership checks; this gate prevents a future
 * mutation registration from accidentally becoming public.
 */
export function createMutationAuthenticationGuard(
  isAuthenticated: IsAuthenticated = (req) => Boolean(getAuth(req).userId),
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (
      !["POST", "PUT", "PATCH", "DELETE"].includes(req.method) ||
      PUBLIC_MUTATION_PATHS.has(req.path)
    ) {
      next();
      return;
    }

    if (!isAuthenticated(req)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  };
}

export const mutationAuthenticationGuard = createMutationAuthenticationGuard();
router.use(mutationAuthenticationGuard);

router.use(healthRouter);
router.use(repPublicRouter);
router.use(dealsRouter);
router.use(adminProductionCloseoutRouter);
router.use(adminMigrationsRouter);
router.use(adminUsfaIntakeRouter);
router.use(usfaIntakeRouter);
router.use(usfaPrefillRouter);
router.use(meRouter);
router.use(usersRouter);
router.use(importRouter);
router.use(twilioRouter);
router.use(communicationsRouter);
router.use(emailRouter);
router.use(dripRouter);
router.use(sendgridRouter);
router.use(leadsRouter);
router.use(notesRouter);
router.use(tasksRouter);
router.use(documentsRouter);
router.use(lenderPackageRouter);
router.use(activityRouter);
router.use(dashboardRouter);
router.use(analyticsRouter);
router.use(lendersRouter);
router.use(flyerTemplatesRouter);
router.use(flyersRouter);
router.use(applicationsRouter);
router.use(creditRouter);
router.use(workflowRulesRouter);
router.use(notificationsRouter);
router.use(aiRouter);
router.use(settingsRouter);
router.use(adminErrorsRouter);
router.use(adminBackupRouter);
router.use(piiAccessLogRouter);
router.use(adminGovernanceRouter);
router.use(storageRouter);
router.use(collateralRouter);

export default router;
