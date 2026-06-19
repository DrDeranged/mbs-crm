import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { activityLogTable, leadsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireUser, userToApi } from "../lib/authHelpers";
import { ListLeadActivityParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/leads/:id/activity", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const params = ListLeadActivityParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, params.data.id) });
  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  if (user.role === "rep" && lead.assignedRepId !== user.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const entries = await db.query.activityLogTable.findMany({
    where: eq(activityLogTable.leadId, params.data.id),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    limit: 50,
    with: { user: true },
  });

  res.json(entries.map((a) => ({
    id: a.id,
    userId: a.userId ?? null,
    user: (a as any).user ? userToApi((a as any).user) : null,
    action: a.action,
    entityType: a.entityType,
    entityId: a.entityId,
    details: (a.details as Record<string, unknown>) ?? {},
    createdAt: a.createdAt.toISOString(),
  })));
});

export default router;
