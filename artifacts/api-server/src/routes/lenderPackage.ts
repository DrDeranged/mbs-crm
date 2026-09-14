import { Router, type IRouter } from "express";
import { createLenderPackageHandler } from "../lib/lenderPackage";

const router: IRouter = Router();

router.get("/leads/:id/lender-package", createLenderPackageHandler());

export default router;