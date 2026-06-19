import { Router, type IRouter } from "express";
import healthRouter from "./health";
import meRouter from "./me";
import usersRouter from "./users";
import leadsRouter from "./leads";
import importRouter from "./import";
import notesRouter from "./notes";
import tasksRouter from "./tasks";
import documentsRouter from "./documents";
import activityRouter from "./activity";
import dashboardRouter from "./dashboard";
import storageRouter from "./storage";
import twilioRouter from "./twilio";
import communicationsRouter from "./communications";

const router: IRouter = Router();

router.use(healthRouter);
router.use(meRouter);
router.use(usersRouter);
router.use(importRouter);
router.use(twilioRouter);
router.use(communicationsRouter);
router.use(leadsRouter);
router.use(notesRouter);
router.use(tasksRouter);
router.use(documentsRouter);
router.use(activityRouter);
router.use(dashboardRouter);
router.use(storageRouter);

export default router;
