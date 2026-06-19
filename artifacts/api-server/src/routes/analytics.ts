import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  leadsTable,
  usersTable,
  communicationsTable,
  emailSendsTable,
  leadStatusHistoryTable,
} from "@workspace/db";
import { eq, and, gte, lte, sql, inArray } from "drizzle-orm";
import { requireUser } from "../lib/authHelpers";

const router: IRouter = Router();

const FUNNEL_ORDER = [
  "new_lead",
  "contacted",
  "application_received",
  "submitted_to_underwriting",
  "approved",
  "funded",
] as const;

const APPLICATION_STATUSES = ["application_received", "submitted_to_underwriting", "approved", "funded"] as const;
const APPROVAL_STATUSES = ["approved", "funded"] as const;

function parseDateRange(req: Request): { startDate?: Date; endDate?: Date; repId?: number } {
  const { start_date, end_date, rep_id } = req.query as Record<string, string | undefined>;
  const startDate = start_date ? new Date(start_date) : undefined;
  const endDate = end_date ? new Date(end_date + "T23:59:59.999Z") : undefined;
  const repId = rep_id ? parseInt(rep_id, 10) : undefined;
  return { startDate, endDate, repId };
}

function leadDateWhere(startDate?: Date, endDate?: Date, repId?: number) {
  const clauses = [];
  if (startDate) clauses.push(gte(leadsTable.createdAt, startDate));
  if (endDate) clauses.push(lte(leadsTable.createdAt, endDate));
  if (repId && !isNaN(repId)) clauses.push(eq(leadsTable.assignedRepId, repId));
  return clauses.length ? and(...clauses) : undefined;
}

// GET /analytics/summary
router.get("/analytics/summary", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const { startDate, endDate, repId } = parseDateRange(req);

  // Reps can only see their own data
  const effectiveRepId = user.role === "rep" ? user.id : repId;

  const where = leadDateWhere(startDate, endDate, effectiveRepId);

  const [allLeads, fundedTimeRows] = await Promise.all([
    db
      .select({ status: leadsTable.status, count: sql<number>`cast(count(*) as int)` })
      .from(leadsTable)
      .where(where)
      .groupBy(leadsTable.status),

    // Avg time from lead created to funded status in history
    db
      .select({
        avgDays: sql<number>`avg(extract(epoch from (lsh."created_at" - l."created_at")) / 86400)`,
      })
      .from(leadStatusHistoryTable)
      .innerJoin(leadsTable, eq(leadStatusHistoryTable.leadId, leadsTable.id))
      .where(
        and(
          eq(leadStatusHistoryTable.toStatus, "funded"),
          startDate ? gte(leadsTable.createdAt, startDate) : undefined,
          endDate ? lte(leadsTable.createdAt, endDate) : undefined,
          effectiveRepId ? eq(leadsTable.assignedRepId, effectiveRepId) : undefined,
        ),
      ),
  ]);

  const countByStatus: Record<string, number> = {};
  for (const row of allLeads) {
    if (row.status) countByStatus[row.status] = row.count;
  }

  const totalLeads = Object.values(countByStatus).reduce((a, b) => a + b, 0);
  const totalApplications = APPLICATION_STATUSES.reduce((a, s) => a + (countByStatus[s] ?? 0), 0);
  const totalApprovals = APPROVAL_STATUSES.reduce((a, s) => a + (countByStatus[s] ?? 0), 0);
  const totalFundings = countByStatus["funded"] ?? 0;
  const conversionRate = totalLeads > 0 ? Math.round((totalFundings / totalLeads) * 10000) / 100 : 0;
  const avgFundingTimeDays =
    fundedTimeRows[0]?.avgDays != null ? Math.round(fundedTimeRows[0].avgDays * 10) / 10 : null;

  res.json({
    totalLeads,
    totalApplications,
    totalApprovals,
    totalFundings,
    conversionRate,
    avgFundingTimeDays,
  });
});

// GET /analytics/pipeline
router.get("/analytics/pipeline", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const { startDate, endDate, repId } = parseDateRange(req);
  const effectiveRepId = user.role === "rep" ? user.id : repId;
  const where = leadDateWhere(startDate, endDate, effectiveRepId);

  const rows = await db
    .select({ status: leadsTable.status, count: sql<number>`cast(count(*) as int)` })
    .from(leadsTable)
    .where(where)
    .groupBy(leadsTable.status);

  const countByStatus: Record<string, number> = {};
  for (const row of rows) {
    if (row.status) countByStatus[row.status] = row.count;
  }

  const stages = FUNNEL_ORDER.map((status, idx) => {
    const count = countByStatus[status] ?? 0;
    const prevCount = idx > 0 ? (countByStatus[FUNNEL_ORDER[idx - 1]] ?? 0) : null;
    const conversionFromPrevious =
      prevCount !== null && prevCount > 0 ? Math.round((count / prevCount) * 10000) / 100 : null;
    return { status, count, conversionFromPrevious };
  });

  res.json({ stages });
});

// GET /analytics/reps
router.get("/analytics/reps", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  if (user.role === "rep") {
    return void res.status(403).json({ error: "Forbidden: managers and admins only" });
  }

  const { startDate, endDate } = parseDateRange(req);

  const leadDateClauses = [];
  if (startDate) leadDateClauses.push(gte(leadsTable.createdAt, startDate));
  if (endDate) leadDateClauses.push(lte(leadsTable.createdAt, endDate));
  const leadWhere = leadDateClauses.length ? and(...leadDateClauses) : undefined;

  const commDateClauses = [];
  if (startDate) commDateClauses.push(gte(communicationsTable.createdAt, startDate));
  if (endDate) commDateClauses.push(lte(communicationsTable.createdAt, endDate));
  const commWhere = commDateClauses.length ? and(...commDateClauses) : undefined;

  const emailDateClauses = [];
  if (startDate) emailDateClauses.push(gte(emailSendsTable.createdAt, startDate));
  if (endDate) emailDateClauses.push(lte(emailSendsTable.createdAt, endDate));
  const emailWhere = emailDateClauses.length ? and(...emailDateClauses) : undefined;

  const [reps, leadCounts, callCounts, smsCounts, emailCounts] = await Promise.all([
    db.select().from(usersTable).where(eq(usersTable.isActive, true)),

    db
      .select({
        repId: leadsTable.assignedRepId,
        status: leadsTable.status,
        count: sql<number>`cast(count(*) as int)`,
      })
      .from(leadsTable)
      .where(leadWhere)
      .groupBy(leadsTable.assignedRepId, leadsTable.status),

    db
      .select({
        userId: communicationsTable.userId,
        count: sql<number>`cast(count(*) as int)`,
      })
      .from(communicationsTable)
      .where(
        and(
          eq(communicationsTable.type, "call"),
          eq(communicationsTable.direction, "outbound"),
          commWhere,
        ),
      )
      .groupBy(communicationsTable.userId),

    db
      .select({
        userId: communicationsTable.userId,
        count: sql<number>`cast(count(*) as int)`,
      })
      .from(communicationsTable)
      .where(
        and(
          eq(communicationsTable.type, "sms"),
          eq(communicationsTable.direction, "outbound"),
          commWhere,
        ),
      )
      .groupBy(communicationsTable.userId),

    db
      .select({
        userId: emailSendsTable.userId,
        count: sql<number>`cast(count(*) as int)`,
      })
      .from(emailSendsTable)
      .where(emailWhere)
      .groupBy(emailSendsTable.userId),
  ]);

  const callMap: Record<number, number> = {};
  for (const r of callCounts) if (r.userId) callMap[r.userId] = r.count;

  const smsMap: Record<number, number> = {};
  for (const r of smsCounts) if (r.userId) smsMap[r.userId] = r.count;

  const emailMap: Record<number, number> = {};
  for (const r of emailCounts) if (r.userId) emailMap[r.userId] = r.count;

  // leadCounts grouped by repId + status
  type LeadCountEntry = { repId: number | null; status: string | null; count: number };
  const leadByRepStatus: Record<number, Record<string, number>> = {};
  for (const r of leadCounts as LeadCountEntry[]) {
    if (!r.repId || !r.status) continue;
    if (!leadByRepStatus[r.repId]) leadByRepStatus[r.repId] = {};
    leadByRepStatus[r.repId][r.status] = r.count;
  }

  const result = reps.map((rep) => {
    const statusMap = leadByRepStatus[rep.id] ?? {};
    const leadsCount = Object.values(statusMap).reduce((a, b) => a + b, 0);
    const applications = APPLICATION_STATUSES.reduce((a, s) => a + (statusMap[s] ?? 0), 0);
    const approvals = APPROVAL_STATUSES.reduce((a, s) => a + (statusMap[s] ?? 0), 0);
    const fundings = statusMap["funded"] ?? 0;
    return {
      repId: rep.id,
      repName: rep.name ?? rep.email,
      leadsCount,
      callsMade: callMap[rep.id] ?? 0,
      smsSent: smsMap[rep.id] ?? 0,
      emailsSent: emailMap[rep.id] ?? 0,
      applications,
      approvals,
      fundings,
    };
  });

  res.json(result);
});

// GET /analytics/sources
router.get("/analytics/sources", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const { startDate, endDate, repId } = parseDateRange(req);
  const effectiveRepId = user.role === "rep" ? user.id : repId;

  const clauses = [];
  if (startDate) clauses.push(gte(leadsTable.createdAt, startDate));
  if (endDate) clauses.push(lte(leadsTable.createdAt, endDate));
  if (effectiveRepId) clauses.push(eq(leadsTable.assignedRepId, effectiveRepId));
  const where = clauses.length ? and(...clauses) : undefined;

  const rows = await db
    .select({
      source: leadsTable.leadSource,
      status: leadsTable.status,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(leadsTable)
    .where(where)
    .groupBy(leadsTable.leadSource, leadsTable.status);

  const sourceMap: Record<string, { totalCount: number; fundedCount: number }> = {};
  for (const row of rows) {
    const src = row.source ?? "manual";
    if (!sourceMap[src]) sourceMap[src] = { totalCount: 0, fundedCount: 0 };
    sourceMap[src].totalCount += row.count;
    if (row.status === "funded") sourceMap[src].fundedCount += row.count;
  }

  const result = Object.entries(sourceMap).map(([source, { totalCount, fundedCount }]) => ({
    source,
    leadCount: totalCount,
    fundedCount,
    conversionRate: totalCount > 0 ? Math.round((fundedCount / totalCount) * 10000) / 100 : 0,
  }));

  res.json(result);
});

// GET /analytics/communications
router.get("/analytics/communications", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const { startDate, endDate, repId } = parseDateRange(req);
  const effectiveRepId = user.role === "rep" ? user.id : repId;
  const granularity = (req.query["granularity"] as string) === "weekly" ? "week" : "day";

  const clauses = [];
  if (startDate) clauses.push(gte(communicationsTable.createdAt, startDate));
  if (endDate) clauses.push(lte(communicationsTable.createdAt, endDate));
  if (effectiveRepId) clauses.push(eq(communicationsTable.userId, effectiveRepId));
  const where = clauses.length ? and(...clauses) : undefined;

  const rows = await db
    .select({
      date: sql<string>`date_trunc(${granularity}, ${communicationsTable.createdAt})::date::text`,
      type: communicationsTable.type,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(communicationsTable)
    .where(where)
    .groupBy(
      sql`date_trunc(${granularity}, ${communicationsTable.createdAt})::date::text`,
      communicationsTable.type,
    )
    .orderBy(sql`date_trunc(${granularity}, ${communicationsTable.createdAt})::date::text`);

  // Merge call + sms into same date entry
  const dateMap: Record<string, { date: string; calls: number; sms: number }> = {};
  for (const row of rows) {
    const d = row.date;
    if (!dateMap[d]) dateMap[d] = { date: d, calls: 0, sms: 0 };
    if (row.type === "call") dateMap[d].calls += row.count;
    if (row.type === "sms") dateMap[d].sms += row.count;
  }

  res.json(Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date)));
});

export default router;
