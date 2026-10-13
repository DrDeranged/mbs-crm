import type { Request, Response } from "express";
import { db, dealsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/** The route, never the request body, determines whether the ID is a deal ID. */
export async function resolveLenderPackageOrigin(
  req: Request,
  res: Response,
  database: Pick<typeof db, "query">,
  fromDeal = false,
) {
  const id = Number(req.params["id"]);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({ error: fromDeal ? "Invalid deal ID" : "Invalid lead ID" });
    return null;
  }
  if (!fromDeal) return { leadId: id, deal: null };
  const deal = await database.query.dealsTable.findFirst({ where: eq(dealsTable.id, id) });
  if (!deal) {
    res.status(404).json({ error: "Deal not found" });
    return null;
  }
  if (!deal.leadId) {
    res.status(409).json({ error: "Link this deal to an accessible lead before building a package", reason: "missing_linked_lead" });
    return null;
  }
  // Caller authenticates an active package user; assignment is not a package permission.
  return { leadId: deal.leadId, deal };
}
