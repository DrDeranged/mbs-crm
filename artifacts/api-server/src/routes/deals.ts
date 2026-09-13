import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, gte, ilike, lte, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  activityLogTable,
  dealsTable,
  leadsTable,
  usersTable,
  DEAL_STAGES,
} from "@workspace/db";
import { db } from "@workspace/db";
import { requireUser, userToApi } from "../lib/authHelpers";
import { getLatestActivities, logActivity } from "../lib/activityHelper";
import { CreateDealBody, UpdateDealBody, ConvertLeadToDealBody } from "@workspace/api-zod";

const router: IRouter = Router();
const stageSchema = z.enum(DEAL_STAGES);
const dealInputSchema = CreateDealBody;
const dealUpdateSchema = UpdateDealBody;
const conversionSchema = ConvertLeadToDealBody;
const idSchema = z.coerce.number().int().positive();

const ACTIVE_STAGES = DEAL_STAGES.filter((stage) => !["funded", "declined", "dead", "hold_on"].includes(stage));

function toApi(
  deal: typeof dealsTable.$inferSelect,
  assignedUser?: typeof usersTable.$inferSelect | null,
  latestActivity?: { createdAt: Date; user?: typeof usersTable.$inferSelect | null } | null,
) {
  return {
    id: deal.id,
    leadId: deal.leadId,
    dealName: deal.dealName,
    stage: deal.stage,
    amount: deal.amount ?? null,
    approxGm: deal.approxGm ?? null,
    actualGm: deal.actualGm ?? null,
    assignedTo: deal.assignedTo ?? null,
    assignedUser: assignedUser ? userToApi(assignedUser) : null,
    createdAt: deal.createdAt.toISOString(),
    updatedAt: deal.updatedAt.toISOString(),
    fundedAt: deal.fundedAt?.toISOString() ?? null,
    isArchived: deal.isArchived,
    lastActivityAt: latestActivity?.createdAt.toISOString() ?? null,
    lastActivityActor: latestActivity?.user ? userToApi(latestActivity.user) : null,
  };
}

function parseId(req: Request, res: Response): number | null {
  const parsed = idSchema.safeParse(req.params.id);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid deal id" });
    return null;
  }
  return parsed.data;
}

function canAccessDeal(user: typeof usersTable.$inferSelect, deal: typeof dealsTable.$inferSelect) {
  return user.role !== "rep" || deal.assignedTo === user.id;
}

async function findDeal(id: number) {
  return db.query.dealsTable.findFirst({
    where: eq(dealsTable.id, id),
    with: { assignedUser: true, lead: true },
  });
}

function dateConditions(req: Request, table = dealsTable) {
  const q = req.query as Record<string, string | undefined>;
  const clauses: any[] = [];
  if (q.start_date) clauses.push(gte(table.createdAt, new Date(q.start_date)));
  if (q.end_date) clauses.push(lte(table.createdAt, new Date(`${q.end_date}T23:59:59.999Z`)));
  return clauses;
}

router.get("/deals", async (req, res): Promise<void> => {
  const user = await requireUser(req, res);
  if (!user) return;
  const q = req.query as Record<string, string | undefined>;
  const page = Math.max(Number(q.page ?? 1), 1);
  const limit = Math.min(Math.max(Number(q.limit ?? 25), 1), 100);
  const conditions: any[] = [];
  if (q.include_archived !== "true") conditions.push(eq(dealsTable.isArchived, false));
  if (user.role === "rep") conditions.push(eq(dealsTable.assignedTo, user.id));
  if (q.rep_id && user.role !== "rep") conditions.push(eq(dealsTable.assignedTo, Number(q.rep_id)));
  if (q.lead_id) conditions.push(eq(dealsTable.leadId, Number(q.lead_id)));
  if (q.stage) {
    const stage = stageSchema.safeParse(q.stage);
    if (!stage.success) {
      res.status(400).json({ error: "Invalid deal stage" });
      return;
    }
    conditions.push(eq(dealsTable.stage, stage.data));
  }
  if (q.search) conditions.push(ilike(dealsTable.dealName, `%${q.search.replace(/[%_]/g, "\\$&")}%`));
  conditions.push(...dateConditions(req));
  const where = and(...conditions);
  const sortField = q.sort_by ?? "updatedAt";
  const sortDirection = q.sort_order === "asc" ? asc : desc;
  const latestActivitySort = sql`(select max(${activityLogTable.createdAt}) from ${activityLogTable} where ${activityLogTable.dealId} = ${dealsTable.id})`;
  const validSortFields: Record<string, any> = {
    createdAt: dealsTable.createdAt,
    updatedAt: dealsTable.updatedAt,
    dealName: dealsTable.dealName,
    stage: dealsTable.stage,
    lastActivityAt: latestActivitySort,
  };
  const sortColumn = validSortFields[sortField] ?? dealsTable.updatedAt;
  const [rows, totals] = await Promise.all([
    db.query.dealsTable.findMany({
      where,
      with: { assignedUser: true },
      orderBy: [sortDirection(sortColumn), asc(dealsTable.id)],
      limit,
      offset: (page - 1) * limit,
    }),
    db.select({ total: sql<number>`cast(count(*) as int)` }).from(dealsTable).where(where),
  ]);
  const latestActivities = await getLatestActivities("deal", rows.map((deal) => deal.id));
  const total = totals[0]?.total ?? 0;
  res.json({
    deals: rows.map((deal) => toApi(deal, deal.assignedUser, latestActivities.get(deal.id))),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

router.post("/deals", async (req, res): Promise<void> => {
  const user = await requireUser(req, res);
  if (!user) return;
  const parsed = dealInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  const data = parsed.data;
  if (user.role === "rep" && data.assignedTo !== undefined && data.assignedTo !== user.id) {
    res.status(403).json({ error: "Reps may only assign deals to themselves" });
    return;
  }
  if (data.stage === "funded" && data.actualGm == null) {
    res.status(400).json({ error: "actualGm is required when a deal is funded" });
    return;
  }
  const [deal] = await db.insert(dealsTable).values({
    ...data,
    assignedTo: user.role === "rep" ? user.id : data.assignedTo,
    fundedAt: data.stage === "funded" ? new Date() : null,
  }).returning();
  await logActivity({ userId: user.id, dealId: deal.id, leadId: deal.leadId, action: "created", entityType: "deal", entityId: deal.id });
  res.status(201).json(toApi(deal));
});

router.get("/deals/:id", async (req, res, next): Promise<void> => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (req.params.id === "analytics") {
    next();
    return;
  }
  const id = parseId(req, res);
  if (!id) return;
  const deal = await findDeal(id);
  if (!deal) {
    res.status(404).json({ error: "Deal not found" });
    return;
  }
  if (!canAccessDeal(user, deal)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const activity = await db.query.activityLogTable.findMany({
    where: eq(activityLogTable.dealId, id),
    with: { user: true },
    orderBy: [asc(activityLogTable.createdAt), asc(activityLogTable.id)],
  });
  const latestActivity = activity.length > 0 ? activity[activity.length - 1] : null;
  res.json({
    ...toApi(deal, deal.assignedUser, latestActivity),
    lead: deal.lead ?? null,
    activity: activity.map((entry) => ({
      ...entry,
      user: entry.user ? userToApi(entry.user) : null,
      createdAt: entry.createdAt.toISOString(),
    })),
  });
});

router.put("/deals/:id", async (req, res): Promise<void> => {
  const user = await requireUser(req, res);
  if (!user) return;
  const id = parseId(req, res);
  if (!id) return;
  const parsed = dealUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  const existing = await db.query.dealsTable.findFirst({ where: eq(dealsTable.id, id) });
  if (!existing) {
    res.status(404).json({ error: "Deal not found" });
    return;
  }
  if (!canAccessDeal(user, existing)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (user.role === "rep" && parsed.data.assignedTo !== undefined && parsed.data.assignedTo !== existing.assignedTo) {
    res.status(403).json({ error: "Reps may not reassign deals" });
    return;
  }
  const nextStage = parsed.data.stage ?? existing.stage;
  const nextActualGm = parsed.data.actualGm !== undefined ? parsed.data.actualGm : existing.actualGm;
  if (nextStage === "funded" && nextActualGm == null) {
    res.status(400).json({ error: "actualGm is required when a deal is funded" });
    return;
  }
  const stageChanged = parsed.data.stage !== undefined && parsed.data.stage !== existing.stage;
  const now = new Date();
  const update: any = { ...parsed.data, updatedAt: now };
  if (nextStage === "funded" && existing.stage !== "funded") update.fundedAt = now;
  // Historical funding time is deliberately preserved when a funded deal is moved
  // back to another stage, so analytics retain the first completed funding event.
  const [deal] = await db.update(dealsTable).set(update).where(eq(dealsTable.id, id)).returning();
  if (stageChanged) {
    await logActivity({
      userId: user.id,
      dealId: id,
      leadId: deal.leadId,
      action: "stage_changed",
      entityType: "deal",
      entityId: id,
      details: {
        from: existing.stage,
        to: deal.stage,
        user: user.id,
        userId: user.id,
        timestamp: now.toISOString(),
      },
    });
  }
  res.json(toApi(deal));
});

router.post("/deals/:id/archive", async (req, res): Promise<void> => {
  const user = await requireUser(req, res);
  if (!user) return;
  const id = parseId(req, res);
  if (!id) return;
  const existing = await db.query.dealsTable.findFirst({ where: eq(dealsTable.id, id) });
  if (!existing) {
    res.status(404).json({ error: "Deal not found" });
    return;
  }
  if (!canAccessDeal(user, existing)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const [deal] = await db.update(dealsTable).set({ isArchived: true, updatedAt: new Date() }).where(eq(dealsTable.id, id)).returning();
  await logActivity({ userId: user.id, dealId: id, leadId: deal.leadId, action: "archived", entityType: "deal", entityId: id });
  res.json(toApi(deal));
});

router.delete("/deals/:id", async (req, res): Promise<void> => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") {
    res.status(403).json({ error: "Admins only" });
    return;
  }
  const id = parseId(req, res);
  if (!id) return;
  const deleted = await db.delete(dealsTable).where(eq(dealsTable.id, id)).returning({ id: dealsTable.id });
  if (deleted.length === 0) {
    res.status(404).json({ error: "Deal not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/deals/:id/activity", async (req, res): Promise<void> => {
  const user = await requireUser(req, res);
  if (!user) return;
  const id = parseId(req, res);
  if (!id) return;
  const deal = await db.query.dealsTable.findFirst({ where: eq(dealsTable.id, id) });
  if (!deal) {
    res.status(404).json({ error: "Deal not found" });
    return;
  }
  if (!canAccessDeal(user, deal)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const rows = await db.query.activityLogTable.findMany({
    where: eq(activityLogTable.dealId, id),
    with: { user: true },
    orderBy: [asc(activityLogTable.createdAt), asc(activityLogTable.id)],
  });
  res.json(rows.map((entry) => ({
    ...entry,
    user: entry.user ? userToApi(entry.user) : null,
    createdAt: entry.createdAt.toISOString(),
  })));
});

router.post("/leads/:id/convert-to-deal", async (req, res): Promise<void> => {
  const user = await requireUser(req, res);
  if (!user) return;
  const leadId = idSchema.safeParse(req.params.id);
  if (!leadId.success) {
    res.status(400).json({ error: "Invalid lead id" });
    return;
  }
  const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, leadId.data) });
  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  if (user.role === "rep" && lead.assignedRepId !== user.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const body = conversionSchema.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: "Invalid body", details: body.error.issues });
    return;
  }
  const existing = await db.query.dealsTable.findFirst({ where: eq(dealsTable.leadId, lead.id) });
  if (existing) {
    res.status(409).json({ error: "Lead is already linked to a deal", dealId: existing.id });
    return;
  }
  const defaultName = lead.companyName || [lead.firstName, lead.lastName].filter(Boolean).join(" ") || `Lead ${lead.id}`;
  const data = body.data;
  const assignedTo = user.role === "rep" ? user.id : (data.assignedTo !== undefined ? data.assignedTo : lead.assignedRepId);
  const stage = data.stage ?? "waiting_on_app";
  if (stage === "funded" && data.actualGm == null) {
    res.status(400).json({ error: "actualGm is required when a deal is funded" });
    return;
  }
  const [deal] = await db.insert(dealsTable).values({
    leadId: lead.id,
    dealName: data.dealName ?? defaultName,
    stage,
    amount: data.amount !== undefined ? data.amount : lead.requestedAmount,
    approxGm: data.approxGm,
    actualGm: data.actualGm,
    assignedTo,
    fundedAt: stage === "funded" ? new Date() : null,
  }).returning();
  await logActivity({ userId: user.id, leadId: lead.id, dealId: deal.id, action: "converted", entityType: "deal", entityId: deal.id, details: { leadId: lead.id } });
  res.status(201).json(toApi(deal));
});

router.get("/deals/analytics", async (req, res): Promise<void> => {
  const user = await requireUser(req, res);
  if (!user) return;
  const q = req.query as Record<string, string | undefined>;
  const conditions: any[] = [eq(dealsTable.isArchived, false)];
  const effectiveRepId = user.role === "rep" ? user.id : (q.rep_id ? Number(q.rep_id) : undefined);
  if (effectiveRepId) conditions.push(eq(dealsTable.assignedTo, effectiveRepId));
  conditions.push(...dateConditions(req));
  const where = and(...conditions);
  const activeWhere = and(where, sql`${dealsTable.stage} in ${sql.raw(`(${ACTIVE_STAGES.map((s) => `'${s}'`).join(",")})`)}`);
  const [stageRows, fundedRows, awaitingRows, pipelineRows, avgRows, users, assignedUsers] = await Promise.all([
    db.select({ stage: dealsTable.stage, count: sql<number>`cast(count(*) as int)` }).from(dealsTable).where(where).groupBy(dealsTable.stage),
    db.select({ value: sql<number>`cast(coalesce(sum(${dealsTable.actualGm}), 0) as int)` }).from(dealsTable).where(and(where, eq(dealsTable.stage, "funded"))),
    db.select({ value: sql<number>`cast(coalesce(sum(${dealsTable.approxGm}), 0) as int)` }).from(dealsTable).where(activeWhere),
    db.select({ value: sql<number>`cast(coalesce(sum(${dealsTable.amount}), 0) as int)` }).from(dealsTable).where(activeWhere),
    db.select({ value: sql<number>`avg(extract(epoch from (${dealsTable.fundedAt} - ${dealsTable.createdAt})) / 86400)` }).from(dealsTable).where(and(where, eq(dealsTable.stage, "funded"))),
    db.select().from(usersTable).where(eq(usersTable.isActive, true)),
    db.selectDistinct({ userId: dealsTable.assignedTo }).from(dealsTable),
  ]);
  const assignedUserIds = new Set(assignedUsers.map((assigned) => assigned.userId));
  const performanceUsers = users.filter((candidate) =>
    candidate.role === "rep" || assignedUserIds.has(candidate.id),
  );
  const visibleReps = user.role === "rep"
    ? performanceUsers.filter((rep) => rep.id === user.id)
    : performanceUsers;
  const repRows = await Promise.all(visibleReps.map(async (rep) => {
    const repWhere = and(where, eq(dealsTable.assignedTo, rep.id));
    const [active, funded] = await Promise.all([
      db.select({ count: sql<number>`cast(count(*) as int)` }).from(dealsTable).where(and(repWhere, sql`${dealsTable.stage} in ${sql.raw(`(${ACTIVE_STAGES.map((s) => `'${s}'`).join(",")})`)} `)),
      db.select({ count: sql<number>`cast(count(*) as int)`, gm: sql<number>`cast(coalesce(sum(${dealsTable.actualGm}), 0) as int)` }).from(dealsTable).where(and(repWhere, eq(dealsTable.stage, "funded"))),
    ]);
    return {
      repId: rep.id,
      repName: rep.name?.trim() || rep.email.split("@")[0] || "Unknown",
      activeDeals: active[0]?.count ?? 0,
      fundedCount: funded[0]?.count ?? 0,
      fundedGm: funded[0]?.gm ?? 0,
    };
  }));
  const stageCounts: Record<string, number> = {};
  for (const row of stageRows) stageCounts[row.stage] = row.count;
  const avg = avgRows[0]?.value;
  res.json({
    fundedGm: fundedRows[0]?.value ?? 0,
    awaitingGm: awaitingRows[0]?.value ?? 0,
    pipelineValue: pipelineRows[0]?.value ?? 0,
    avgFundingTimeDays: avg == null ? null : Number(avg),
    stageCounts,
    reps: repRows,
  });
});

type SeedDealDefinition = {
  dealName: string;
  stage: typeof DEAL_STAGES[number];
  amount: number | null;
  approxGm: number | null;
  actualGm: number | null;
  note: string | null;
  intendedRepSlug?: string | null;
};

const SEED_DEALS: SeedDealDefinition[] = [
  { dealName: "Fastgrass Hydroseed LLC", stage: "submitted", amount: 65000, approxGm: 8000, actualGm: null, note: "Customer held out another month" },
  { dealName: "Heartlands Entertainment LLC", stage: "submitted", amount: 250000, approxGm: 20000, actualGm: null, note: "Awaiting Banks" },
  { dealName: "University of Illinois", stage: "in_funding", amount: 365000, approxGm: 12000, actualGm: 12000, note: "In Funding" },
  { dealName: "Browns Farm", stage: "information_needed", amount: 40000, approxGm: null, actualGm: null, note: "Ghosted" },
  { dealName: "Emerald Hydroturf", stage: "information_needed", amount: 65000, approxGm: null, actualGm: null, note: "Awaiting App/Banks/Quote" },
  { dealName: "Frisco Station Arcade", stage: "dead", amount: null, approxGm: null, actualGm: null, note: "Lost deal, Declined" },
  { dealName: "Bryce Roder dba SETX Hydroseed", stage: "dead", amount: null, approxGm: null, actualGm: null, note: "Did not need" },
  { dealName: "Jim (Moss Deal)", stage: "hold_on", amount: 120000, approxGm: null, actualGm: null, note: null },
  { dealName: "Wyatt (Kincaid Deal)", stage: "dead", amount: 123000, approxGm: null, actualGm: null, note: null },
  { dealName: "Integrity Outdoor Services", stage: "submitted", amount: 65000, approxGm: 12000, actualGm: 6000, note: "Docs In, customer ghosted" },
  { dealName: "Jared Yost dba Tribal AG", stage: "approved", amount: 225000, approxGm: 22000, actualGm: 12000, note: "Waiting on docs from CPA" },
  { dealName: "Cornell University", stage: "approved", amount: 504000, approxGm: 15000, actualGm: 15000, note: "Waiting on signed proposal" },
  { dealName: "Talya Friend", stage: "dead", amount: 40000, approxGm: 4000, actualGm: null, note: "Tesla Chargers, waiting on App and Banks" },
  { dealName: "Diamond AG", stage: "going_to_funding", amount: 360000, approxGm: 25000, actualGm: null, note: "Waiting SOS" },
  { dealName: "Oregon Hydroseed", stage: "submitted", amount: 116000, approxGm: 10000, actualGm: null, note: "May want to hold off, trying better option" },
  { dealName: "AM Global Investments", stage: "declined", amount: 10000, approxGm: 2000, actualGm: null, note: null },
  { dealName: "Slick City Water Park", stage: "waiting_on_app", amount: 1000000, approxGm: 40000, actualGm: null, note: "Spoke to Pat, doing app and quotes" },
  { dealName: "5 Boys Moving", stage: "declined", amount: 36000, approxGm: 3000, actualGm: null, note: "sent quote" },
  { dealName: "Mitchell & Vereen Transportation LLC", stage: "funded", amount: 30000, approxGm: null, actualGm: null, note: "Calvin's deal → assign", intendedRepSlug: "calvin" },
  { dealName: "Four Pillars", stage: "in_funding", amount: 118000, approxGm: null, actualGm: null, note: "Calvin's deal", intendedRepSlug: "calvin" },
  { dealName: "Antleys", stage: "submitted", amount: 36000, approxGm: null, actualGm: null, note: "Calvin's deal", intendedRepSlug: "calvin" },
  { dealName: "R2Muse Trucking", stage: "submitted", amount: 37000, approxGm: null, actualGm: null, note: "Calvin's deal", intendedRepSlug: "calvin" },
  { dealName: "Erosion Specialist", stage: "funded", amount: 17000, approxGm: 2300, actualGm: 2300, note: "Booked" },
  { dealName: "TP K1 Speed", stage: "funded", amount: 1500000, approxGm: 35000, actualGm: 25500, note: "Funded" },
  { dealName: "Jared Yost dba Tribal AG (funded tranche)", stage: "funded", amount: 110000, approxGm: 9000, actualGm: 8800, note: "Booked" },
];

router.post("/admin/deals/seed", async (req, res): Promise<void> => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") {
    res.status(403).json({ error: "Admins only" });
    return;
  }
  const admins = await db.query.usersTable.findMany({ where: and(eq(usersTable.role, "admin"), eq(usersTable.isActive, true)) });
  if (admins.length === 0) {
    res.status(409).json({ error: "No active admin is available for seed assignment" });
    return;
  }
  const activityCounts = await Promise.all(admins.map(async (admin) => {
    const [row] = await db.select({ count: sql<number>`cast(count(*) as int)` }).from(activityLogTable).where(eq(activityLogTable.userId, admin.id));
    return { admin, count: row?.count ?? 0 };
  }));
  activityCounts.sort((a, b) => b.count - a.count || a.admin.id - b.admin.id);
  const primaryAdmin = activityCounts[0].admin;
  const activeUsers = await db.query.usersTable.findMany({ where: eq(usersTable.isActive, true) });
  const activeUsersBySlug = new Map(
    activeUsers
      .filter((candidate) => candidate.slug)
      .map((candidate) => [candidate.slug!, candidate]),
  );
  const calvin = activeUsersBySlug.get("calvin");
  const seededAt = new Date();
  let created = 0;
  let existing = 0;
  let activitiesAdded = 0;
  for (const definition of SEED_DEALS) {
    const { dealName, stage, amount, approxGm, actualGm, note, intendedRepSlug = null } = definition;
    const intendedRep = intendedRepSlug ? activeUsersBySlug.get(intendedRepSlug) : undefined;
    const assignedTo = intendedRep?.id ?? primaryAdmin.id;
    const found = await db.query.dealsTable.findFirst({ where: eq(dealsTable.dealName, dealName) });
    let deal = found;
    if (!deal) {
      [deal] = await db.insert(dealsTable).values({
        dealName,
        stage,
        amount,
        approxGm,
        actualGm,
        assignedTo,
        intendedRepSlug,
        fundedAt: stage === "funded" ? seededAt : null,
      }).returning();
      created++;
    } else {
      existing++;
      // Backfill the marker on deals created by the earlier seed definition.
      // Assignment remains untouched; sign-in reconciliation owns reassignment.
      const existingDeal = deal;
      if (existingDeal && existingDeal.intendedRepSlug !== intendedRepSlug) {
        [deal] = await db.update(dealsTable)
          .set({ intendedRepSlug, updatedAt: new Date() })
          .where(eq(dealsTable.id, existingDeal.id))
          .returning();
      }
    }
    if (note && deal) {
      const prior = await db.query.activityLogTable.findFirst({ where: and(eq(activityLogTable.dealId, deal.id), eq(activityLogTable.action, "seed_note")) });
      if (!prior) {
        await logActivity({ userId: primaryAdmin.id, dealId: deal.id, action: "seed_note", entityType: "deal", entityId: deal.id, details: { note } });
        activitiesAdded++;
      }
    }
  }
  res.json({ created, existing, activitiesAdded, primaryAdminId: primaryAdmin.id, assignedCalvinId: calvin?.id ?? null });
});

export default router;