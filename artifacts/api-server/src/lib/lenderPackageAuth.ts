import type { Request, Response } from "express";
import { requireUser } from "./authHelpers";

/** Package-only permission; does not authorize ordinary lead/deal/document actions. */
export async function requirePackageUser(
  req: Request,
  res: Response,
  authenticate: typeof requireUser = requireUser,
) {
  const user = await authenticate(req, res);
  if (!user) return null;
  if (user.isActive === false || !["rep", "manager", "admin"].includes(user.role)) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return user;
}
