import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { tasksTable, leadsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireUser, userToApi } from "../lib/authHelpers";
import { logActivity } from "../lib/activityHelper";
import { ListTasksParams, CreateTaskParams, CreateTaskBody, UpdateTaskParams, UpdateTaskBody } from "@workspace/api-zod";

const router: IRouter = Router();

function taskToApi(task: typeof tasksTable.$inferSelect, assignedUser?: any) {
  return {
    id: task.id,
    leadId: task.leadId,
    userId: task.userId,
    assignedUser: assignedUser ? userToApi(assignedUser) : null,
    title: task.title,
    description: task.description ?? null,
    dueDate: task.dueDate ?? null,
    isCompleted: task.isCompleted,
    completedAt: task.completedAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
  };
}

router.get("/leads/:id/tasks", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const params = ListTasksParams.safeParse(req.params);
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

  const tasks = await db.query.tasksTable.findMany({
    where: eq(tasksTable.leadId, params.data.id),
    orderBy: (t, { asc }) => [asc(t.isCompleted), asc(t.dueDate)],
    with: { assignedUser: true },
  });

  res.json(tasks.map((t) => taskToApi(t, (t as any).assignedUser)));
});

router.post("/leads/:id/tasks", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const params = CreateTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const body = CreateTaskBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid body" });
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

  const assignedUserId = body.data.assignedUserId ?? user.id;
  const [task] = await db.insert(tasksTable).values({
    leadId: params.data.id,
    userId: assignedUserId,
    title: body.data.title,
    description: body.data.description ?? null,
    dueDate: body.data.dueDate?.toISOString().split("T")[0] ?? null,
    isCompleted: false,
  }).returning();

  await logActivity({
    userId: user.id,
    leadId: params.data.id,
    action: "task_created",
    entityType: "task",
    entityId: task.id,
    details: { title: task.title },
  });

  res.status(201).json(taskToApi(task, user));
});

router.put("/tasks/:taskId", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const params = UpdateTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const body = UpdateTaskBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }

  const existing = await db.query.tasksTable.findFirst({ where: eq(tasksTable.id, params.data.taskId) });
  if (!existing) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  if (user.role === "rep" && existing.userId !== user.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const now = new Date();
  const completedAtDate: Date | null =
    body.data.isCompleted && !existing.isCompleted ? now :
    body.data.isCompleted === false ? null :
    existing.completedAt;

  const { dueDate: dueDateRaw, ...restBodyData } = body.data;
  const [updated] = await db
    .update(tasksTable)
    .set({
      ...restBodyData,
      dueDate: dueDateRaw !== undefined ? (dueDateRaw?.toISOString().split("T")[0] ?? null) : undefined,
      completedAt: completedAtDate,
      updatedAt: now,
    })
    .where(eq(tasksTable.id, params.data.taskId))
    .returning();

  if (body.data.isCompleted && !existing.isCompleted) {
    await logActivity({
      userId: user.id,
      leadId: existing.leadId,
      action: "task_completed",
      entityType: "task",
      entityId: existing.id,
      details: { title: existing.title },
    });
  }

  res.json(taskToApi(updated, null));
});

export default router;
