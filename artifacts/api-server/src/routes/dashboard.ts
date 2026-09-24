import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { leadsTable, tasksTable, activityLogTable, usersTable, communicationsTable, companySettingsTable } from "@workspace/db";
import { eq, desc, and, gte, lte, sql, isNull, or, inArray } from "drizzle-orm";
import { getUserDisplayName, requireUser, userToApi } from "../lib/authHelpers";
import { newYorkBusinessTime } from "../lib/inboundVoice";
import { calculateDashboardCalls } from "../lib/dashboardCalls";

const router: IRouter = Router();

function nyMidnight(now: Date): Date {
  const { date } = newYorkBusinessTime(now);
  // Derive the offset from noon in the target date so DST transitions do not
  // shift the reporting boundary by an hour.
  const [year, month, day] = date.split("-").map(Number);
  const noon = new Date(Date.UTC(year!, month! - 1, day!, 12));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(noon);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const offset = noon.getTime() - Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return new Date(Date.UTC(year!, month! - 1, day!) + offset);
}

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
      with: { assignedRep: true },
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
    recentLeads: recentLeadsRaw.map((l) => leadToApi(l, (l as any).assignedRep)),
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
  const todayStart = nyMidnight(new Date());
  const leadRows = await db.query.leadsTable.findMany({
    where: user.role === "rep" ? eq(leadsTable.assignedRepId, user.id) : undefined,
    columns: { id: true, firstName: true, lastName: true, companyName: true, phone: true },
  });
  const leadIds = leadRows.map((lead) => lead.id);
  const ownershipClause = user.role === "rep"
    ? (leadIds.length ? inArray(communicationsTable.leadId, leadIds) : sql`false`)
    : undefined;
  const inbound = await db.query.communicationsTable.findMany({
    where: and(
      eq(communicationsTable.type, "call"),
      eq(communicationsTable.direction, "inbound"),
      gte(communicationsTable.createdAt, todayStart),
      ownershipClause,
    ),
  });
  if (!leadIds.length) return void res.json({
    inboundCount: inbound.length,
    answeredCount: inbound.filter((call) =>
      call.callOutcome !== "voicemail" &&
      (call.callOutcome === "connected" || call.status === "completed" || call.status === "answered"),
    ).length,
    voicemailCount: inbound.filter((call) => call.status === "voicemail" || call.callOutcome === "voicemail").length,
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
    leadRows,
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

  // For reps: scope tasks to leads they are assigned to (lead ownership check).
  // For managers/admins: tasks assigned to them regardless of lead.
  const repLeadFilter = user.role === "rep"
    ? eq(leadsTable.assignedRepId, user.id)
    : undefined;

  const taskBaseWhere = (extraWhere: any) =>
    user.role === "rep"
      ? and(eq(tasksTable.isCompleted, false), extraWhere)
      : and(eq(tasksTable.userId, user.id), eq(tasksTable.isCompleted, false), extraWhere);

  const withRepJoin = async (extraWhere: any) => {
    if (user.role === "rep") {
      return db.query.tasksTable.findMany({
        where: and(eq(tasksTable.isCompleted, false), extraWhere),
        with: { assignedUser: true, lead: true },
      }).then((rows) => rows.filter((t) => (t as any).lead?.assignedRepId === user.id));
    }
    return db.query.tasksTable.findMany({
      where: and(eq(tasksTable.userId, user.id), eq(tasksTable.isCompleted, false), extraWhere),
      with: { assignedUser: true },
    });
  };

  const [dueTodayRaw, dueThisWeekRaw, overdueRaw] = await Promise.all([
    withRepJoin(eq(tasksTable.dueDate, todayStr)),
    withRepJoin(and(gte(tasksTable.dueDate, todayStr), lte(tasksTable.dueDate, endOfWeekStr))),
    withRepJoin(lte(tasksTable.dueDate, todayStr)),
  ]);

  res.json({
    dueToday: dueTodayRaw.map((t) => taskToApi(t, (t as any).assignedUser)),
    dueThisWeek: dueThisWeekRaw.map((t) => taskToApi(t, (t as any).assignedUser)),
    overdue: overdueRaw.map((t) => taskToApi(t, (t as any).assignedUser)),
  });
});

export { leadToApi, taskToApi, activityToApi };
export default router;
