import { Router, type IRouter, type Request, type Response } from "express";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  sql,
} from "drizzle-orm";
import { z } from "zod/v4";
import {
  activityLogTable,
  dealsTable,
  leadsTable,
  usersTable,
  DEAL_STAGES,
  dealApprovalsTable,
  documentsTable,
  lendersTable,
} from "@workspace/db";
import { db } from "@workspace/db";
import { getUserDisplayName, requireUser, userToApi } from "../lib/authHelpers";
import { getLatestActivities, logActivity } from "../lib/activityHelper";
import { sanitizeLikeInput } from "../lib/sanitize";
import { writeCsvRow } from "../lib/csv";
import { dealCsvHeaders, dealCsvRow } from "../lib/dealsCsv";
import { fundedActualGmAggregate } from "../lib/dealMetrics";
import { correctSeededDealOwnership } from "../lib/productionMaintenance";
import { normalizeFundingTimeDays } from "../lib/analyticsHelpers";
import {
  CreateDealBody,
  UpdateDealBody,
  ConvertLeadToDealBody,
  CreateDealApprovalBody,
  SaveDealRatePointsBody,
} from "@workspace/api-zod";
import { latestDealActivitySort } from "../lib/latestActivitySort";
import { activeDealStageCondition } from "../lib/activeDealStages";
import {
  buildDealHydrationWhere,
  buildDealPageIdsQuery,
  reorderByIds,
} from "../lib/twoPhaseQueries";
import { annuityPayment, calculateRatePoints } from "../lib/ratePoints";

const router: IRouter = Router();
const stageSchema = z.enum(DEAL_STAGES);
const dealInputSchema = CreateDealBody;
const dealUpdateSchema = UpdateDealBody;
const conversionSchema = ConvertLeadToDealBody;
const idSchema = z.coerce.number().int().positive();
export const dealListQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  include_archived: z.enum(["true", "false"]).optional(),
  rep_id: z.coerce.number().int().positive().optional(),
  lead_id: z.coerce.number().int().positive().optional(),
  stage: z.union([z.string(), z.array(z.string())]).optional(),
  stages: z.union([z.string(), z.array(z.string())]).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  start_date: z.iso.date().optional(),
  end_date: z.iso.date().optional(),
  sort_by: z.enum(["createdAt", "updatedAt", "dealName", "stage", "lastActivityAt"]).optional(),
  sort_order: z.enum(["asc", "desc"]).optional(),
}).strict();
type DealListQuery = z.infer<typeof dealListQuery>;

function parseDealListQuery(req: Request, res: Response): DealListQuery | null {
  const parsed = dealListQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: `Invalid ${parsed.error.issues[0]?.path.join(".") || "query"}` });
    return null;
  }
  return parsed.data;
}
function validGmSplitPct(value: number | undefined): boolean {
  return (
    value === undefined ||
    (Number.isInteger(value) && value >= 0 && value <= 100)
  );
}

function toApi(
  deal: typeof dealsTable.$inferSelect,
  assignedUser?: typeof usersTable.$inferSelect | null,
  latestActivity?: {
    createdAt: Date;
    user?: typeof usersTable.$inferSelect | null;
  } | null,
) {
  return {
    id: deal.id,
    leadId: deal.leadId,
    dealName: deal.dealName,
    stage: deal.stage,
    amount: deal.amount ?? null,
    approxGm: deal.approxGm ?? null,
    actualGm: deal.actualGm ?? null,
    notes: deal.notes ?? null,
    gmSplitPct: deal.gmSplitPct ?? 100,
    assignedTo: deal.assignedTo ?? null,
    assignedUser: assignedUser ? userToApi(assignedUser) : null,
    createdAt: deal.createdAt.toISOString(),
    updatedAt: deal.updatedAt.toISOString(),
    fundedAt: deal.fundedAt?.toISOString() ?? null,
    isArchived: deal.isArchived,
    lastActivityAt: latestActivity?.createdAt.toISOString() ?? null,
    lastActivityActor: latestActivity?.user
      ? userToApi(latestActivity.user)
      : null,
  };
}

const NOTE_ACTIVITY_LIMIT = 160;
function activityNote(value: string | null | undefined): string | null {
  if (value == null) return null;
  return value.length > NOTE_ACTIVITY_LIMIT
    ? `${value.slice(0, NOTE_ACTIVITY_LIMIT)}…`
    : value;
}

function parseStages(
  value: string | string[] | undefined,
): (typeof DEAL_STAGES)[number][] | null {
  if (!value) return null;
  const values = (Array.isArray(value) ? value : [value])
    .flatMap((part) => part.split(","))
    .map((stage) => stage.trim())
    .filter(Boolean);
  const parsed: (typeof DEAL_STAGES)[number][] = [];
  for (const value of values) {
    const stage = stageSchema.safeParse(value);
    if (!stage.success) return null;
    parsed.push(stage.data);
  }
  return parsed;
}

function parseId(req: Request, res: Response): number | null {
  const parsed = idSchema.safeParse(req.params.id);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid deal id" });
    return null;
  }
  return parsed.data;
}

function canAccessDeal(
  user: typeof usersTable.$inferSelect,
  deal: typeof dealsTable.$inferSelect,
) {
  return user.role !== "rep" || deal.assignedTo === user.id;
}

async function findDeal(id: number) {
  return db.query.dealsTable.findFirst({
    where: eq(dealsTable.id, id),
    with: { assignedUser: true, lead: true },
  });
}

function dateConditions(q: DealListQuery, table = dealsTable) {
  const clauses: any[] = [];
  if (q.start_date) clauses.push(gte(table.createdAt, new Date(q.start_date)));
  if (q.end_date)
    clauses.push(lte(table.createdAt, new Date(`${q.end_date}T23:59:59.999Z`)));
  return clauses;
}

/**
 * Shared ownership scope for the list and CSV export. In particular, query
 * parameters must never let a representative widen beyond their assignments.
 */
export function exportDealScopeConditions(
  user: Pick<typeof usersTable.$inferSelect, "id" | "role">,
  query: DealListQuery,
): any[] {
  const conditions: any[] = [];
  if (query.include_archived !== "true") {
    conditions.push(eq(dealsTable.isArchived, false));
  }
  if (user.role === "rep") {
    conditions.push(eq(dealsTable.assignedTo, user.id));
  } else if (query.rep_id) {
    conditions.push(eq(dealsTable.assignedTo, Number(query.rep_id)));
  }
  if (query.lead_id) {
    conditions.push(eq(dealsTable.leadId, Number(query.lead_id)));
  }
  return conditions;
}

// Register this static path before the dynamic /deals/:id route below. Keeping
// it as a named handler makes the precedence explicit without special-casing
// "export" in the ID parser.
router.get("/deals/export", createExportDealsHandler());

router.get("/deals", async (req, res): Promise<void> => {
  const user = await requireUser(req, res);
  if (!user) return;
  const q = parseDealListQuery(req, res);
  if (!q) return;
  const page = q.page ?? 1;
  const limit = q.limit ?? 25;
  const conditions: any[] = [];
  if (q.include_archived !== "true")
    conditions.push(eq(dealsTable.isArchived, false));
  if (user.role === "rep") conditions.push(eq(dealsTable.assignedTo, user.id));
  if (q.rep_id && user.role !== "rep")
    conditions.push(eq(dealsTable.assignedTo, Number(q.rep_id)));
  if (q.lead_id) conditions.push(eq(dealsTable.leadId, Number(q.lead_id)));
  if (q.stages || q.stage) {
    const stages = parseStages(q.stages ?? q.stage);
    if (!stages || stages.length === 0) {
      res.status(400).json({ error: "Invalid deal stage" });
      return;
    }
    conditions.push(inArray(dealsTable.stage, stages));
  }
  if (q.search)
    conditions.push(
      ilike(dealsTable.dealName, `%${sanitizeLikeInput(q.search)}%`),
    );
  conditions.push(...dateConditions(q));
  const where = and(...conditions);
  const sortField = q.sort_by ?? "updatedAt";
  const sortDirection = q.sort_order === "asc" ? asc : desc;
  const latestActivitySort = latestDealActivitySort();
  const validSortFields: Record<string, any> = {
    createdAt: dealsTable.createdAt,
    updatedAt: dealsTable.updatedAt,
    dealName: dealsTable.dealName,
    stage: dealsTable.stage,
    lastActivityAt: latestActivitySort,
  };
  const sortColumn = validSortFields[sortField] ?? dealsTable.updatedAt;
  const totalQuery = db
    .select({ total: sql<number>`cast(count(*) as int)` })
    .from(dealsTable)
    .where(where);
  let rows: any[];
  let total: number;
  if (sortField === "lastActivityAt") {
    const [dealIdRows, totals] = await Promise.all([
      buildDealPageIdsQuery(
        db,
        where,
        [sortDirection(sortColumn), asc(dealsTable.id)],
        limit,
        (page - 1) * limit,
      ),
      totalQuery,
    ]);
    const dealIds = dealIdRows.map((row: { id: number }) => row.id);
    const hydrated =
      dealIds.length === 0
        ? []
        : await db.query.dealsTable.findMany({
            where: buildDealHydrationWhere(dealIds),
            with: { assignedUser: true },
          });
    rows = reorderByIds(hydrated, dealIds);
    total = totals[0]?.total ?? 0;
  } else {
    const [hydrated, totals] = await Promise.all([
      db.query.dealsTable.findMany({
        where,
        with: { assignedUser: true },
        orderBy: [sortDirection(sortColumn), asc(dealsTable.id)],
        limit,
        offset: (page - 1) * limit,
      }),
      totalQuery,
    ]);
    rows = hydrated;
    total = totals[0]?.total ?? 0;
  }
  const latestActivities = await getLatestActivities(
    "deal",
    rows.map((deal) => deal.id),
  );
  res.json({
    deals: rows.map((deal) =>
      toApi(deal, deal.assignedUser, latestActivities.get(deal.id)),
    ),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

export function createExportDealsHandler(dependencies: {
  database?: Pick<typeof db, "transaction">;
  authenticate?: typeof requireUser;
  recordActivity?: typeof logActivity;
} = {}) {
  const database = dependencies.database ?? db;
  const authenticate = dependencies.authenticate ?? requireUser;
  const recordActivity = dependencies.recordActivity ?? logActivity;
  return async function exportDeals(req: Request, res: Response): Promise<void> {
  const user = await authenticate(req, res);
  if (!user) return;

  const q = parseDealListQuery(req, res);
  if (!q) return;
  // This helper retains the representative restriction even when the request
  // carries another rep_id.
  const conditions = exportDealScopeConditions(user, q);
  if (q.stages || q.stage) {
    const stages = parseStages(q.stages ?? q.stage);
    if (!stages || stages.length === 0) {
      res.status(400).json({ error: "Invalid deal stage" });
      return;
    }
    conditions.push(inArray(dealsTable.stage, stages));
  }
  if (q.search)
    conditions.push(
      ilike(dealsTable.dealName, `%${sanitizeLikeInput(q.search)}%`),
    );
  conditions.push(...dateConditions(q));
  const where = and(...conditions);
  const sortField = q.sort_by ?? "updatedAt";
  const sortDirection = q.sort_order === "asc" ? asc : desc;
  const latestActivitySort = latestDealActivitySort();
  const validSortFields: Record<string, any> = {
    createdAt: dealsTable.createdAt,
    updatedAt: dealsTable.updatedAt,
    dealName: dealsTable.dealName,
    stage: dealsTable.stage,
    lastActivityAt: latestActivitySort,
  };
  const sortColumn = validSortFields[sortField] ?? dealsTable.updatedAt;
  const today = new Date().toISOString().slice(0, 10);
  res.status(200);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="mbs-deals-${today}.csv"`,
  );
  res.flushHeaders();
  await writeCsvRow(res, [...dealCsvHeaders]);

  let exported = 0;
  const batchSize = 1000;
  const latestActivityRequested = sortField === "lastActivityAt";
  await database.transaction(async (tx) => {
    // A repeatable-read snapshot prevents mutable deal/activity rows from
    // moving between batches and being duplicated or skipped.
    await tx.execute(sql`set transaction isolation level repeatable read`);
    let offset = 0;
    while (!res.destroyed) {
      const deals = latestActivityRequested
        ? await (async () => {
            const pageRows = await buildDealPageIdsQuery(
              tx,
              where,
              [sortDirection(sortColumn), asc(dealsTable.id)],
              batchSize,
              offset,
            );
            const pageIds = pageRows.map((row: { id: number }) => row.id);
            if (pageIds.length === 0) return [];
            const hydrated = await tx.query.dealsTable.findMany({
              where: buildDealHydrationWhere(pageIds),
              with: { assignedUser: true },
            });
            return reorderByIds(hydrated, pageIds);
          })()
        : await tx.query.dealsTable.findMany({
            where,
            with: { assignedUser: true },
            orderBy: [sortDirection(sortColumn), asc(dealsTable.id)],
            limit: batchSize,
            offset,
          });
      if (deals.length === 0) break;
      const activityRows = await tx
        .selectDistinctOn([activityLogTable.dealId], {
          dealId: activityLogTable.dealId,
          createdAt: activityLogTable.createdAt,
        })
        .from(activityLogTable)
        .where(
          inArray(
            activityLogTable.dealId,
            deals.map((deal) => deal.id),
          ),
        )
        .orderBy(
          activityLogTable.dealId,
          desc(activityLogTable.createdAt),
          desc(activityLogTable.id),
        );
      const activityDates = new Map(
        activityRows
          .filter((row) => row.dealId != null)
          .map((row) => [row.dealId!, row.createdAt]),
      );
      for (const deal of deals as any[]) {
        await writeCsvRow(res, dealCsvRow(deal, activityDates.get(deal.id)));
        exported++;
      }
      offset += deals.length;
      if (deals.length < batchSize) break;
    }
  });
  res.end();
  await recordActivity({
    userId: user.id,
    dealId: null,
    leadId: null,
    action: "exported",
    entityType: "deal",
    entityId: 0,
    details: { count: exported },
  });
  };
}

router.post("/deals", async (req, res): Promise<void> => {
  const user = await requireUser(req, res);
  if (!user) return;
  const parsed = dealInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  const data = parsed.data;
  if (!validGmSplitPct(data.gmSplitPct)) {
    res
      .status(400)
      .json({ error: "gmSplitPct must be an integer from 0 to 100" });
    return;
  }
  if (
    user.role === "rep" &&
    data.assignedTo !== undefined &&
    data.assignedTo !== user.id
  ) {
    res.status(403).json({ error: "Reps may only assign deals to themselves" });
    return;
  }
  if (data.stage === "funded" && data.actualGm == null) {
    res
      .status(400)
      .json({ error: "actualGm is required when a deal is funded" });
    return;
  }
  const [deal] = await db
    .insert(dealsTable)
    .values({
      ...data,
      gmSplitPct: data.gmSplitPct ?? 100,
      assignedTo: user.role === "rep" ? user.id : data.assignedTo,
      fundedAt: data.stage === "funded" ? new Date() : null,
    })
    .returning();
  await logActivity({
    userId: user.id,
    dealId: deal.id,
    leadId: deal.leadId,
    action: "created",
    entityType: "deal",
    entityId: deal.id,
  });
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
  const latestActivity =
    activity.length > 0 ? activity[activity.length - 1] : null;
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

export function createUpdateDealHandler(dependencies: {
  database?: any;
  authenticate?: typeof requireUser;
} = {}) {
  const routeDb = dependencies.database ?? db;
  const authenticate = dependencies.authenticate ?? requireUser;
  return async (req: Request, res: Response): Promise<void> => {
  const user = await authenticate(req, res);
  if (!user) return;
  const id = parseId(req, res);
  if (!id) return;
  const parsed = dealUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  if (!validGmSplitPct(parsed.data.gmSplitPct)) {
    res
      .status(400)
      .json({ error: "gmSplitPct must be an integer from 0 to 100" });
    return;
  }
  const existing = await routeDb.query.dealsTable.findFirst({
    where: eq(dealsTable.id, id),
  });
  if (!existing) {
    res.status(404).json({ error: "Deal not found" });
    return;
  }
  if (!canAccessDeal(user, existing)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (
    user.role === "rep" &&
    parsed.data.assignedTo !== undefined &&
    parsed.data.assignedTo !== existing.assignedTo
  ) {
    res.status(403).json({ error: "Reps may not reassign deals" });
    return;
  }
  const nextStage = parsed.data.stage ?? existing.stage;
  const nextActualGm =
    parsed.data.actualGm !== undefined
      ? parsed.data.actualGm
      : existing.actualGm;
  if (nextStage === "funded" && nextActualGm == null) {
    res
      .status(400)
      .json({ error: "actualGm is required when a deal is funded" });
    return;
  }
  const stageChanged =
    parsed.data.stage !== undefined && parsed.data.stage !== existing.stage;
  const notesChanged =
    parsed.data.notes !== undefined && parsed.data.notes !== existing.notes;
  const now = new Date();
  const update: any = { ...parsed.data, updatedAt: now };
  if (nextStage === "funded" && existing.stage !== "funded")
    update.fundedAt = now;
  // Historical funding time is deliberately preserved when a funded deal is moved
  // back to another stage, so analytics retain the first completed funding event.
  const deal = await routeDb.transaction(async (tx: any) => {
    const [updatedDeal] = await tx
      .update(dealsTable)
      .set(update)
      .where(eq(dealsTable.id, id))
      .returning();
    if (stageChanged) {
      await logActivity(
        {
          userId: user.id,
          dealId: id,
          leadId: updatedDeal.leadId,
          action: "stage_changed",
          entityType: "deal",
          entityId: id,
          details: {
            from: existing.stage,
            to: updatedDeal.stage,
            user: user.id,
            userId: user.id,
            timestamp: now.toISOString(),
          },
        },
        tx,
      );
    }
    if (notesChanged) {
      await logActivity(
        {
          userId: user.id,
          dealId: id,
          leadId: updatedDeal.leadId,
          action: "notes_updated",
          entityType: "deal",
          entityId: id,
          details: {
            field: "notes",
            previous: activityNote(existing.notes),
            new: activityNote(updatedDeal.notes),
            next: activityNote(updatedDeal.notes),
          },
        },
        tx,
      );
    }
    return updatedDeal;
  });
  res.json(toApi(deal));
  };
}

router.put("/deals/:id", createUpdateDealHandler());

router.post("/deals/:id/archive", async (req, res): Promise<void> => {
  const user = await requireUser(req, res);
  if (!user) return;
  const id = parseId(req, res);
  if (!id) return;
  const existing = await db.query.dealsTable.findFirst({
    where: eq(dealsTable.id, id),
  });
  if (!existing) {
    res.status(404).json({ error: "Deal not found" });
    return;
  }
  if (!canAccessDeal(user, existing)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const [deal] = await db
    .update(dealsTable)
    .set({ isArchived: true, updatedAt: new Date() })
    .where(eq(dealsTable.id, id))
    .returning();
  await logActivity({
    userId: user.id,
    dealId: id,
    leadId: deal.leadId,
    action: "archived",
    entityType: "deal",
    entityId: id,
  });
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
  const deleted = await db
    .delete(dealsTable)
    .where(eq(dealsTable.id, id))
    .returning({ id: dealsTable.id });
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
  const deal = await db.query.dealsTable.findFirst({
    where: eq(dealsTable.id, id),
  });
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
  res.json(
    rows.map((entry) => ({
      ...entry,
      user: entry.user ? userToApi(entry.user) : null,
      createdAt: entry.createdAt.toISOString(),
    })),
  );
});

export function createSaveDealRatePointsHandler(dependencies: {
  database?: any;
  authenticate?: typeof requireUser;
  recordActivity?: typeof logActivity;
} = {}) {
  const database = dependencies.database ?? db;
  const authenticate = dependencies.authenticate ?? requireUser;
  const recordActivity = dependencies.recordActivity;
  return async (req: Request, res: Response): Promise<void> => {
    const user = await authenticate(req, res);
    if (!user) return;
    const id = parseId(req, res);
    if (!id) return;
    const parsed = SaveDealRatePointsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid rate and points inputs", details: parsed.error.issues });
      return;
    }
    const existing = await database.query.dealsTable.findFirst({ where: eq(dealsTable.id, id) });
    if (!existing) {
      res.status(404).json({ error: "Deal not found" });
      return;
    }
    if (!canAccessDeal(user, existing)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    if (parsed.data.mode === "reverse" && parsed.data.targetPoints == null) {
      res.status(400).json({ error: "targetPoints is required in reverse mode" });
      return;
    }
    if (parsed.data.sourceApprovalId != null) {
      const approval = await database.query.dealApprovalsTable.findFirst({
        where: and(eq(dealApprovalsTable.id, parsed.data.sourceApprovalId), eq(dealApprovalsTable.dealId, id)),
      });
      if (!approval) {
        res.status(400).json({ error: "sourceApprovalId does not belong to this deal" });
        return;
      }
    }
    const buyPayment = annuityPayment(parsed.data.advance, parsed.data.buyNominalRate, parsed.data.term, parsed.data.timing);
    if (parsed.data.mode === "reverse" && buyPayment == null) {
      res.status(400).json({ error: "Unable to calculate the buy-rate payment" });
      return;
    }
    const payment = parsed.data.mode === "reverse"
      ? buyPayment + (parsed.data.advance * parsed.data.targetPoints! / 100) / parsed.data.term
      : parsed.data.payment;
    const calculation = calculateRatePoints({
      advance: parsed.data.advance,
      payment,
      term: parsed.data.term,
      timing: parsed.data.timing,
      buyNominalRate: parsed.data.buyNominalRate,
    });
    if (!calculation || !Number.isFinite(calculation.totalCommission) || calculation.totalCommission < 0) {
      res.status(400).json({ error: "Unable to calculate a non-negative commission from these inputs" });
      return;
    }
    const targetField = existing.stage === "funded" ? "actualGm" : "approxGm";
    const deal = await database.transaction(async (tx: any) => {
      const [updated] = await tx.update(dealsTable)
        .set({ [targetField]: calculation.totalCommission, updatedAt: new Date() })
        .where(eq(dealsTable.id, id))
        .returning();
      const activity = {
        userId: user.id,
        dealId: id,
        leadId: updated.leadId,
        action: "rate_points_saved",
        entityType: "deal",
        entityId: id,
        details: {
          advance: parsed.data.advance,
          payment,
          term: parsed.data.term,
          timing: parsed.data.timing,
          buyNominalRate: parsed.data.buyNominalRate,
          mode: parsed.data.mode,
          targetPoints: parsed.data.targetPoints ?? null,
          sourceApprovalId: parsed.data.sourceApprovalId ?? null,
          nominalRate: calculation.nominalRate,
          effectiveRate: calculation.effectiveRate,
          simpleRate: calculation.simpleRate,
          buyPayment: calculation.buyPayment,
          totalCommission: calculation.totalCommission,
          points: calculation.points,
        },
      };
      if (recordActivity) await recordActivity(activity, tx);
      else await logActivity(activity, tx);
      return updated;
    });
    res.json({ deal: toApi(deal), gmTarget: targetField, calculation });
  };
}

router.post("/deals/:id/rate-points", createSaveDealRatePointsHandler());

function approvalToApi(approval: any) {
  return {
    id: approval.id,
    dealId: approval.dealId,
    lenderId: approval.lenderId,
    lenderName: approval.lender?.name ?? `Lender #${approval.lenderId}`,
    contractType: approval.contractType,
    advance: Number(approval.advance),
    payment: Number(approval.payment),
    term: approval.term,
    downPayment: Number(approval.downPayment),
    tier: approval.tier,
    expiresOn: approval.expiresOn,
    approvalDocumentId: approval.approvalDocumentId ?? null,
    createdAt: approval.createdAt.toISOString(),
  };
}

async function findAccessibleDeal(id: number, user: typeof usersTable.$inferSelect) {
  const deal = await db.query.dealsTable.findFirst({ where: eq(dealsTable.id, id) });
  if (!deal || !canAccessDeal(user, deal)) return null;
  return deal;
}

router.get("/deals/:id/approvals", async (req, res): Promise<void> => {
  const user = await requireUser(req, res);
  if (!user) return;
  const id = parseId(req, res);
  if (!id) return;
  const deal = await findAccessibleDeal(id, user);
  if (!deal) {
    res.status(404).json({ error: "Deal not found" });
    return;
  }
  const rows = await db.query.dealApprovalsTable.findMany({
    where: eq(dealApprovalsTable.dealId, id),
    with: { lender: true },
    orderBy: (table, { desc }) => [desc(table.createdAt), desc(table.id)],
  });
  res.json(rows.map(approvalToApi));
});

router.post("/deals/:id/approvals", async (req, res): Promise<void> => {
  const user = await requireUser(req, res);
  if (!user) return;
  const id = parseId(req, res);
  if (!id) return;
  const deal = await findAccessibleDeal(id, user);
  if (!deal) {
    res.status(404).json({ error: "Deal not found" });
    return;
  }
  const parsed = CreateDealApprovalBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid approval", details: parsed.error.issues });
    return;
  }
  const lender = await db.query.lendersTable.findFirst({ where: eq(lendersTable.id, parsed.data.lenderId) });
  if (!lender) {
    res.status(404).json({ error: "Lender not found" });
    return;
  }
  if (parsed.data.approvalDocumentId != null) {
    const document = await db.query.documentsTable.findFirst({
      where: eq(documentsTable.id, parsed.data.approvalDocumentId),
    });
    const isPdf = document?.fileType === "application/pdf" || document?.filename.toLowerCase().endsWith(".pdf");
    if (
      !document ||
      document.leadId !== deal.leadId ||
      document.category !== "other" ||
      document.label !== "Approval" ||
      !isPdf
    ) {
      res.status(400).json({ error: "Approval document must belong to the deal lead, be a PDF, category other, and have label Approval" });
      return;
    }
  }
  const [approval] = await db.insert(dealApprovalsTable).values({
    dealId: id,
    lenderId: parsed.data.lenderId,
    contractType: parsed.data.contractType,
    advance: parsed.data.advance,
    payment: parsed.data.payment,
    term: parsed.data.term,
    downPayment: parsed.data.downPayment,
    tier: parsed.data.tier,
    expiresOn: parsed.data.expiresOn.toISOString().slice(0, 10),
    approvalDocumentId: parsed.data.approvalDocumentId ?? null,
    createdBy: user.id,
  }).returning();
  await logActivity({
    userId: user.id,
    leadId: deal.leadId,
    dealId: id,
    action: "approval_captured",
    entityType: "deal_approval",
    entityId: approval.id,
    details: {
      lenderId: approval.lenderId,
      contractType: approval.contractType,
      advance: approval.advance,
      payment: approval.payment,
      term: approval.term,
      downPayment: approval.downPayment,
      tier: approval.tier,
      expiresOn: approval.expiresOn,
      approvalDocumentId: approval.approvalDocumentId,
    },
  });
  res.status(201).json(approvalToApi({ ...approval, lender }));
});

router.post("/leads/:id/convert-to-deal", async (req, res): Promise<void> => {
  const user = await requireUser(req, res);
  if (!user) return;
  const leadId = idSchema.safeParse(req.params.id);
  if (!leadId.success) {
    res.status(400).json({ error: "Invalid lead id" });
    return;
  }
  const lead = await db.query.leadsTable.findFirst({
    where: eq(leadsTable.id, leadId.data),
  });
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
  if (!validGmSplitPct(body.data.gmSplitPct)) {
    res
      .status(400)
      .json({ error: "gmSplitPct must be an integer from 0 to 100" });
    return;
  }
  const existing = await db.query.dealsTable.findFirst({
    where: eq(dealsTable.leadId, lead.id),
  });
  if (existing) {
    res
      .status(409)
      .json({ error: "Lead is already linked to a deal", dealId: existing.id });
    return;
  }
  const defaultName =
    lead.companyName ||
    [lead.firstName, lead.lastName].filter(Boolean).join(" ") ||
    `Lead ${lead.id}`;
  const data = body.data;
  const assignedTo =
    user.role === "rep"
      ? user.id
      : data.assignedTo !== undefined
        ? data.assignedTo
        : lead.assignedRepId;
  const stage = data.stage ?? "waiting_on_app";
  if (stage === "funded" && data.actualGm == null) {
    res
      .status(400)
      .json({ error: "actualGm is required when a deal is funded" });
    return;
  }
  const [deal] = await db
    .insert(dealsTable)
    .values({
      leadId: lead.id,
      dealName: data.dealName ?? defaultName,
      stage,
      amount: data.amount !== undefined ? data.amount : lead.requestedAmount,
      approxGm: data.approxGm,
      actualGm: data.actualGm,
      notes: data.notes,
      gmSplitPct: data.gmSplitPct ?? 100,
      assignedTo,
      fundedAt: stage === "funded" ? new Date() : null,
    })
    .returning();
  await logActivity({
    userId: user.id,
    leadId: lead.id,
    dealId: deal.id,
    action: "converted",
    entityType: "deal",
    entityId: deal.id,
    details: { leadId: lead.id },
  });
  res.status(201).json(toApi(deal));
});

router.get("/deals/analytics", async (req, res): Promise<void> => {
  const user = await requireUser(req, res);
  if (!user) return;
  const q = parseDealListQuery(req, res);
  if (!q) return;
  const conditions: any[] = [eq(dealsTable.isArchived, false)];
  const effectiveRepId =
    user.role === "rep" ? user.id : q.rep_id ? Number(q.rep_id) : undefined;
  if (effectiveRepId)
    conditions.push(eq(dealsTable.assignedTo, effectiveRepId));
  conditions.push(...dateConditions(q));
  const where = and(...conditions);
  const activeWhere = and(where, activeDealStageCondition());
  const [
    stageRows,
    fundedRows,
    awaitingRows,
    pipelineRows,
    avgRows,
    users,
    assignedUsers,
  ] = await Promise.all([
    db
      .select({
        stage: dealsTable.stage,
        count: sql<number>`cast(count(*) as int)`,
      })
      .from(dealsTable)
      .where(where)
      .groupBy(dealsTable.stage),
    // Dashboard Funded GM is the stored actual GM; never apply gmSplitPct.
    db
      .select({
        value: fundedActualGmAggregate(),
      })
      .from(dealsTable)
      .where(and(where, eq(dealsTable.stage, "funded"))),
    db
      .select({
        value: sql<number>`cast(coalesce(sum(${dealsTable.approxGm}), 0) as int)`,
      })
      .from(dealsTable)
      .where(activeWhere),
    db
      .select({
        value: sql<number>`cast(coalesce(sum(${dealsTable.amount}), 0) as int)`,
      })
      .from(dealsTable)
      .where(activeWhere),
    db
      .select({
        value: sql<number>`avg(extract(epoch from (${dealsTable.fundedAt} - ${dealsTable.createdAt})) / 86400)`,
      })
      .from(dealsTable)
      .where(
        and(
          where,
          eq(dealsTable.stage, "funded"),
          sql`${dealsTable.fundedAt} > ${dealsTable.createdAt} + interval '5 minutes'`,
        ),
      ),
    db.select().from(usersTable).where(eq(usersTable.isActive, true)),
    db
      .selectDistinct({ userId: dealsTable.assignedTo })
      .from(dealsTable)
      .innerJoin(usersTable, eq(usersTable.id, dealsTable.assignedTo))
      .where(and(where, eq(usersTable.isActive, true))),
  ]);
  const assignedUserIds = new Set(
    assignedUsers.map((assigned) => assigned.userId),
  );
  const performanceUsers = users.filter((candidate) =>
    assignedUserIds.has(candidate.id),
  );
  const visibleReps =
    user.role === "rep"
      ? performanceUsers.filter((rep) => rep.id === user.id)
      : performanceUsers;
  const repRows = await Promise.all(
    visibleReps.map(async (rep) => {
      const repWhere = and(where, eq(dealsTable.assignedTo, rep.id));
      const [active, funded] = await Promise.all([
        db
          .select({ count: sql<number>`cast(count(*) as int)` })
          .from(dealsTable)
          .where(and(repWhere, activeDealStageCondition())),
        db
          .select({
            count: sql<number>`cast(count(*) as int)`,
            gm: sql<number>`cast(coalesce(sum(${dealsTable.actualGm}), 0) as int)`,
          })
          .from(dealsTable)
          .where(and(repWhere, eq(dealsTable.stage, "funded"))),
      ]);
      return {
        repId: rep.id,
        repName: getUserDisplayName(rep, "Unknown"),
        activeDeals: active[0]?.count ?? 0,
        fundedCount: funded[0]?.count ?? 0,
        fundedGm: funded[0]?.gm ?? 0,
      };
    }),
  );
  repRows.sort(
    (a, b) =>
      b.activeDeals - a.activeDeals ||
      b.fundedCount - a.fundedCount ||
      a.repName.localeCompare(b.repName),
  );
  const stageCounts: Record<string, number> = {};
  for (const row of stageRows) stageCounts[row.stage] = row.count;
  const avg = avgRows[0]?.value;
  res.json({
    fundedGm: fundedRows[0]?.value ?? 0,
    awaitingGm: awaitingRows[0]?.value ?? 0,
    pipelineValue: pipelineRows[0]?.value ?? 0,
    avgFundingTimeDays: normalizeFundingTimeDays(
      avg == null ? null : Number(avg),
    ),
    stageCounts,
    reps: repRows,
  });
});

type SeedDealDefinition = {
  dealName: string;
  stage: (typeof DEAL_STAGES)[number];
  amount: number | null;
  approxGm: number | null;
  actualGm: number | null;
  note: string | null;
  intendedRepSlug?: string | null;
};

const SEED_DEALS: SeedDealDefinition[] = [
  {
    dealName: "Fastgrass Hydroseed LLC",
    stage: "submitted",
    amount: 65000,
    approxGm: 8000,
    actualGm: null,
    note: "Customer held out another month",
  },
  {
    dealName: "Heartlands Entertainment LLC",
    stage: "submitted",
    amount: 250000,
    approxGm: 20000,
    actualGm: null,
    note: "Awaiting Banks",
  },
  {
    dealName: "University of Illinois",
    stage: "in_funding",
    amount: 365000,
    approxGm: 12000,
    actualGm: 12000,
    note: "In Funding",
  },
  {
    dealName: "Browns Farm",
    stage: "information_needed",
    amount: 40000,
    approxGm: null,
    actualGm: null,
    note: "Ghosted",
  },
  {
    dealName: "Emerald Hydroturf",
    stage: "information_needed",
    amount: 65000,
    approxGm: null,
    actualGm: null,
    note: "Awaiting App/Banks/Quote",
  },
  {
    dealName: "Frisco Station Arcade",
    stage: "dead",
    amount: null,
    approxGm: null,
    actualGm: null,
    note: "Lost deal, Declined",
  },
  {
    dealName: "Bryce Roder dba SETX Hydroseed",
    stage: "dead",
    amount: null,
    approxGm: null,
    actualGm: null,
    note: "Did not need",
  },
  {
    dealName: "Jim (Moss Deal)",
    stage: "hold_on",
    amount: 120000,
    approxGm: null,
    actualGm: null,
    note: null,
  },
  {
    dealName: "Wyatt (Kincaid Deal)",
    stage: "dead",
    amount: 123000,
    approxGm: null,
    actualGm: null,
    note: null,
  },
  {
    dealName: "Integrity Outdoor Services",
    stage: "submitted",
    amount: 65000,
    approxGm: 12000,
    actualGm: 6000,
    note: "Docs In, customer ghosted",
  },
  {
    dealName: "Jared Yost dba Tribal AG",
    stage: "approved",
    amount: 225000,
    approxGm: 22000,
    actualGm: 12000,
    note: "Waiting on docs from CPA",
  },
  {
    dealName: "Cornell University",
    stage: "approved",
    amount: 504000,
    approxGm: 15000,
    actualGm: 15000,
    note: "Waiting on signed proposal",
  },
  {
    dealName: "Talya Friend",
    stage: "dead",
    amount: 40000,
    approxGm: 4000,
    actualGm: null,
    note: "Tesla Chargers, waiting on App and Banks",
  },
  {
    dealName: "Diamond AG",
    stage: "in_funding",
    amount: 360000,
    approxGm: 25000,
    actualGm: null,
    note: "Waiting SOS",
  },
  {
    dealName: "Oregon Hydroseed",
    stage: "submitted",
    amount: 116000,
    approxGm: 10000,
    actualGm: null,
    note: "May want to hold off, trying better option",
  },
  {
    dealName: "AM Global Investments",
    stage: "declined",
    amount: 10000,
    approxGm: 2000,
    actualGm: null,
    note: null,
  },
  {
    dealName: "Slick City Water Park",
    stage: "waiting_on_app",
    amount: 1000000,
    approxGm: 40000,
    actualGm: null,
    note: "Spoke to Pat, doing app and quotes",
  },
  {
    dealName: "5 Boys Moving",
    stage: "declined",
    amount: 36000,
    approxGm: 3000,
    actualGm: null,
    note: "sent quote",
  },
  {
    dealName: "Mitchell & Vereen Transportation LLC",
    stage: "funded",
    amount: 30000,
    approxGm: null,
    actualGm: null,
    note: "Calvin's deal → assign",
    intendedRepSlug: "calvin",
  },
  {
    dealName: "Four Pillars",
    stage: "in_funding",
    amount: 118000,
    approxGm: null,
    actualGm: null,
    note: "Calvin's deal",
    intendedRepSlug: "calvin",
  },
  {
    dealName: "Antleys",
    stage: "submitted",
    amount: 36000,
    approxGm: null,
    actualGm: null,
    note: "Calvin's deal",
    intendedRepSlug: "calvin",
  },
  {
    dealName: "R2Muse Trucking",
    stage: "submitted",
    amount: 37000,
    approxGm: null,
    actualGm: null,
    note: "Calvin's deal",
    intendedRepSlug: "calvin",
  },
  {
    dealName: "Erosion Specialist",
    stage: "funded",
    amount: 17000,
    approxGm: 2300,
    actualGm: 2300,
    note: "Booked",
  },
  {
    dealName: "TP K1 Speed",
    stage: "funded",
    amount: 1500000,
    approxGm: 35000,
    actualGm: 25500,
    note: "Funded",
  },
  {
    dealName: "Jared Yost dba Tribal AG (funded tranche)",
    stage: "funded",
    amount: 110000,
    approxGm: 9000,
    actualGm: 8800,
    note: "Booked",
  },
];

router.post("/admin/deals/seed", async (req, res): Promise<void> => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") {
    res.status(403).json({ error: "Admins only" });
    return;
  }
  const admins = await db.query.usersTable.findMany({
    where: and(eq(usersTable.role, "admin"), eq(usersTable.isActive, true)),
  });
  if (admins.length === 0) {
    res
      .status(409)
      .json({ error: "No active admin is available for seed assignment" });
    return;
  }
  const activityCounts = await Promise.all(
    admins.map(async (admin) => {
      const [row] = await db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(activityLogTable)
        .where(eq(activityLogTable.userId, admin.id));
      return { admin, count: row?.count ?? 0 };
    }),
  );
  activityCounts.sort((a, b) => b.count - a.count || a.admin.id - b.admin.id);
  const primaryAdmin = activityCounts[0].admin;
  const activeUsers = await db.query.usersTable.findMany({
    where: eq(usersTable.isActive, true),
  });
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
    const {
      dealName,
      stage,
      amount,
      approxGm,
      actualGm,
      note,
      intendedRepSlug = null,
    } = definition;
    const intendedRep = intendedRepSlug
      ? activeUsersBySlug.get(intendedRepSlug)
      : undefined;
    const assignedTo = intendedRep?.id ?? primaryAdmin.id;
    const found = await db.query.dealsTable.findFirst({
      where: eq(dealsTable.dealName, dealName),
    });
    let deal = found;
    if (!deal) {
      [deal] = await db
        .insert(dealsTable)
        .values({
          dealName,
          stage,
          amount,
          approxGm,
          actualGm,
          notes: note,
          assignedTo,
          intendedRepSlug,
          fundedAt: stage === "funded" ? seededAt : null,
        })
        .returning();
      created++;
    } else {
      existing++;
      // Backfill the marker on deals created by the earlier seed definition.
      // Assignment remains untouched; sign-in reconciliation owns reassignment.
      const existingDeal = deal;
      if (existingDeal && existingDeal.intendedRepSlug !== intendedRepSlug) {
        [deal] = await db
          .update(dealsTable)
          .set({ intendedRepSlug, updatedAt: new Date() })
          .where(eq(dealsTable.id, existingDeal.id))
          .returning();
      }
    }
    if (note && deal) {
      const prior = await db.query.activityLogTable.findFirst({
        where: and(
          eq(activityLogTable.dealId, deal.id),
          eq(activityLogTable.action, "seed_note"),
        ),
      });
      if (!prior) {
        await logActivity({
          userId: primaryAdmin.id,
          dealId: deal.id,
          action: "seed_note",
          entityType: "deal",
          entityId: deal.id,
          details: { note },
        });
        activitiesAdded++;
      }
    }
  }
  res.json({
    created,
    existing,
    activitiesAdded,
    primaryAdminId: primaryAdmin.id,
    assignedCalvinId: calvin?.id ?? null,
  });
});

router.post("/admin/deals/reassign-seeded", async (req, res): Promise<void> => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") {
    res.status(403).json({ error: "Admins only" });
    return;
  }

  const result = await correctSeededDealOwnership(user.id).catch(
    (error: unknown) => {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to correct seeded deal ownership";
      res.status(409).json({ error: message });
      return null;
    },
  );
  if (!result) return;
  res.json(result);
});

export default router;
