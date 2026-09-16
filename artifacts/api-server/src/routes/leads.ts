import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { leadsTable, companiesTable, leadStatusHistoryTable, leadAssignmentHistoryTable, activityLogTable, usersTable, dripSequencesTable, dripEnrollmentsTable } from "@workspace/db";
import { deriveKey, checkIdempotency, storeIdempotency } from "../lib/idempotency";
import { matchLeadToLenders } from "../lib/matchingEngine";
import { eq, or, ilike, and, sql, desc, asc, gte, lte, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { getUserDisplayName, requireUser, userToApi } from "../lib/authHelpers";
import { sanitizeLikeInput } from "../lib/sanitize";
import { getLatestActivities, getLeadCreationActivities, logActivity } from "../lib/activityHelper";
import { isUnassignedInboundLead } from "../lib/inboundLead";
import { isEmailSuppressed } from "../lib/emailSafety";
import {
  ListLeadsQueryParams,
  CreateLeadBody,
  GetLeadParams,
  UpdateLeadParams,
  UpdateLeadBody,
  ChangeLeadStatusParams,
  ChangeLeadStatusBody,
  AssignLeadParams,
  AssignLeadBody,
  BulkAssignLeadsBody,
  CaptureLeadFromWebsiteBody,
} from "@workspace/api-zod";
import rateLimit from "express-rate-limit";
import { sendPushNotification } from "../lib/pushNotifications";
import { createNotification, notifyAllManagers } from "../lib/notify";
import { calculateLeadScore } from "../lib/leadScoring";
import { executeWorkflowRules } from "../lib/workflowEngine";
import { isEligibleInboundAssignee, resolveInboundAssignee } from "../lib/leadDistribution";
import { writeCsvRow } from "../lib/csv";
import { isLeadStale } from "../lib/staleLeadPredicate";
import { buildStaleLeadCondition } from "../lib/staleLeadCondition";
import {
  buildLeadHydrationWhere,
  buildLeadPageIdsQuery,
  reorderByIds,
} from "../lib/twoPhaseQueries";

const router: IRouter = Router();
const positiveLeadId = z.coerce.number().int().positive();
export const listLeadsQuery = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  status: z.enum(["new_lead", "contacted", "application_received", "submitted_to_underwriting", "approved", "funded", "declined", "follow_up"]).optional(),
  applicationType: z.enum(["equipment", "working_capital"]).optional(),
  repId: z.coerce.number().int().positive().optional(),
  startDate: z.iso.date().optional(),
  endDate: z.iso.date().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  sortBy: z.enum(["createdAt", "updatedAt", "lastName", "status", "lastActivityAt", "leadScore"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  minScore: z.coerce.number().finite().optional(),
  maxScore: z.coerce.number().finite().optional(),
  renewalFlagged: z.enum(["true", "false"]).optional(),
  stale: z.enum(["true", "false"]).optional(),
  ids: z.string().regex(/^\d+(,\d+)*$/, "Expected comma-separated positive ids").optional(),
}).strict();
type LeadFilter = Pick<z.infer<typeof listLeadsQuery>,
  "search" | "status" | "applicationType" | "repId" | "startDate" | "endDate" |
  "minScore" | "maxScore" | "renewalFlagged" | "stale">;

function parseLeadListQuery(req: Request, res: Response) {
  const parsed = listLeadsQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: `Invalid ${parsed.error.issues[0]?.path.join(".") || "query"}` });
    return null;
  }
  return parsed.data;
}

const captureRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

function leadToApi(
  lead: typeof leadsTable.$inferSelect,
  rep?: typeof usersTable.$inferSelect | null,
  latestActivity?: { createdAt: Date; user?: typeof usersTable.$inferSelect | null } | null,
  createdBy?: { createdAt: Date; user?: typeof usersTable.$inferSelect | null } | null,
  staleThresholdDays = 7,
) {
  // Staleness is based on the activity log itself, rather than the denormalized
  // lead timestamp, so an assigned lead with no logged activity is handled
  // consistently even if legacy data has a populated lastActivityAt.
  const activityAt = latestActivity?.createdAt ?? null;
  const idleSince = activityAt ?? lead.createdAt;
  const now = Date.now();
  const daysIdle = Math.max(0, Math.floor((now - idleSince.getTime()) / (24 * 60 * 60 * 1000)));
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
    requestedAmount: lead.requestedAmount ?? null,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
    lastActivityAt: latestActivity?.createdAt.toISOString() ?? lead.lastActivityAt?.toISOString() ?? null,
    lastActivityActor: latestActivity?.user ? userToApi(latestActivity.user) : null,
    createdBy: createdBy?.user ? userToApi(createdBy.user) : null,
    needsAssignment: isUnassignedInboundLead(lead),
    isStale: isLeadStale(lead.assignedRepId, idleSince, staleThresholdDays, now),
    daysIdle,
    leadScore: lead.leadScore ?? null,
    leadScoreBreakdown: (lead.leadScoreBreakdown as any) ?? null,
    aiSummary: (lead.aiSummary as any) ?? null,
    aiSummaryGeneratedAt: lead.aiSummaryGeneratedAt?.toISOString() ?? null,
    fundedAt: lead.fundedAt?.toISOString() ?? null,
    fundedAmount: lead.fundedAmount ?? null,
    estimatedTermMonths: lead.estimatedTermMonths ?? null,
    renewalFlaggedAt: lead.renewalFlaggedAt?.toISOString() ?? null,
  };
}

async function getStaleThresholdDays() {
  const settings = await db.query.companySettingsTable.findFirst();
  return settings?.staleThresholdDays ?? 7;
}

async function leadToApiWithCurrentActivity(
  lead: typeof leadsTable.$inferSelect,
  rep?: typeof usersTable.$inferSelect | null,
) {
  const [latestActivities, creationActivities, staleThresholdDays] = await Promise.all([
    getLatestActivities("lead", [lead.id]),
    getLeadCreationActivities([lead.id]),
    getStaleThresholdDays(),
  ]);
  return leadToApi(lead, rep, latestActivities.get(lead.id), creationActivities.get(lead.id), staleThresholdDays);
}

type ListLeadsDependencies = {
  database?: typeof db;
  authenticate?: typeof requireUser;
  getLatestActivities?: typeof getLatestActivities;
  getLeadCreationActivities?: typeof getLeadCreationActivities;
  getStaleThresholdDays?: typeof getStaleThresholdDays;
};

/**
 * Build the list handler with its query collaborators injectable. The default
 * collaborators are the production implementations; injection is intentionally
 * limited to this handler so the production router and HTTP integration tests
 * exercise the same two-phase stale-lead orchestration.
 */
export function createListLeadsHandler({
  database = db,
  authenticate = requireUser,
  getLatestActivities: getLatestActivitiesImpl = getLatestActivities,
  getLeadCreationActivities: getLeadCreationActivitiesImpl = getLeadCreationActivities,
  getStaleThresholdDays: getStaleThresholdDaysImpl = getStaleThresholdDays,
}: ListLeadsDependencies = {}) {
  return async (req: Request, res: Response) => {
    const user = await authenticate(req, res);
    if (!user) return;

    const q = parseLeadListQuery(req, res);
    if (!q) return;
    const page = Number(q.page ?? 1);
    const limit = Math.min(Number(q.limit ?? 25), 100);
    const offset = (page - 1) * limit;
    const staleThresholdDays = await getStaleThresholdDaysImpl();

    const conditions: ReturnType<typeof eq>[] = [];
    if (user.role === "rep") conditions.push(eq(leadsTable.assignedRepId, user.id));
    if (q.status) conditions.push(eq(leadsTable.status, q.status));
    if (q.applicationType) conditions.push(eq(leadsTable.applicationType, q.applicationType));
    if (q.repId) conditions.push(eq(leadsTable.assignedRepId, Number(q.repId)));
    if (q.startDate) conditions.push(gte(leadsTable.createdAt, new Date(q.startDate)));
    if (q.endDate) {
      const end = new Date(q.endDate as string);
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(leadsTable.createdAt, end));
    }
    if (q.minScore !== undefined) conditions.push(gte(leadsTable.leadScore, Number(q.minScore)));
    if (q.maxScore !== undefined) conditions.push(lte(leadsTable.leadScore, Number(q.maxScore)));
    if (q.renewalFlagged === "true") {
      conditions.push(sql`${leadsTable.renewalFlaggedAt} is not null` as any);
    }
    if (q.stale === "true") {
      conditions.push(buildStaleLeadCondition(staleThresholdDays) as any);
    }

    let searchCondition: any = undefined;
    if (q.search) {
      const safe = sanitizeLikeInput(q.search);
      searchCondition = or(
        ilike(leadsTable.firstName, `%${safe}%`),
        ilike(leadsTable.lastName, `%${safe}%`),
        ilike(leadsTable.companyName, `%${safe}%`),
        ilike(leadsTable.email, `%${safe}%`),
        ilike(leadsTable.phone, `%${safe}%`),
      );
    }

    const whereClause = conditions.length > 0 || searchCondition
      ? and(...(conditions as any[]), ...(searchCondition ? [searchCondition] : []))
      : undefined;

    const sortField = (q.sortBy as string) || "createdAt";
    const sortDir = q.sortOrder === "asc" ? asc : desc;
    const validSortFields: Record<string, any> = {
      createdAt: leadsTable.createdAt,
      updatedAt: leadsTable.updatedAt,
      lastName: leadsTable.lastName,
      status: leadsTable.status,
      lastActivityAt: leadsTable.lastActivityAt,
      leadScore: leadsTable.leadScore,
    };
    const sortColumn = validSortFields[sortField] ?? leadsTable.createdAt;

    const staleRequested = q.stale === "true";
    let leadsRaw: any[];
    let total: number;
    const totalQuery = database
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(leadsTable)
      .where(whereClause as any);
    if (staleRequested) {
      const [leadIdRows, totals] = await Promise.all([
        buildLeadPageIdsQuery(database, whereClause, [sortDir(sortColumn), asc(leadsTable.id)], limit, offset),
        totalQuery,
      ]);
      const leadIds = leadIdRows.map((row: { id: number }) => row.id);
      const hydrated = leadIds.length === 0
        ? []
        : await database.query.leadsTable.findMany({
          where: buildLeadHydrationWhere(leadIds),
          with: { assignedRep: true },
        });
      leadsRaw = reorderByIds(hydrated, leadIds);
      total = totals[0]?.total ?? 0;
    } else {
      const [rows, totals] = await Promise.all([
        database.query.leadsTable.findMany({
          where: whereClause as any,
          orderBy: [sortDir(sortColumn), asc(leadsTable.id)],
          limit,
          offset,
          with: { assignedRep: true },
        }),
        totalQuery,
      ]);
      leadsRaw = rows;
      total = totals[0]?.total ?? 0;
    }
    const leadIds = leadsRaw.map((lead) => lead.id);
    const [latestActivities, creationActivities] = await Promise.all([
      getLatestActivitiesImpl("lead", leadIds),
      getLeadCreationActivitiesImpl(leadIds),
    ]);

    res.json({
      leads: leadsRaw.map((l) => leadToApi(
        l,
        (l as any).assignedRep,
        latestActivities.get(l.id),
        creationActivities.get(l.id),
        staleThresholdDays,
      )),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  };
}

async function findDuplicate(email?: string, phone?: string, ein?: string) {
  if (!email && !phone && !ein) return null;
  const conditions = [];
  if (email) conditions.push(eq(leadsTable.email, email));
  if (phone) conditions.push(eq(leadsTable.phone, phone));
  if (ein) conditions.push(eq(leadsTable.ein, ein));
  const existing = await db.query.leadsTable.findFirst({
    where: or(...conditions),
  });
  return existing ?? null;
}

router.get("/leads", createListLeadsHandler());

router.post("/leads", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const body = CreateLeadBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid body", details: body.error.issues });
    return;
  }

  const { company, ...leadData } = body.data;

  if (leadData.assignedRepId != null) {
    if (user.role !== "admin" && user.role !== "manager") {
      res.status(403).json({ error: "Only managers and admins may assign leads" });
      return;
    }
    if (!await isEligibleInboundAssignee(leadData.assignedRepId)) {
      res.status(400).json({
        error: "Destination user must be active and eligible for inbound assignment",
      });
      return;
    }
  }

  const dup = await findDuplicate(leadData.email, leadData.phone, leadData.ein);
  if (dup) {
    res.status(409).json({
      duplicate: true,
      existing_lead_id: dup.id,
      existing_lead_name: `${dup.firstName ?? ""} ${dup.lastName ?? ""}`.trim(),
    });
    return;
  }

  const [lead] = await db.insert(leadsTable).values({
    ...leadData,
    applicationType: (leadData.applicationType as any) ?? "working_capital",
    leadSource: (leadData.leadSource as any) ?? "manual",
  }).returning();

  if (company) {
    await db.insert(companiesTable).values({
      leadId: lead.id,
      ...company,
      annualRevenue: company.annualRevenue?.toString(),
    });
  }

  await logActivity({ userId: user.id, leadId: lead.id, action: "lead_created", entityType: "lead", entityId: lead.id });

  res.status(201).json(await leadToApiWithCurrentActivity(lead, null));
});

router.post("/leads/capture", captureRateLimiter, async (req: Request, res: Response) => {
  const body = CaptureLeadFromWebsiteBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }

  // ── Additional server-side validation ──────────────────────────────────
  const name = (body.data as Record<string, unknown>).firstName as string | undefined ?? "";
  const lastName = (body.data as Record<string, unknown>).lastName as string | undefined ?? "";
  const emailVal = body.data.email as string | undefined ?? "";
  const phoneVal = body.data.phone as string | undefined ?? "";
  if (name.length > 100 || lastName.length > 100) {
    res.status(400).json({ error: "Name fields must be 100 characters or fewer" });
    return;
  }
  if (emailVal.length > 254) {
    res.status(400).json({ error: "Email address too long" });
    return;
  }
  if (phoneVal && !/^\+?[\d\s\-().]{7,20}$/.test(phoneVal)) {
    res.status(400).json({ error: "Invalid phone number format" });
    return;
  }
  const companyName = (body.data as Record<string, unknown>).companyName as string | undefined ?? "";
  if (companyName.length > 200) {
    res.status(400).json({ error: "Company name must be 200 characters or fewer" });
    return;
  }

  // ── Idempotency (5-minute window keyed on email+phone) ─────────────────
  const timeBucket = Math.floor(Date.now() / (5 * 60 * 1000)).toString();
  const idempKey = deriveKey(`leads/capture|${emailVal.toLowerCase()}|${phoneVal}|${timeBucket}`);
  const cached = await checkIdempotency(idempKey, "leads/capture");
  if (cached) {
    res.status(201).json(cached);
    return;
  }

  const dup = await findDuplicate(body.data.email, body.data.phone);
  if (dup) {
    res.status(409).json({
      duplicate: true,
      existing_lead_id: dup.id,
      existing_lead_name: `${dup.firstName ?? ""} ${dup.lastName ?? ""}`.trim(),
    });
    return;
  }

  const { rep: repSlug, ...captureData } = body.data;
  const assignedRepId = await resolveInboundAssignee(repSlug);
  const [lead] = await db.insert(leadsTable).values({
    ...captureData,
    applicationType: (captureData.applicationType as any) ?? "working_capital",
    leadSource: "website",
    ...(assignedRepId ? { assignedRepId } : {}),
  }).returning();

  await logActivity({ userId: null, leadId: lead.id, action: "lead_created", entityType: "lead", entityId: lead.id });

  const capturePayload: Record<string, unknown> = { success: true, leadId: lead.id };
  void storeIdempotency(idempKey, "leads/capture", `lead:${lead.id}`, capturePayload);
  res.status(201).json(capturePayload);
});

function buildLeadsWhere(q: LeadFilter, userRole: string, userId: number, staleThresholdDays = 7, now = Date.now()) {
  const conditions: any[] = [];
  if (userRole === "rep") conditions.push(eq(leadsTable.assignedRepId, userId));
  if (q.status) conditions.push(eq(leadsTable.status, q.status));
  if (q.applicationType) conditions.push(eq(leadsTable.applicationType, q.applicationType));
  if (q.repId) conditions.push(eq(leadsTable.assignedRepId, Number(q.repId)));
  if (q.startDate) conditions.push(gte(leadsTable.createdAt, new Date(q.startDate)));
  if (q.endDate) {
    const end = new Date(q.endDate as string);
    end.setHours(23, 59, 59, 999);
    conditions.push(lte(leadsTable.createdAt, end));
  }
  if (q.minScore !== undefined) conditions.push(gte(leadsTable.leadScore, Number(q.minScore)));
  if (q.maxScore !== undefined) conditions.push(lte(leadsTable.leadScore, Number(q.maxScore)));
  if (q.renewalFlagged === "true") {
    conditions.push(sql`${leadsTable.renewalFlaggedAt} is not null`);
  }
  if (q.stale === "true") {
    conditions.push(buildStaleLeadCondition(staleThresholdDays, now));
  }
  let searchCondition: any = undefined;
  if (q.search) {
    const safe = sanitizeLikeInput(q.search);
    searchCondition = or(
      ilike(leadsTable.firstName, `%${safe}%`),
      ilike(leadsTable.lastName, `%${safe}%`),
      ilike(leadsTable.companyName, `%${safe}%`),
      ilike(leadsTable.email, `%${safe}%`),
      ilike(leadsTable.phone, `%${safe}%`),
    );
  }
  return conditions.length > 0 || searchCondition
    ? and(...(conditions as any[]), ...(searchCondition ? [searchCondition] : []))
    : undefined;
}

router.get("/leads/export", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const q = parseLeadListQuery(req, res);
  if (!q) return;
  const staleThresholdDays = await getStaleThresholdDays();
  const staleRequested = q.stale === "true";
  const staleNow = Date.now();
  const whereClause = buildLeadsWhere(q, user.role, user.id, staleThresholdDays, staleNow);

  const ids = q.ids
    ? q.ids.split(",").map(Number)
    : null;
  const leadWhere = ids && ids.length > 0
    ? whereClause
      ? and(whereClause as any, inArray(leadsTable.id, ids))
      : inArray(leadsTable.id, ids)
    : (whereClause as any);
  const sortField = (q.sortBy as string) || "createdAt";
  const sortDirection = q.sortOrder === "asc" ? asc : desc;
  const validSortFields: Record<string, any> = {
    createdAt: leadsTable.createdAt,
    updatedAt: leadsTable.updatedAt,
    lastName: leadsTable.lastName,
    status: leadsTable.status,
    lastActivityAt: leadsTable.lastActivityAt,
    leadScore: leadsTable.leadScore,
  };
  const sortColumn = validSortFields[sortField] ?? leadsTable.createdAt;
  const headers = [
    "ID", "First Name", "Last Name", "Email", "Phone", "Company", "EIN",
    "Status", "Application Type", "Lead Source", "Assigned Rep", "Lead Score",
    "Renewal Flagged", "Stale", "Last Activity", "Created At", "Updated At",
  ];
  const today = new Date().toISOString().slice(0, 10);
  res.status(200);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="mbs-leads-${today}.csv"`);
  res.flushHeaders();
  await writeCsvRow(res, headers);

  // Read in bounded pages and write each page directly to the response. This
  // avoids the old 5,000-row cap and avoids buffering a potentially large
  // export in application memory.
  let exported = 0;
  const batchSize = 1000;
  await db.transaction(async (tx) => {
    // Keep all pages on one repeatable-read snapshot. This makes the bounded
    // batches consistent even when leads or activities change during export.
    await tx.execute(sql`set transaction isolation level repeatable read`);
    let offset = 0;
    while (!res.destroyed) {
      const leads = staleRequested
        ? await (async () => {
          const pageRows = await buildLeadPageIdsQuery(
            tx,
            leadWhere,
            [sortDirection(sortColumn), asc(leadsTable.id)],
            batchSize,
            offset,
          );
          const pageIds = pageRows.map((row: { id: number }) => row.id);
          if (pageIds.length === 0) return [];
          const hydrated = await tx.query.leadsTable.findMany({
            where: buildLeadHydrationWhere(pageIds),
            with: { assignedRep: true },
          });
          return reorderByIds(hydrated, pageIds);
        })()
        : await tx.query.leadsTable.findMany({
          where: leadWhere,
          with: { assignedRep: true },
          orderBy: [sortDirection(sortColumn), asc(leadsTable.id)],
          limit: batchSize,
          offset,
        });
      if (leads.length === 0) break;
      const activityRows = await tx
        .selectDistinctOn([activityLogTable.leadId], {
          leadId: activityLogTable.leadId,
          createdAt: activityLogTable.createdAt,
        })
        .from(activityLogTable)
        .where(inArray(activityLogTable.leadId, leads.map((lead) => lead.id)))
        .orderBy(activityLogTable.leadId, desc(activityLogTable.createdAt), desc(activityLogTable.id));
      const activityDates = new Map(activityRows
        .filter((row) => row.leadId != null)
        .map((row) => [row.leadId!, row.createdAt]));
      for (const l of leads as any[]) {
        const activityAt = activityDates.get(l.id);
        const idleSince = activityAt ?? l.createdAt;
        await writeCsvRow(res, [
          l.id,
          l.firstName,
          l.lastName,
          l.email,
          l.phone,
          l.companyName,
          l.ein,
          l.status,
          l.applicationType,
          l.leadSource,
          l.assignedRep ? getUserDisplayName(l.assignedRep) : "",
          l.leadScore,
          l.renewalFlaggedAt ? "Yes" : "No",
          isLeadStale(l.assignedRepId, idleSince, staleThresholdDays, staleNow) ? "Yes" : "No",
          activityAt?.toISOString() ?? "",
          l.createdAt.toISOString(),
          l.updatedAt.toISOString(),
        ]);
        exported++;
      }
      offset += leads.length;
      if (leads.length < batchSize) break;
    }
  });
  res.end();
  await logActivity({ userId: user.id, leadId: null, action: "exported", entityType: "lead", entityId: 0, details: { count: exported } });
});

const BulkStatusBody = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(500),
  status: z.string().min(1),
  fundedAmount: z.number().int().positive().optional(),
});

router.post("/leads/bulk/status", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role === "rep") {
    res.status(403).json({ error: "Forbidden: managers and admins only" });
    return;
  }
  const body = BulkStatusBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid body", details: body.error.issues });
    return;
  }
  let updatedCount = 0;
  for (const id of body.data.ids) {
    const changed = await db.transaction(async (tx) => {
      const existing = await tx.query.leadsTable.findFirst({ where: eq(leadsTable.id, id) });
      if (!existing) return false;

      const updateFields: Record<string, unknown> = { status: body.data.status as any, updatedAt: new Date() };
      if (body.data.status === "funded") {
        if (!existing.fundedAt) {
          updateFields["fundedAt"] = new Date();
        }
        if (body.data.fundedAmount !== undefined) {
          updateFields["fundedAmount"] = body.data.fundedAmount;
        }
      }

      await tx.update(leadsTable).set(updateFields as any).where(eq(leadsTable.id, id));
      await tx.insert(leadStatusHistoryTable).values({
        leadId: id,
        changedByUserId: user.id,
        fromStatus: existing.status,
        toStatus: body.data.status,
      });

      return true;
    });
    if (changed) updatedCount++;
  }
  await logActivity({ userId: user.id, leadId: null, action: "bulk_status_changed", entityType: "lead", entityId: 0, details: { ids: body.data.ids, status: body.data.status, fundedAmount: body.data.fundedAmount } });
  res.json({ updated: updatedCount });
});

router.post("/leads/bulk/assign", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin" && user.role !== "manager") {
    res.status(403).json({ error: "Forbidden: managers and admins only" });
    return;
  }
  const body = BulkAssignLeadsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid body", details: body.error.issues });
    return;
  }
  if ((body.data.ids && body.data.filter) || (!body.data.ids && !body.data.filter) || body.data.ids?.length === 0) {
    res.status(400).json({ error: "Provide either non-empty ids or a filter" });
    return;
  }

  const destinationRep = await db.query.usersTable.findFirst({
    where: and(
      eq(usersTable.id, body.data.repId),
      eq(usersTable.role, "rep"),
      eq(usersTable.isActive, true),
    ),
  });
  if (!destinationRep) {
    res.status(400).json({ error: "Destination user must be an active rep" });
    return;
  }

  const actorName = getUserDisplayName(user);
  const destinationName = getUserDisplayName(destinationRep);
  const message = `Assigned to ${destinationName} by ${actorName}`;
  const staleThresholdDays = await getStaleThresholdDays();
  const assignmentWhere = body.data.ids
    ? inArray(leadsTable.id, [...new Set(body.data.ids)])
    : buildLeadsWhere(body.data.filter as LeadFilter, user.role, user.id, staleThresholdDays);

  const changedLeads = await db.transaction(async (tx) => {
    const candidates = await tx.query.leadsTable.findMany({
      where: and(
        assignmentWhere as any,
        sql`${leadsTable.assignedRepId} is distinct from ${body.data.repId}`,
      ) as any,
      columns: { id: true, assignedRepId: true },
    });
    if (candidates.length === 0) return [];

    const changedAt = new Date();
    // Keep SQL parameter counts bounded for an unbounded filter selection while
    // still doing set-based writes rather than one transaction per lead.
    for (let offset = 0; offset < candidates.length; offset += 500) {
      const batch = candidates.slice(offset, offset + 500);
      await tx
        .update(leadsTable)
        .set({
          assignedRepId: body.data.repId,
          lastActivityAt: changedAt,
          updatedAt: changedAt,
        })
        .where(inArray(leadsTable.id, batch.map((lead) => lead.id)));
      await tx.insert(leadAssignmentHistoryTable).values(batch.map((lead) => ({
        leadId: lead.id,
        changedByUserId: user.id,
        fromRepId: lead.assignedRepId,
        toRepId: body.data.repId,
      })));
      await tx.insert(activityLogTable).values(batch.map((lead) => ({
        userId: user.id,
        leadId: lead.id,
        action: "assigned",
        entityType: "lead",
        entityId: String(lead.id),
        details: { message },
      })));
    }
    return candidates;
  });

  if (changedLeads.length > 0) {
    await createNotification({
      userId: body.data.repId,
      type: "lead_assigned",
      title: "Leads assigned to you",
      body: `${changedLeads.length} lead${changedLeads.length === 1 ? "" : "s"} assigned to you`,
      leadId: null,
    });
  }

  const updatedCount = changedLeads.length;
  res.json({ updated: updatedCount });
});

const BulkDeleteBody = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(500),
});

router.post("/leads/bulk/delete", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") {
    res.status(403).json({ error: "Forbidden: admins only" });
    return;
  }
  const body = BulkDeleteBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid body", details: body.error.issues });
    return;
  }
  await db.delete(leadsTable).where(inArray(leadsTable.id, body.data.ids));
  await logActivity({ userId: user.id, leadId: null, action: "bulk_deleted", entityType: "lead", entityId: 0, details: { ids: body.data.ids } });
  res.json({ deleted: body.data.ids.length });
});

router.post("/leads/:id/score", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const parsedLeadId = positiveLeadId.safeParse(req.params["id"]);
  if (!parsedLeadId.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const leadId = parsedLeadId.data;

  const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, leadId) });
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
  if (user.role === "rep" && lead.assignedRepId !== user.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  try {
    const { score, breakdown } = await calculateLeadScore(leadId);
    res.json({ leadId, leadScore: score, leadScoreBreakdown: breakdown });
  } catch (err: any) {
    res.status(500).json({ error: "Score calculation failed" });
  }
});

router.get("/leads/:id", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const params = GetLeadParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const lead = await db.query.leadsTable.findFirst({
    where: eq(leadsTable.id, params.data.id),
    with: {
      assignedRep: true,
      company: true,
      notes: { with: { author: true }, orderBy: (t, { desc }) => [desc(t.createdAt)] },
      tasks: { with: { assignedUser: true }, orderBy: (t, { asc }) => [asc(t.isCompleted), asc(t.dueDate)] },
      documents: { with: { uploader: true }, orderBy: (t, { desc }) => [desc(t.createdAt)] },
      activityLog: { with: { user: true }, orderBy: (t, { desc }) => [desc(t.createdAt)], limit: 30 },
    },
  });

  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }

  if (user.role === "rep" && lead.assignedRepId !== user.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { company, notes, tasks, documents, activityLog, assignedRep, ...leadFields } = lead as any;
  const latestActivity = activityLog[0] ?? null;
  const creationActivities = await getLeadCreationActivities([lead.id]);

  res.json({
    ...leadToApi(
      leadFields,
      assignedRep,
      latestActivity,
      creationActivities.get(lead.id),
      await getStaleThresholdDays(),
    ),
    company: company ? {
      id: company.id,
      leadId: company.leadId,
      name: company.name,
      address: company.address,
      city: company.city,
      state: company.state,
      zip: company.zip,
      industry: company.industry,
      timeInBusinessMonths: company.timeInBusinessMonths,
      annualRevenue: company.annualRevenue ? Number(company.annualRevenue) : null,
    } : null,
    notes: notes.map((n: any) => ({
      id: n.id, leadId: n.leadId, userId: n.userId,
      author: n.author ? userToApi(n.author) : null,
      body: n.body, createdAt: n.createdAt.toISOString(),
    })),
    tasks: tasks.map((t: any) => ({
      id: t.id, leadId: t.leadId, userId: t.userId,
      assignedUser: t.assignedUser ? userToApi(t.assignedUser) : null,
      title: t.title, description: t.description ?? null, dueDate: t.dueDate ?? null,
      isCompleted: t.isCompleted,
      completedAt: t.completedAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
    })),
    documents: documents.map((d: any) => ({
      id: d.id, leadId: d.leadId, userId: d.userId,
      uploader: d.uploader ? userToApi(d.uploader) : null,
      filename: d.filename, fileKey: d.fileKey, fileType: d.fileType,
      fileSize: d.fileSize, createdAt: d.createdAt.toISOString(),
    })),
    recentActivity: activityLog.map((a: any) => ({
      id: a.id, userId: a.userId ?? null,
      user: a.user ? userToApi(a.user) : null,
      action: a.action, entityType: a.entityType, entityId: a.entityId,
      details: (a.details as Record<string, unknown>) ?? {},
      createdAt: a.createdAt.toISOString(),
    })),
  });
});

router.put("/leads/:id", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const params = UpdateLeadParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const body = UpdateLeadBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }

  const existing = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, params.data.id) });
  if (!existing) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  if (user.role === "rep" && existing.assignedRepId !== user.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { company, ...leadData } = body.data;

  const [updated] = await db
    .update(leadsTable)
    .set({ ...leadData, updatedAt: new Date() })
    .where(eq(leadsTable.id, params.data.id))
    .returning();

  if (company) {
    const existingCompany = await db.query.companiesTable.findFirst({ where: eq(companiesTable.leadId, params.data.id) });
    if (existingCompany) {
      await db.update(companiesTable).set({ ...company, annualRevenue: company.annualRevenue?.toString(), updatedAt: new Date() }).where(eq(companiesTable.leadId, params.data.id));
    } else {
      await db.insert(companiesTable).values({ leadId: params.data.id, ...company, annualRevenue: company.annualRevenue?.toString() });
    }
  }

  await logActivity({ userId: user.id, leadId: params.data.id, action: "updated", entityType: "lead", entityId: params.data.id, details: { fields: Object.keys(leadData) } });

  const rep = updated.assignedRepId
    ? await db.query.usersTable.findFirst({ where: eq(usersTable.id, updated.assignedRepId) })
    : null;

  // Notify newly assigned rep
  const newAssignedRepId = (body.data as Record<string, unknown>).assignedRepId as number | undefined;
  if (
    newAssignedRepId !== undefined &&
    newAssignedRepId !== existing.assignedRepId &&
    rep?.pushToken
  ) {
    const leadName = updated.companyName ||
      [updated.firstName, updated.lastName].filter(Boolean).join(" ") ||
      "A lead";
    sendPushNotification(
      rep.pushToken,
      "Lead Assigned to You",
      `${leadName} has been assigned to you`,
      { leadId: updated.id },
    ).catch(() => {});
  }

  res.json(await leadToApiWithCurrentActivity(updated, rep));
});

router.put("/leads/:id/status", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const params = ChangeLeadStatusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const body = ChangeLeadStatusBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }

  const existing = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, params.data.id) });
  if (!existing) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  if (user.role === "rep" && existing.assignedRepId !== user.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const statusUpdateFields: Record<string, unknown> = { status: body.data.status as any, updatedAt: new Date() };
  if (body.data.status === "funded") {
    if (!existing.fundedAt) {
      statusUpdateFields["fundedAt"] = new Date();
    }
    if (body.data.fundedAmount !== undefined) {
      statusUpdateFields["fundedAmount"] = body.data.fundedAmount;
    }
  }

  const updated = await db.transaction(async (tx) => {
    const [u] = await tx
      .update(leadsTable)
      .set(statusUpdateFields as any)
      .where(eq(leadsTable.id, params.data.id))
      .returning();

    await tx.insert(leadStatusHistoryTable).values({
      leadId: params.data.id,
      changedByUserId: user.id,
      fromStatus: existing.status,
      toStatus: body.data.status,
    });

    return u;
  });

  await logActivity({
    userId: user.id,
    leadId: params.data.id,
    action: "status_changed",
    entityType: "lead",
    entityId: params.data.id,
    details: {
      from: existing.status,
      to: body.data.status,
      ...(body.data.status === "funded" && body.data.fundedAmount !== undefined
        ? { fundedAmount: body.data.fundedAmount }
        : {}),
    },
  });

  // Auto-enroll in any active drip sequences triggered by the new status
  try {
    const suppressed = !updated.email || updated.isUnsubscribed ||
      await isEmailSuppressed(updated.email);
    if (suppressed) {
      await db.update(dripEnrollmentsTable)
        .set({ status: "unenrolled", unenrolledAt: new Date() })
        .where(and(eq(dripEnrollmentsTable.leadId, params.data.id), eq(dripEnrollmentsTable.status, "active")));
    } else if (process.env["DRIP_AUTOMATION_ENABLED"] === "true") {
      const triggeredSequences = await db.query.dripSequencesTable.findMany({
      where: and(
        eq(dripSequencesTable.triggerStatus, body.data.status as any),
        eq(dripSequencesTable.isActive, true)
      ),
      with: { steps: true },
      });
      for (const seq of triggeredSequences) {
        if (!seq.steps || seq.steps.length === 0) continue;
        const existingEnrollment = await db.query.dripEnrollmentsTable.findFirst({
          where: and(
            eq(dripEnrollmentsTable.leadId, params.data.id),
            eq(dripEnrollmentsTable.status, "active")
          ),
        });
        if (!existingEnrollment) {
          await db.insert(dripEnrollmentsTable).values({
            leadId: params.data.id,
            sequenceId: seq.id,
            currentStep: 0,
            status: "active",
          });
        }
      }
    }
  } catch (err) {
    console.warn("[auto-enroll] Failed to auto-enroll lead in drip sequence:", err instanceof Error ? err.message : err);
  }

  // Execute workflow rules for new status (non-blocking)
  executeWorkflowRules(params.data.id, body.data.status, updated.assignedRepId, user.id).catch(() => {});

  // Auto-run lender matching when a lead reaches "application_received"
  if (body.data.status === "application_received") {
    try {
      const matchResults = await matchLeadToLenders(params.data.id);
      await logActivity({
        userId: user.id,
        leadId: params.data.id,
        action: "lender_match_run",
        entityType: "lead",
        entityId: params.data.id,
        details: { trigger: "status_change", matchCount: matchResults.length },
      });
    } catch (err) {
      console.warn("[lender-match] Auto-match failed:", err instanceof Error ? err.message : err);
    }
  }

  const rep = updated.assignedRepId
    ? await db.query.usersTable.findFirst({ where: eq(usersTable.id, updated.assignedRepId) })
    : null;

  // Notify assignee of status change (unless they made it themselves)
  if (updated.assignedRepId && updated.assignedRepId !== user.id) {
    const leadName = [updated.firstName, updated.lastName].filter(Boolean).join(" ") || updated.companyName || "A lead";
    createNotification({
      userId: updated.assignedRepId,
      type: "status_changed",
      title: "Lead status changed",
      body: `${leadName} → ${body.data.status.replace(/_/g, " ")}`,
      leadId: updated.id,
    }).catch(() => {});
  }

  res.json(await leadToApiWithCurrentActivity(updated, rep));
});

type AssignLeadDependencies = {
  database?: typeof db;
  authenticate?: typeof requireUser;
};

export function createAssignLeadHandler(dependencies: AssignLeadDependencies = {}) {
  const database = dependencies.database ?? db;
  const authenticate = dependencies.authenticate ?? requireUser;

  return async (req: Request, res: Response) => {
  const user = await authenticate(req, res);
  if (!user) return;
  if (user.role !== "admin" && user.role !== "manager") {
    res.status(403).json({ error: "Forbidden: managers and admins only" });
    return;
  }

  const params = AssignLeadParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const body = AssignLeadBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }

  const destinationRep = await database.query.usersTable.findFirst({
    where: and(
      eq(usersTable.id, body.data.repId),
      eq(usersTable.role, "rep"),
      eq(usersTable.isActive, true),
    ),
  });
  if (!destinationRep) {
    res.status(400).json({ error: "Destination user must be an active rep" });
    return;
  }

  const existing = await database.query.leadsTable.findFirst({
    where: eq(leadsTable.id, params.data.id),
  });
  if (!existing) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }

  if (existing.assignedRepId === body.data.repId) {
    res.json(await leadToApiWithCurrentActivity(existing, destinationRep));
    return;
  }

  const actorName = getUserDisplayName(user);
  const destinationName = getUserDisplayName(destinationRep);
  const message = `Assigned to ${destinationName} by ${actorName}`;
  const updated = await database.transaction(async (tx) => {
    const changedAt = new Date();
    const [u] = await tx
      .update(leadsTable)
      .set({ assignedRepId: body.data.repId, lastActivityAt: changedAt, updatedAt: changedAt })
      .where(eq(leadsTable.id, params.data.id))
      .returning();

    await tx.insert(leadAssignmentHistoryTable).values({
      leadId: params.data.id,
      changedByUserId: user.id,
      fromRepId: existing.assignedRepId,
      toRepId: body.data.repId,
    });
    await tx.insert(activityLogTable).values({
      userId: user.id,
      leadId: params.data.id,
      action: "assigned",
      entityType: "lead",
      entityId: String(params.data.id),
      details: { message },
    });

    return u;
  });

  // A single-lead assignment still emits one notification, with no lead-specific
  // fan-out. Bulk assignments use the same one-row digest pattern above.
  await createNotification({
    userId: body.data.repId,
    type: "lead_assigned",
    title: "Lead assigned to you",
    body: "1 lead assigned to you",
    leadId: null,
  });

  res.json(await leadToApiWithCurrentActivity(updated, destinationRep));
  };
}

router.put("/leads/:id/assign", createAssignLeadHandler());

export { leadToApi };
export default router;
