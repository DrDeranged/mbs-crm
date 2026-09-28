import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { tasksTable, leadsTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { usersTable } from "@workspace/db";
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

type TaskRouteDependencies = {
  database?: typeof db;
  authenticate?: typeof requireUser;
  recordActivity?: typeof logActivity;
};

async function findAuthorizedAssignee(
  database: typeof db,
  actor: { id: number; role: string },
  lead: { assignedRepId: number | null },
  assignedUserId: number,
) {
  const target = await database.query.usersTable.findFirst({
    where: and(
      eq(usersTable.id, assignedUserId),
      eq(usersTable.isActive, true),
      isNull(usersTable.mergedInto),
    ),
  });
  if (!target) return null;
  if (actor.role === "manager" || actor.role === "admin") return target;
  if (
    actor.role === "rep" &&
    (assignedUserId === actor.id || assignedUserId === lead.assignedRepId)
  ) return target;
  return null;
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

export function createCreateTaskHandler(dependencies: TaskRouteDependencies = {}) {
  const database = dependencies.database ?? db;
  const authenticate = dependencies.authenticate ?? requireUser;
  const recordActivity = dependencies.recordActivity ?? logActivity;

  return async (req: Request, res: Response): Promise<void> => {
    const user = await authenticate(req, res);
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

    const lead = await database.query.leadsTable.findFirst({ where: eq(leadsTable.id, params.data.id) });
    if (!lead) {
      res.status(404).json({ error: "Lead not found" });
      return;
    }
    if (user.role === "rep" && lead.assignedRepId !== user.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const assignedUserId = body.data.assignedUserId ?? user.id;
    const assignedUser = await findAuthorizedAssignee(database, user, lead, assignedUserId);
    if (!assignedUser) {
      res.status(403).json({ error: "Forbidden: cannot assign task to this user" });
      return;
    }

    const [task] = await database.insert(tasksTable).values({
      leadId: params.data.id,
      userId: assignedUserId,
      title: body.data.title,
      description: body.data.description ?? null,
      dueDate: body.data.dueDate?.toISOString().split("T")[0] ?? null,
      isCompleted: false,
    }).returning();

    await recordActivity({
      userId: user.id,
      leadId: params.data.id,
      action: "task_created",
      entityType: "task",
      entityId: task.id,
      details: { title: task.title },
    });

    res.status(201).json(taskToApi(task, assignedUser));
  };
}

export function createUpdateTaskHandler(dependencies: TaskRouteDependencies = {}) {
  const database = dependencies.database ?? db;
  const authenticate = dependencies.authenticate ?? requireUser;
  const recordActivity = dependencies.recordActivity ?? logActivity;

  return async (req: Request, res: Response): Promise<void> => {
    const user = await authenticate(req, res);
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

    const existing = await database.query.tasksTable.findFirst({ where: eq(tasksTable.id, params.data.taskId) });
    if (!existing) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    const lead = await database.query.leadsTable.findFirst({ where: eq(leadsTable.id, existing.leadId) });
    if (user.role === "rep" && (!lead || lead.assignedRepId !== user.id)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const { dueDate: dueDateRaw, assignedUserId, ...restBodyData } = body.data;
    if (assignedUserId !== undefined) {
      const assignedUser = lead
        ? await findAuthorizedAssignee(database, user, lead, assignedUserId)
        : null;
      if (!assignedUser) {
        res.status(403).json({ error: "Forbidden: cannot assign task to this user" });
        return;
      }
    }

    const now = new Date();
    const completedAtDate: Date | null =
      body.data.isCompleted && !existing.isCompleted ? now :
      body.data.isCompleted === false ? null :
      existing.completedAt;

    const [updated] = await database
      .update(tasksTable)
      .set({
        ...restBodyData,
        userId: assignedUserId,
        dueDate: dueDateRaw !== undefined ? (dueDateRaw?.toISOString().split("T")[0] ?? null) : undefined,
        completedAt: completedAtDate,
        updatedAt: now,
      })
      .where(eq(tasksTable.id, params.data.taskId))
      .returning();

    await recordActivity({
      userId: user.id,
      leadId: existing.leadId,
      action: body.data.isCompleted && !existing.isCompleted ? "task_completed" : "task_updated",
      entityType: "task",
      entityId: existing.id,
      details: { title: existing.title, fields: Object.keys(body.data) },
    });

    res.json(taskToApi(updated, null));
  };
}

router.post("/leads/:id/tasks", createCreateTaskHandler());
const updateTaskHandler = createUpdateTaskHandler();
router.put("/tasks/:taskId", updateTaskHandler);
router.patch("/tasks/:taskId", updateTaskHandler);
export default router;
