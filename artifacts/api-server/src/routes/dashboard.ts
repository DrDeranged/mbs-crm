import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { leadsTable, tasksTable, activityLogTable, usersTable } from "@workspace/db";
import { eq, desc, and, gte, lte, sql, isNull } from "drizzle-orm";
import { requireUser, userToApi } from "../lib/authHelpers";

const router: IRouter = Router();

function leadToApi(lead: typeof leadsTable.$inferSelect, rep?: typeof usersTable.$inferSelect | null) {
  return {
    id: lead.id,
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: lead.email,
    phone: lead.phone,
    companyName: lead.companyName,
    ein: lead.ein,
    applicationType: lead.applicationType,
    status: lead.status,
    assignedRepId: lead.assignedRepId,
    assignedRep: rep ? userToApi(rep) : null,
    leadSource: lead.leadSource,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
    lastActivityAt: lead.lastActivityAt?.toISOString() ?? null,
  };
}

function taskToApi(task: typeof tasksTable.$inferSelect, assignedUser?: typeof usersTable.$inferSelect | null) {
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

function activityToApi(entry: typeof activityLogTable.$inferSelect, user?: typeof usersTable.$inferSelect | null) {
  return {
    id: entry.id,
    userId: entry.userId ?? null,
    user: user ? userToApi(user) : null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    details: (entry.details as Record<string, unknown>) ?? {},
    createdAt: entry.createdAt.toISOString(),
  };
}

router.get("/dashboard/summary", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const [statusCounts, recentLeadsRaw, repCountsRaw] = await Promise.all([
    db
      .select({ status: leadsTable.status, count: sql<number>`cast(count(*) as int)` })
      .from(leadsTable)
      .groupBy(leadsTable.status),
    db.query.leadsTable.findMany({
      orderBy: [desc(leadsTable.createdAt)],
      limit: 10,
      with: { assignedRep: true },
    }),
    db
      .select({
        repId: usersTable.id,
        repName: usersTable.name,
        count: sql<number>`cast(count(${leadsTable.id}) as int)`,
      })
      .from(usersTable)
      .leftJoin(leadsTable, eq(leadsTable.assignedRepId, usersTable.id))
      .where(eq(usersTable.role, "rep"))
      .groupBy(usersTable.id, usersTable.name),
  ]);

  res.json({
    pipelineCounts: statusCounts.map((r) => ({ status: r.status, count: r.count })),
    recentLeads: recentLeadsRaw.map((l) => leadToApi(l, (l as any).assignedRep)),
    repCounts: repCountsRaw.map((r) => ({
      repId: r.repId,
      repName: r.repName ?? "Unknown",
      count: r.count,
    })),
  });
});

router.get("/dashboard/rep", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split("T")[0];

  const repFilter = user.role === "rep" ? eq(leadsTable.assignedRepId, user.id) : undefined;

  const [myLeadsRaw, tasksDueTodayRaw, recentActivityRaw, statusCountsRaw] = await Promise.all([
    db.query.leadsTable.findMany({
      where: repFilter,
      orderBy: [desc(leadsTable.updatedAt)],
      limit: 10,
      with: { assignedRep: true },
    }),
    db.query.tasksTable.findMany({
      where: and(eq(tasksTable.userId, user.id), eq(tasksTable.isCompleted, false), eq(tasksTable.dueDate, todayStr)),
      orderBy: [desc(tasksTable.dueDate)],
      with: { assignedUser: true },
    }),
    db.query.activityLogTable.findMany({
      where: user.role === "rep" ? eq(activityLogTable.userId, user.id) : undefined,
      orderBy: [desc(activityLogTable.createdAt)],
      limit: 20,
      with: { user: true },
    }),
    db
      .select({ status: leadsTable.status, count: sql<number>`cast(count(*) as int)` })
      .from(leadsTable)
      .where(repFilter)
      .groupBy(leadsTable.status),
  ]);

  res.json({
    myLeads: myLeadsRaw.map((l) => leadToApi(l, (l as any).assignedRep)),
    tasksDueToday: tasksDueTodayRaw.map((t) => taskToApi(t, (t as any).assignedUser)),
    recentActivity: recentActivityRaw.map((a) => activityToApi(a, (a as any).user)),
    leadsByStatus: statusCountsRaw.map((r) => ({ status: r.status, count: r.count })),
  });
});

router.get("/dashboard/my-tasks", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];
  const endOfWeek = new Date(now);
  endOfWeek.setDate(now.getDate() + 7);
  const endOfWeekStr = endOfWeek.toISOString().split("T")[0];

  const [dueTodayRaw, dueThisWeekRaw, overdueRaw] = await Promise.all([
    db.query.tasksTable.findMany({
      where: and(eq(tasksTable.userId, user.id), eq(tasksTable.isCompleted, false), eq(tasksTable.dueDate, todayStr)),
      with: { assignedUser: true },
    }),
    db.query.tasksTable.findMany({
      where: and(
        eq(tasksTable.userId, user.id),
        eq(tasksTable.isCompleted, false),
        gte(tasksTable.dueDate, todayStr),
        lte(tasksTable.dueDate, endOfWeekStr),
      ),
      with: { assignedUser: true },
    }),
    db.query.tasksTable.findMany({
      where: and(eq(tasksTable.userId, user.id), eq(tasksTable.isCompleted, false), lte(tasksTable.dueDate, todayStr)),
      with: { assignedUser: true },
    }),
  ]);

  res.json({
    dueToday: dueTodayRaw.map((t) => taskToApi(t, (t as any).assignedUser)),
    dueThisWeek: dueThisWeekRaw.map((t) => taskToApi(t, (t as any).assignedUser)),
    overdue: overdueRaw.map((t) => taskToApi(t, (t as any).assignedUser)),
  });
});

export { leadToApi, taskToApi, activityToApi };
export default router;
