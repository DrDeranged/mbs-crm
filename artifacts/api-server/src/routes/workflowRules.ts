import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { workflowRulesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { requireUser } from "../lib/authHelpers";

const router: IRouter = Router();

const WorkflowRuleBody = z.object({
  name: z.string().min(1).max(255),
  triggerStatus: z.string().min(1),
  actionType: z.enum(["create_task", "send_notification"]),
  actionConfig: z.record(z.string(), z.unknown()).default({}),
  isActive: z.boolean().optional().default(true),
});

function ruleToApi(rule: typeof workflowRulesTable.$inferSelect) {
  return {
    id: rule.id,
    name: rule.name,
    triggerStatus: rule.triggerStatus,
    actionType: rule.actionType,
    actionConfig: rule.actionConfig,
    isActive: rule.isActive,
    createdBy: rule.createdBy,
    createdAt: rule.createdAt.toISOString(),
  };
}

router.get("/workflow-rules", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") {
    res.status(403).json({ error: "Forbidden: admins only" });
    return;
  }
  const rules = await db.select().from(workflowRulesTable).orderBy(workflowRulesTable.id);
  res.json(rules.map(ruleToApi));
});

router.post("/workflow-rules", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") {
    res.status(403).json({ error: "Forbidden: admins only" });
    return;
  }
  const body = WorkflowRuleBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid body", details: body.error.issues });
    return;
  }
  const [rule] = await db
    .insert(workflowRulesTable)
    .values({ ...body.data, createdBy: user.id })
    .returning();
  res.status(201).json(ruleToApi(rule!));
});

router.put("/workflow-rules/:id", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") {
    res.status(403).json({ error: "Forbidden: admins only" });
    return;
  }
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const body = WorkflowRuleBody.partial().safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid body", details: body.error.issues });
    return;
  }

  const existing = await db.query.workflowRulesTable.findFirst({ where: eq(workflowRulesTable.id, id) });
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const [updated] = await db
    .update(workflowRulesTable)
    .set(body.data)
    .where(eq(workflowRulesTable.id, id))
    .returning();
  res.json(ruleToApi(updated!));
});

router.delete("/workflow-rules/:id", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") {
    res.status(403).json({ error: "Forbidden: admins only" });
    return;
  }
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const existing = await db.query.workflowRulesTable.findFirst({ where: eq(workflowRulesTable.id, id) });
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  await db.delete(workflowRulesTable).where(eq(workflowRulesTable.id, id));
  res.status(204).send();
});

export default router;
