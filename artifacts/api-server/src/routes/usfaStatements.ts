import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { db, leadsTable, usfaIntakeLogTable } from "@workspace/db";
import { requireUser } from "../lib/authHelpers";
import { collectUsfaStatementLinks } from "../lib/intake/usfaStatementLinks";

const router = Router();

router.get("/leads/:id/usfa-statements", async (req, res): Promise<void> => {
  const user = await requireUser(req, res);
  if (!user) return;
  const leadId = Number(req.params.id);
  if (!Number.isInteger(leadId) || leadId < 1) {
    res.status(400).json({ error: "Invalid lead ID" });
    return;
  }
  const [lead] = await db.select({
    id: leadsTable.id, leadSource: leadsTable.leadSource, assignedRepId: leadsTable.assignedRepId,
  }).from(leadsTable).where(eq(leadsTable.id, leadId)).limit(1);
  if (!lead || lead.leadSource !== "usfundadvisor") {
    res.status(404).json({ error: "USFA lead not found" });
    return;
  }
  if (user.role === "rep" && lead.assignedRepId !== user.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const receipts = await db.select({ metadata: usfaIntakeLogTable.metadata })
    .from(usfaIntakeLogTable).where(eq(usfaIntakeLogTable.leadId, lead.id))
    .orderBy(desc(usfaIntakeLogTable.id));
  res.setHeader("Cache-Control", "private, no-store");
  res.json(collectUsfaStatementLinks(receipts));
});

export default router;