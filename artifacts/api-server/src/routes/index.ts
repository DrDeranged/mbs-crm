import { Router, type IRouter } from "express";
import healthRouter from "./health";
import meRouter from "./me";
import usersRouter from "./users";
import leadsRouter from "./leads";
import notesRouter from "./notes";
import tasksRouter from "./tasks";
import documentsRouter from "./documents";
import activityRouter from "./activity";
import dashboardRouter from "./dashboard";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(meRouter);
router.use(usersRouter);
router.use(leadsRouter);
router.use(notesRouter);
router.use(tasksRouter);
router.use(documentsRouter);
router.use(activityRouter);
router.use(dashboardRouter);
router.use(storageRouter);

export default router;
