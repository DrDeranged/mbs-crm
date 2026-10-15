import { Router, type IRouter, type Request, type Response } from "express";
import { openTasks } from "../lib/openTasks";
import { db } from "@workspace/db";
import { leadsTable, tasksTable, activityLogTable, usersTable, communicationsTable, companySettingsTable } from "@workspace/db";
import { eq, desc, and, gte, lte, lt, sql, isNull, or, inArray } from "drizzle-orm";
import { getUserDisplayName, requireUser, userToApi } from "../lib/authHelpers";
import { companyDate, companyDayWindow, addCalendarDays } from "../lib/companyCalendar";
import { calculateDashboardCalls } from "../lib/dashboardCalls";
import { inboundCallCounts } from "../lib/operationalCounts";
import { contactName, entityLabel } from "../lib/entityLabel";

const router: IRouter = Router();


function leadToApi(
  lead: typeof leadsTable.$inferSelect,
  rep?: typeof usersTable.$inferSelect | null,
  relatedCompanyName?: string | null,
) {
  const companyName = lead.companyName?.trim() || relatedCompanyName?.trim() || null;
  return {
    id: lead.id,
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: lead.email,
    phone: lead.phone,
    companyName,
    contactName: contactName(lead.firstName, lead.lastName),
    entityLabel: entityLabel(
      companyName,
      contactName(lead.firstName, lead.lastName),
      `Lead #${lead.id}`,
    ),
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

function taskToApi(
  task: typeof tasksTable.$inferSelect,
  assignedUser?: typeof usersTable.$inferSelect | null,
  lead?: (Pick<typeof leadsTable.$inferSelect, "id" | "firstName" | "lastName" | "companyName"> & {
    company?: { name: string | null } | null;
  }) | null,
) {
  return {
    id: task.id,
    leadId: task.leadId,
    leadLabel: lead
      ? entityLabel(lead.companyName?.trim() || lead.company?.name?.trim(), contactName(lead.firstName, lead.lastName), `Lead #${lead.id}`)
      : task.leadId == null ? null : `Lead #${task.leadId}`,
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
  if (user.role === "rep") {
    res.status(403).json({ error: "Forbidden: managers and admins only" });
    return;
  }

  const [statusCounts, recentLeadsRaw, repCountsRaw] = await Promise.all([
    db
      .select({ status: leadsTable.status, count: sql<number>`cast(count(*) as int)` })
      .from(leadsTable)
      .groupBy(leadsTable.status),
    db.query.leadsTable.findMany({
      orderBy: [desc(leadsTable.createdAt)],
      limit: 10,
      with: { assignedRep: true, company: { columns: { name: true } } },
    }),
    db
      .select({
        repId: usersTable.id,
        repName: usersTable.name,
         repEmail: usersTable.email,
        count: sql<number>`cast(count(${leadsTable.id}) as int)`,
      })
      .from(usersTable)
      .leftJoin(leadsTable, eq(leadsTable.assignedRepId, usersTable.id))
      .where(eq(usersTable.role, "rep"))
       .groupBy(usersTable.id, usersTable.name, usersTable.email),
  ]);

  res.json({
    pipelineCounts: statusCounts.map((r) => ({ status: r.status, count: r.count })),
    recentLeads: recentLeadsRaw.map((l) => leadToApi(l, (l as any).assignedRep, (l as any).company?.name)),
    repCounts: repCountsRaw.map((r) => ({
      repId: r.repId,
       repName: getUserDisplayName({ name: r.repName, email: r.repEmail }, "Unknown"),
      count: r.count,
    })),
  });
});

/** Calls-today operational card. Phone numbers are returned only for leads
 * visible to this user (reps are restricted by lead ownership). */
router.get("/dashboard/calls", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (!["admin", "manager", "rep"].includes(user.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const { start: todayStart, end: todayEnd } = companyDayWindow();
  const leadRows = await db.query.leadsTable.findMany({
    where: user.role === "rep" ? eq(leadsTable.assignedRepId, user.id) : undefined,
    columns: { id: true, firstName: true, lastName: true, companyName: true, phone: true },
    with: { company: { columns: { name: true } } },
  });
  const leadsForCalls = leadRows.map((lead) => ({
    ...lead,
    companyName: lead.companyName ?? (lead as any).company?.name ?? null,
  }));
  const leadIds = leadsForCalls.map((lead) => lead.id);
  const ownershipClause = user.role === "rep"
    ? (leadIds.length ? inArray(communicationsTable.leadId, leadIds) : sql`false`)
    : undefined;
  const inbound = await db.query.communicationsTable.findMany({
    where: and(
      eq(communicationsTable.type, "call"),
      eq(communicationsTable.direction, "inbound"),
      gte(communicationsTable.createdAt, todayStart),
      lt(communicationsTable.createdAt, todayEnd),
      ownershipClause,
    ),
  });
  if (!leadIds.length) return void res.json({
    inboundCount: inboundCallCounts(inbound).total,
    answeredCount: inboundCallCounts(inbound).answered,
    voicemailCount: inboundCallCounts(inbound).voicemail,
    averageCallbackBusinessMinutes: null,
    overdueVoicemails: [],
  });
  const voicemailRows = await db.query.communicationsTable.findMany({
    where: and(
      eq(communicationsTable.type, "call"),
      eq(communicationsTable.direction, "inbound"),
       or(eq(communicationsTable.status, "voicemail"), eq(communicationsTable.callOutcome, "voicemail")),
      inArray(communicationsTable.leadId, leadIds),
    ),
    orderBy: [desc(communicationsTable.createdAt)],
  });
  const callbacks = await db.query.communicationsTable.findMany({
    where: and(
      eq(communicationsTable.type, "call"),
      eq(communicationsTable.direction, "outbound"),
      inArray(communicationsTable.leadId, leadIds),
    ),
    orderBy: [desc(communicationsTable.createdAt)],
    with: { user: true },
  });
  const callbackActivities = await db.query.activityLogTable.findMany({
    where: and(
      eq(activityLogTable.action, "call_completed_outbound"),
      inArray(activityLogTable.leadId, leadIds),
    ),
  });
  const activityByCommunicationId = new Map(
    callbackActivities.map((activity) => [
      String(activity.entityId),
      {
        at: activity.createdAt,
        status: String((activity.details as Record<string, unknown> | null)?.status ?? ""),
      },
    ]),
  );
  const [settings] = await db.select({
    voiceHoursStart: companySettingsTable.voiceHoursStart,
    voiceHoursEnd: companySettingsTable.voiceHoursEnd,
    voiceBusinessDays: companySettingsTable.voiceBusinessDays,
    voiceHolidays: companySettingsTable.voiceHolidays,
  }).from(companySettingsTable).limit(1);
  const effective = settings ?? { voiceHoursStart: "08:00", voiceHoursEnd: "18:00", voiceBusinessDays: [1, 2, 3, 4, 5], voiceHolidays: [] };
  const result = calculateDashboardCalls(
    inbound as any,
    voicemailRows as any,
    callbacks.map((callback) => ({
      ...callback,
      userRole: (callback as any).user?.role ?? null,
      callbackActivityAt: activityByCommunicationId.get(String(callback.id))?.at ?? null,
      callbackActivityStatus: activityByCommunicationId.get(String(callback.id))?.status ?? null,
    })) as any,
    leadsForCalls,
    effective,
    new Date(),
  );
  res.json(result);
});

router.get("/dashboard/rep", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "rep") {
    res.status(403).json({ error: "Forbidden: reps only" });
    return;
  }

  const todayStr = companyDate();

  const repFilter = user.role === "rep" ? eq(leadsTable.assignedRepId, user.id) : undefined;

  const [myLeadsRaw, tasksDueTodayRaw, recentActivityRaw, statusCountsRaw] = await Promise.all([
    db.query.leadsTable.findMany({
      where: repFilter,
      orderBy: [desc(leadsTable.updatedAt)],
      limit: 10,
      with: { assignedRep: true, company: { columns: { name: true } } },
    }),
    db.query.tasksTable.findMany({
      where: and(eq(tasksTable.userId, user.id), eq(tasksTable.isCompleted, false), eq(tasksTable.dueDate, todayStr)),
      orderBy: [desc(tasksTable.dueDate)],
      with: {
        assignedUser: true,
        lead: {
          columns: { id: true, firstName: true, lastName: true, companyName: true, assignedRepId: true },
          with: { company: { columns: { name: true } } },
        },
      },
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
    myLeads: myLeadsRaw.map((l) => leadToApi(l, (l as any).assignedRep, (l as any).company?.name)),
    tasksDueToday: tasksDueTodayRaw.map((t) => {
      const lead = (t as any).lead;
      const visibleLead = user.role !== "rep" || lead?.assignedRepId === user.id ? lead : null;
      return taskToApi(t, (t as any).assignedUser, visibleLead);
    }),
    recentActivity: recentActivityRaw.map((a) => activityToApi(a, (a as any).user)),
    leadsByStatus: statusCountsRaw.map((r) => ({ status: r.status, count: r.count })),
  });
});

export function createGetMyTasksHandler(overrides: {
  database?: typeof db;
  authenticate?: typeof requireUser;
  clock?: () => Date;
} = {}) {
  const database = overrides.database ?? db;
  const authenticate = overrides.authenticate ?? requireUser;
  const clock = overrides.clock ?? (() => new Date());
  return async (req: Request, res: Response) => {
  const user = await authenticate(req, res);
  if (!user) return;

  const now = clock();
  const todayStr = companyDate(now);
  const endOfWeekStr = addCalendarDays(todayStr, 7);

  const [dueTodayRaw, dueThisWeekRaw, overdueRaw] = await Promise.all([
    openTasks(database, user, "today", now),
    openTasks(database, user, "upcoming", now).then(rows => rows.filter(t => t.dueDate! <= endOfWeekStr)),
    openTasks(database, user, "overdue", now),
  ]);

  res.json({
    dueToday: dueTodayRaw.map((t) => taskToApi(t, (t as any).assignedUser, (t as any).lead)),
    dueThisWeek: [...dueTodayRaw, ...dueThisWeekRaw].map((t) => taskToApi(t, (t as any).assignedUser, (t as any).lead)),
    overdue: overdueRaw.map((t) => taskToApi(t, (t as any).assignedUser, (t as any).lead)),
  });
  };
}

router.get("/dashboard/my-tasks", createGetMyTasksHandler());

export { leadToApi, taskToApi, activityToApi };
export default router;
