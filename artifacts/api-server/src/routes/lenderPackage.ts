import { Router, type IRouter } from "express";
import { createLenderPackageConfigHandler, createLenderPackageHandler, createSelectedLenderPackageHandler } from "../lib/lenderPackage";

const router: IRouter = Router();

router.get("/leads/:id/lender-package", createLenderPackageHandler());
router.post("/leads/:id/lender-package", createSelectedLenderPackageHandler());
router.get("/leads/:id/package-config", createLenderPackageConfigHandler());
router.put("/leads/:id/package-config", createLenderPackageConfigHandler());
router.delete("/leads/:id/package-config", createLenderPackageConfigHandler());

export default router;