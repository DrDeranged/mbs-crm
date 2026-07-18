import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { leadsTable, companiesTable, leadStatusHistoryTable, leadAssignmentHistoryTable, usersTable, dripSequencesTable, dripEnrollmentsTable } from "@workspace/db";
import { deriveKey, checkIdempotency, storeIdempotency } from "../lib/idempotency";
import { matchLeadToLenders } from "../lib/matchingEngine";
import { eq, or, ilike, and, sql, desc, asc, gte, lte, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { requireUser, userToApi } from "../lib/authHelpers";
import { sanitizeLikeInput } from "../lib/sanitize";
import { logActivity } from "../lib/activityHelper";
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
  CaptureLeadFromWebsiteBody,
} from "@workspace/api-zod";
import rateLimit from "express-rate-limit";
import { sendPushNotification } from "../lib/pushNotifications";
import { createNotification } from "../lib/notify";
import { calculateLeadScore } from "../lib/leadScoring";
import { executeWorkflowRules } from "../lib/workflowEngine";

const router: IRouter = Router();

const captureRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

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
    requestedAmount: lead.requestedAmount ?? null,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
    lastActivityAt: lead.lastActivityAt?.toISOString() ?? null,
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

function checkSpam(message: string): { spam: boolean; reason: string } {
  const lower = message.toLowerCase();

  // >1 URL in a contact-form message is a strong spam signal
  const urls = message.match(/https?:\/\/\S+/gi) ?? [];
  if (urls.length > 1) return { spam: true, reason: "multiple_urls" };

  // Messaging-app links (single mention is enough)
  if (/t\.me\/|wa\.me\/|telegram\.me/.test(lower)) return { spam: true, reason: "messaging_app_link" };
  if (/\bskype\b/.test(lower) && urls.length > 0) return { spam: true, reason: "skype_link" };

  // SEO / marketing / bulk-spam keyword patterns
  const SPAM_KEYWORDS = [
    "search engine rank", "search engine optimiz", "seo service", "seo package",
    "google ranking", "google first page", "page one of google",
    "bulk message", "bulk email", "email blast",
    "digital marketing agenc", "marketing package",
    "backlink", "link building", "domain authorit",
    "cryptocurrency invest", "crypto invest", "bitcoin invest",
    "$59/", "$49/", "$29/",
    "boost your traffic", "increase your traffic", "drive traffic",
    "traffic to your website", "i noticed your website",
    "i visited your website", "your website ranking",
    "improve your ranking", "free seo audit",
    "social media marketing", "content marketing service",
    "dear website owner", "dear admin", "dear sir/madam",
    "i am a professional seo", "we are a seo",
  ];

  for (const kw of SPAM_KEYWORDS) {
    if (lower.includes(kw)) return { spam: true, reason: `keyword:${kw.trim()}` };
  }

  return { spam: false, reason: "" };
}

router.get("/leads", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const params = ListLeadsQueryParams.safeParse(req.query);
  const q = (params.success ? params.data : {}) as any;
  const page = Number(q.page ?? 1);
  const limit = Math.min(Number(q.limit ?? 25), 100);
  const offset = (page - 1) * limit;

  const conditions: ReturnType<typeof eq>[] = [];
  if (user.role === "rep") conditions.push(eq(leadsTable.assignedRepId, user.id));
  if (q.status) conditions.push(eq(leadsTable.status, q.status as any));
  if (q.applicationType) conditions.push(eq(leadsTable.applicationType, q.applicationType as any));
  if (q.repId) conditions.push(eq(leadsTable.assignedRepId, Number(q.repId)));
  if (q.startDate) conditions.push(gte(leadsTable.createdAt, new Date(q.startDate as string)));
  if (q.endDate) {
    const end = new Date(q.endDate as string);
    end.setHours(23, 59, 59, 999);
    conditions.push(lte(leadsTable.createdAt, end));
  }
  if (q.minScore !== undefined) conditions.push(gte(leadsTable.leadScore, Number(q.minScore)));
  if (q.maxScore !== undefined) conditions.push(lte(leadsTable.leadScore, Number(q.maxScore)));
  if (q.renewalFlagged === true || q.renewalFlagged === "true") {
    conditions.push(sql`${leadsTable.renewalFlaggedAt} is not null` as any);
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

  const [leadsRaw, [{ total }]] = await Promise.all([
    db.query.leadsTable.findMany({
      where: whereClause as any,
      orderBy: [sortDir(sortColumn)],
      limit,
      offset,
      with: { assignedRep: true },
    }),
    db
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(leadsTable)
      .where(whereClause as any),
  ]);

  res.json({
    leads: leadsRaw.map((l) => leadToApi(l, (l as any).assignedRep)),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

router.post("/leads", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const body = CreateLeadBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid body", details: body.error.issues });
    return;
  }

  const { company, ...leadData } = body.data;

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

  await logActivity({ userId: user.id, leadId: lead.id, action: "created", entityType: "lead", entityId: lead.id });

  res.status(201).json(leadToApi(lead, null));
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

  const [lead] = await db.insert(leadsTable).values({
    ...body.data,
    applicationType: (body.data.applicationType as any) ?? "working_capital",
    leadSource: "website",
  }).returning();

  await logActivity({ userId: null, leadId: lead.id, action: "captured", entityType: "lead", entityId: lead.id });

  const capturePayload: Record<string, unknown> = { success: true, leadId: lead.id };
  void storeIdempotency(idempKey, "leads/capture", `lead:${lead.id}`, capturePayload);
  res.status(201).json(capturePayload);
});

// ── Elementor webhook capture ─────────────────────────────────────────────────
// POST /leads/capture/elementor — public, rate-limited.
// Accepts Elementor Pro form payloads (flexible key/value pairs).  Returns 200
// for every non-error outcome (new lead, duplicate, spam) so the webhook never
// errors on the WordPress side.
router.post("/leads/capture/elementor", captureRateLimiter, async (req: Request, res: Response) => {
  const raw = req.body as Record<string, unknown>;

  // ── Field extraction (Elementor-flexible) ────────────────────────────────
  function strField(...keys: string[]): string {
    for (const k of keys) {
      const v = raw[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  }

  // Phone: accept explicit key first, then fall back to any field whose value
  // looks like a phone number (digits/spaces/dashes, 7–20 chars, no @).
  function findPhone(): string {
    const explicit = strField("phone", "phone_number", "telephone", "mobile");
    if (explicit) return explicit;
    for (const v of Object.values(raw)) {
      if (typeof v === "string" && /^\+?[\d\s\-().]{7,20}$/.test(v.trim()) && !v.includes("@")) {
        return v.trim();
      }
    }
    return "";
  }

  const fullName   = strField("name", "full_name", "fullName");
  const nameParts  = fullName.split(/\s+/).filter(Boolean);
  const firstName  = strField("firstName", "first_name") || nameParts[0] || "";
  const lastName   = strField("lastName",  "last_name")  || nameParts.slice(1).join(" ") || "";
  const emailVal   = strField("email", "email_address").toLowerCase();
  const phoneVal   = findPhone();
  const message    = strField("message", "msg", "comment", "comments", "inquiry", "note");
  const companyVal = strField("company", "companyName", "company_name", "business", "business_name");

  // ── Basic validation ──────────────────────────────────────────────────────
  if (!emailVal && !phoneVal) {
    res.status(400).json({ error: "email or phone required" });
    return;
  }
  if (firstName.length > 100 || lastName.length > 100) {
    res.status(400).json({ error: "Name too long" });
    return;
  }
  if (emailVal && emailVal.length > 254) {
    res.status(400).json({ error: "Email too long" });
    return;
  }
  if (phoneVal && !/^\+?[\d\s\-().]{7,20}$/.test(phoneVal)) {
    res.status(400).json({ error: "Invalid phone format" });
    return;
  }

  // ── Spam filter ───────────────────────────────────────────────────────────
  if (message) {
    const spamResult = checkSpam(message);
    if (spamResult.spam) {
      // Log for admin review — do NOT create a lead
      await logActivity({
        userId: null,
        leadId: null,
        action: "spam_filtered",
        entityType: "lead",
        entityId: 0,
        details: {
          reason:  spamResult.reason,
          email:   emailVal,
          name:    fullName || `${firstName} ${lastName}`.trim(),
          message: message.slice(0, 500),
        },
      });
      res.status(200).json({ success: true }); // silent success — webhook must not error
      return;
    }
  }

  // ── Idempotency (5-minute window keyed on email+phone) ────────────────────
  const timeBucket = Math.floor(Date.now() / (5 * 60 * 1000)).toString();
  const idempKey   = deriveKey(`leads/capture/elementor|${emailVal}|${phoneVal}|${timeBucket}`);
  const cached     = await checkIdempotency(idempKey, "leads/capture/elementor");
  if (cached) {
    res.status(200).json(cached);
    return;
  }

  // ── Duplicate detection — return 200, not 409, so webhook doesn't error ───
  const dup = await findDuplicate(emailVal || undefined, phoneVal || undefined);
  if (dup) {
    const dupPayload: Record<string, unknown> = { success: true, duplicate: true, leadId: dup.id };
    void storeIdempotency(idempKey, "leads/capture/elementor", `lead:${dup.id}`, dupPayload);
    res.status(200).json(dupPayload);
    return;
  }

  // ── Create lead ───────────────────────────────────────────────────────────
  const [lead] = await db.insert(leadsTable).values({
    firstName:    firstName  || null,
    lastName:     lastName   || null,
    email:        emailVal   || null,
    phone:        phoneVal   || null,
    companyName:  companyVal || null,
    applicationType: "working_capital",
    leadSource:   "website",
  }).returning();

  // Store message in activity details (notes require a non-null userId)
  await logActivity({
    userId:     null,
    leadId:     lead.id,
    action:     "captured",
    entityType: "lead",
    entityId:   lead.id,
    details: {
      source: "elementor_webhook",
      ...(message ? { message: message.slice(0, 2000) } : {}),
    },
  });

  const elementorPayload: Record<string, unknown> = { success: true, leadId: lead.id };
  void storeIdempotency(idempKey, "leads/capture/elementor", `lead:${lead.id}`, elementorPayload);
  res.status(200).json(elementorPayload);
});

function buildLeadsWhere(q: any, userRole: string, userId: number) {
  const conditions: ReturnType<typeof eq>[] = [];
  if (userRole === "rep") conditions.push(eq(leadsTable.assignedRepId, userId));
  if (q.status) conditions.push(eq(leadsTable.status, q.status as any));
  if (q.applicationType) conditions.push(eq(leadsTable.applicationType, q.applicationType as any));
  if (q.repId) conditions.push(eq(leadsTable.assignedRepId, Number(q.repId)));
  if (q.startDate) conditions.push(gte(leadsTable.createdAt, new Date(q.startDate as string)));
  if (q.endDate) {
    const end = new Date(q.endDate as string);
    end.setHours(23, 59, 59, 999);
    conditions.push(lte(leadsTable.createdAt, end));
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

  const q = req.query as any;
  const whereClause = buildLeadsWhere(q, user.role, user.id);

  const ids = q.ids
    ? String(q.ids).split(",").map(Number).filter((n: number) => !isNaN(n) && n > 0)
    : null;

  const leads = await db.query.leadsTable.findMany({
    where: ids && ids.length > 0
      ? and(whereClause as any, inArray(leadsTable.id, ids))
      : (whereClause as any),
    with: { assignedRep: true },
    orderBy: [desc(leadsTable.createdAt)],
    limit: 5000,
  });

  const headers = ["ID", "First Name", "Last Name", "Email", "Phone", "Company", "EIN", "Status", "Type", "Lead Source", "Assigned Rep", "Created At", "Updated At"];
  const rows = leads.map((l: any) => [
    l.id,
    l.firstName ?? "",
    l.lastName ?? "",
    l.email ?? "",
    l.phone ?? "",
    l.companyName ?? "",
    l.ein ?? "",
    l.status,
    l.applicationType,
    l.leadSource,
    l.assignedRep ? (l.assignedRep.name || l.assignedRep.email) : "",
    l.createdAt.toISOString(),
    l.updatedAt.toISOString(),
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map((cell: any) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="leads-${Date.now()}.csv"`);
  res.send(csv);
  await logActivity({ userId: user.id, leadId: null, action: "exported", entityType: "lead", entityId: 0, details: { count: leads.length } });
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

const BulkAssignBody = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(500),
  repId: z.number().int().positive(),
});

router.post("/leads/bulk/assign", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role === "rep") {
    res.status(403).json({ error: "Forbidden: managers and admins only" });
    return;
  }
  const body = BulkAssignBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid body", details: body.error.issues });
    return;
  }
  let updatedCount = 0;
  for (const id of body.data.ids) {
    const changed = await db.transaction(async (tx) => {
      const existing = await tx.query.leadsTable.findFirst({ where: eq(leadsTable.id, id) });
      if (!existing) return false;

      await tx.update(leadsTable).set({ assignedRepId: body.data.repId, updatedAt: new Date() }).where(eq(leadsTable.id, id));
      await tx.insert(leadAssignmentHistoryTable).values({
        leadId: id,
        changedByUserId: user.id,
        fromRepId: existing.assignedRepId,
        toRepId: body.data.repId,
      });

      return true;
    });
    if (changed) updatedCount++;
  }
  await logActivity({ userId: user.id, leadId: null, action: "bulk_assigned", entityType: "lead", entityId: 0, details: { ids: body.data.ids, repId: body.data.repId } });
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
  const leadId = parseInt(req.params["id"] as string, 10);
  if (isNaN(leadId)) { res.status(400).json({ error: "Invalid ID" }); return; }

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

  res.json({
    ...leadToApi(leadFields, assignedRep),
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

  res.json(leadToApi(updated, rep));
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

  res.json(leadToApi(updated, rep));
});

router.put("/leads/:id/assign", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role === "rep") {
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

  const existing = await db.query.leadsTable.findFirst({
    where: eq(leadsTable.id, params.data.id),
  });
  if (!existing) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }

  const updated = await db.transaction(async (tx) => {
    const [u] = await tx
      .update(leadsTable)
      .set({ assignedRepId: body.data.repId, updatedAt: new Date() })
      .where(eq(leadsTable.id, params.data.id))
      .returning();

    await tx.insert(leadAssignmentHistoryTable).values({
      leadId: params.data.id,
      changedByUserId: user.id,
      fromRepId: existing.assignedRepId,
      toRepId: body.data.repId,
    });

    return u;
  });

  await logActivity({
    userId: user.id,
    leadId: params.data.id,
    action: "assigned",
    entityType: "lead",
    entityId: params.data.id,
    details: { fromRepId: existing.assignedRepId, toRepId: body.data.repId },
  });

  const rep = await db.query.usersTable.findFirst({ where: eq(usersTable.id, body.data.repId) });

  // Notify newly assigned rep
  if (body.data.repId && body.data.repId !== existing.assignedRepId && body.data.repId !== user.id) {
    const leadName = [updated.firstName, updated.lastName].filter(Boolean).join(" ") || updated.companyName || "A lead";
    createNotification({
      userId: body.data.repId,
      type: "lead_assigned",
      title: "Lead assigned to you",
      body: `${leadName} was assigned to you`,
      leadId: updated.id,
    }).catch(() => {});
  }

  res.json(leadToApi(updated, rep));
});

export { leadToApi };
export default router;
