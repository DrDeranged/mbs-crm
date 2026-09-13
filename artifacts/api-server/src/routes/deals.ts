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
import { logActivity } from "../lib/activityHelper";
import { CreateDealBody, UpdateDealBody, ConvertLeadToDealBody } from "@workspace/api-zod";

const router: IRouter = Router();
const stageSchema = z.enum(DEAL_STAGES);
const dealInputSchema = CreateDealBody;
const dealUpdateSchema = UpdateDealBody;
const conversionSchema = ConvertLeadToDealBody;
const idSchema = z.coerce.number().int().positive();

const ACTIVE_STAGES = DEAL_STAGES.filter((stage) => !["funded", "declined", "dead", "hold_on"].includes(stage));

function toApi(deal: typeof dealsTable.$inferSelect, assignedUser?: typeof usersTable.$inferSelect | null) {
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
  const [rows, totals] = await Promise.all([
    db.query.dealsTable.findMany({
      where,
      with: { assignedUser: true },
      orderBy: [desc(dealsTable.updatedAt), asc(dealsTable.id)],
      limit,
      offset: (page - 1) * limit,
    }),
    db.select({ total: sql<number>`cast(count(*) as int)` }).from(dealsTable).where(where),
  ]);
  const total = totals[0]?.total ?? 0;
  res.json({
    deals: rows.map((deal) => toApi(deal, deal.assignedUser)),
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
  res.json({
    ...toApi(deal, deal.assignedUser),
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

const SEED_DEALS: Array<[string, typeof DEAL_STAGES[number], number | null, number | null, number | null, string | null, boolean]> = [
  ["Fastgrass Hydroseed LLC", "submitted", 65000, 8000, null, "Customer held out another month", false],
  ["Heartlands Entertainment LLC", "submitted", 250000, 20000, null, "Awaiting Banks", false],
  ["University of Illinois", "in_funding", 365000, 12000, 12000, "In Funding", false],
  ["Browns Farm", "information_needed", 40000, null, null, "Ghosted", false],
  ["Emerald Hydroturf", "information_needed", 65000, null, null, "Awaiting App/Banks/Quote", false],
  ["Frisco Station Arcade", "dead", null, null, null, "Lost deal, Declined", false],
  ["Bryce Roder dba SETX Hydroseed", "dead", null, null, null, "Did not need", false],
  ["Jim (Moss Deal)", "hold_on", 120000, null, null, null, false],
  ["Wyatt (Kincaid Deal)", "dead", 123000, null, null, null, false],
  ["Integrity Outdoor Services", "submitted", 65000, 12000, 6000, "Docs In, customer ghosted", false],
  ["Jared Yost dba Tribal AG", "approved", 225000, 22000, 12000, "Waiting on docs from CPA", false],
  ["Cornell University", "approved", 504000, 15000, 15000, "Waiting on signed proposal", false],
  ["Talya Friend", "dead", 40000, 4000, null, "Tesla Chargers, waiting on App and Banks", false],
  ["Diamond AG", "going_to_funding", 360000, 25000, null, "Waiting SOS", false],
  ["Oregon Hydroseed", "submitted", 116000, 10000, null, "May want to hold off, trying better option", false],
  ["AM Global Investments", "declined", 10000, 2000, null, null, false],
  ["Slick City Water Park", "waiting_on_app", 1000000, 40000, null, "Spoke to Pat, doing app and quotes", false],
  ["5 Boys Moving", "declined", 36000, 3000, null, "sent quote", false],
  ["Mitchell & Vereen Transportation LLC", "funded", 30000, null, null, "Calvin's deal → assign", true],
  ["Four Pillars", "in_funding", 118000, null, null, "Calvin's deal", true],
  ["Antleys", "submitted", 36000, null, null, "Calvin's deal", true],
  ["R2Muse Trucking", "submitted", 37000, null, null, "Calvin's deal", true],
  ["Erosion Specialist", "funded", 17000, 2300, 2300, "Booked", false],
  ["TP K1 Speed", "funded", 1500000, 35000, 25500, "Funded", false],
  ["Jared Yost dba Tribal AG (funded tranche)", "funded", 110000, 9000, 8800, "Booked", false],
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
  const calvin = await db.query.usersTable.findFirst({ where: and(eq(usersTable.slug, "calvin"), eq(usersTable.isActive, true)) });
  const seededAt = new Date();
  let created = 0;
  let existing = 0;
  let activitiesAdded = 0;
  for (const [dealName, stage, amount, approxGm, actualGm, note, isCalvin] of SEED_DEALS) {
    const assignedTo = isCalvin ? (calvin?.id ?? primaryAdmin.id) : primaryAdmin.id;
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
        fundedAt: stage === "funded" ? seededAt : null,
      }).returning();
      created++;
    } else {
      existing++;
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