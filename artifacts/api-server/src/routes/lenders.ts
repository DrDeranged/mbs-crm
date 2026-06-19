import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  lendersTable, lenderMatchesTable, lenderSubmissionsTable,
  leadsTable, usersTable, activityLogTable,
  insertLenderSchema,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireUser } from "../lib/authHelpers";
import { matchLeadToLenders } from "../lib/matchingEngine";

const router: IRouter = Router();

function lenderToApi(lender: typeof lendersTable.$inferSelect) {
  return {
    id: lender.id,
    name: lender.name,
    programTypes: lender.programTypes ?? [],
    minAmount: lender.minAmount ?? null,
    maxAmount: lender.maxAmount ?? null,
    minCreditScore: lender.minCreditScore ?? null,
    acceptedIndustries: lender.acceptedIndustries ?? [],
    minTimeInBusinessMonths: lender.minTimeInBusinessMonths,
    acceptedStates: lender.acceptedStates ?? [],
    maxExistingPositions: lender.maxExistingPositions,
    priorityWeight: lender.priorityWeight,
    contactName: lender.contactName ?? null,
    contactEmail: lender.contactEmail ?? null,
    notes: lender.notes ?? null,
    isActive: lender.isActive,
    createdAt: lender.createdAt.toISOString(),
    updatedAt: lender.updatedAt.toISOString(),
  };
}

function matchToApi(
  match: typeof lenderMatchesTable.$inferSelect,
  lender?: typeof lendersTable.$inferSelect | null,
) {
  return {
    id: match.id,
    leadId: match.leadId,
    lenderId: match.lenderId,
    lender: lender ? lenderToApi(lender) : null,
    matchScore: match.matchScore,
    criteriaBreakdown: (match.criteriaBreakdown as unknown as object[]) ?? [],
    matchedAt: match.matchedAt.toISOString(),
  };
}

function submissionToApi(
  sub: typeof lenderSubmissionsTable.$inferSelect,
  lender?: typeof lendersTable.$inferSelect | null,
  submittedByUser?: typeof usersTable.$inferSelect | null,
) {
  return {
    id: sub.id,
    leadId: sub.leadId,
    lenderId: sub.lenderId,
    lender: lender ? lenderToApi(lender) : null,
    submittedBy: sub.submittedBy ?? null,
    submittedByUser: submittedByUser
      ? { id: submittedByUser.id, name: submittedByUser.name, email: submittedByUser.email }
      : null,
    status: sub.status,
    responseNotes: sub.responseNotes ?? null,
    submittedAt: sub.submittedAt.toISOString(),
    updatedAt: sub.updatedAt.toISOString(),
  };
}

// --- Lender CRUD ---

router.get("/lenders", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role === "rep") return void res.status(403).json({ error: "Forbidden" });

  const lenders = await db.select().from(lendersTable).orderBy(desc(lendersTable.priorityWeight));
  res.json(lenders.map(lenderToApi));
});

router.post("/lenders", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") return void res.status(403).json({ error: "Admin only" });

  const body = insertLenderSchema.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: "Invalid lender data" });

  const [lender] = await db.insert(lendersTable).values({
    name: body.data.name!,
    programTypes: (body.data.programTypes as string[]) ?? [],
    minAmount: body.data.minAmount ?? null,
    maxAmount: body.data.maxAmount ?? null,
    minCreditScore: body.data.minCreditScore ?? null,
    acceptedIndustries: (body.data.acceptedIndustries as string[]) ?? [],
    minTimeInBusinessMonths: body.data.minTimeInBusinessMonths ?? 0,
    acceptedStates: (body.data.acceptedStates as string[]) ?? [],
    maxExistingPositions: body.data.maxExistingPositions ?? 10,
    priorityWeight: body.data.priorityWeight ?? 5,
    contactName: body.data.contactName ?? null,
    contactEmail: body.data.contactEmail ?? null,
    notes: body.data.notes ?? null,
    isActive: body.data.isActive ?? true,
  }).returning();

  res.status(201).json(lenderToApi(lender!));
});

router.put("/lenders/:id", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") return void res.status(403).json({ error: "Admin only" });

  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) return void res.status(400).json({ error: "Invalid ID" });

  const body = insertLenderSchema.partial().safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: "Invalid lender data" });

  const [updated] = await db.update(lendersTable)
    .set({ ...body.data as any, updatedAt: new Date() })
    .where(eq(lendersTable.id, id))
    .returning();

  if (!updated) return void res.status(404).json({ error: "Lender not found" });
  res.json(lenderToApi(updated));
});

router.delete("/lenders/:id", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") return void res.status(403).json({ error: "Admin only" });

  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) return void res.status(400).json({ error: "Invalid ID" });

  const [updated] = await db.update(lendersTable)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(lendersTable.id, id))
    .returning();

  if (!updated) return void res.status(404).json({ error: "Lender not found" });
  res.json(lenderToApi(updated));
});

// --- Match endpoints ---

router.post("/leads/:id/match", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const leadId = parseInt(req.params["id"] as string, 10);
  if (isNaN(leadId)) return void res.status(400).json({ error: "Invalid lead ID" });

  const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, leadId) });
  if (!lead) return void res.status(404).json({ error: "Lead not found" });
  if (user.role === "rep" && lead.assignedRepId !== user.id) {
    return void res.status(403).json({ error: "Forbidden" });
  }

  const results = await matchLeadToLenders(leadId);

  const matches = await db.select().from(lenderMatchesTable)
    .where(eq(lenderMatchesTable.leadId, leadId));

  const allLenders = await db.select().from(lendersTable);
  const lenderMap: Record<number, typeof lendersTable.$inferSelect> = {};
  for (const l of allLenders) lenderMap[l.id] = l;

  const sorted = matches
    .sort((a, b) => b.matchScore - a.matchScore)
    .map((m) => matchToApi(m, lenderMap[m.lenderId]));

  res.json({ matchCount: results.length, matches: sorted });
});

router.get("/leads/:id/matches", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const leadId = parseInt(req.params["id"] as string, 10);
  if (isNaN(leadId)) return void res.status(400).json({ error: "Invalid lead ID" });

  const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, leadId) });
  if (!lead) return void res.status(404).json({ error: "Lead not found" });
  if (user.role === "rep" && lead.assignedRepId !== user.id) {
    return void res.status(403).json({ error: "Forbidden" });
  }

  const matches = await db.select().from(lenderMatchesTable)
    .where(eq(lenderMatchesTable.leadId, leadId));

  const allLenders = await db.select().from(lendersTable);
  const lenderMap: Record<number, typeof lendersTable.$inferSelect> = {};
  for (const l of allLenders) lenderMap[l.id] = l;

  const sorted = matches
    .sort((a, b) => b.matchScore - a.matchScore)
    .map((m) => matchToApi(m, lenderMap[m.lenderId]));

  res.json(sorted);
});

// --- Submission endpoints ---

const VALID_SUBMISSION_STATUSES = ["submitted", "pending", "approved", "declined", "withdrawn"] as const;

router.post("/leads/:id/submissions", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const leadId = parseInt(req.params["id"] as string, 10);
  if (isNaN(leadId)) return void res.status(400).json({ error: "Invalid lead ID" });

  const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, leadId) });
  if (!lead) return void res.status(404).json({ error: "Lead not found" });
  if (user.role === "rep" && lead.assignedRepId !== user.id) {
    return void res.status(403).json({ error: "Forbidden" });
  }

  const lenderId = Number(req.body?.lender_id);
  if (!lenderId || isNaN(lenderId)) return void res.status(400).json({ error: "lender_id is required" });

  const lender = await db.query.lendersTable.findFirst({ where: eq(lendersTable.id, lenderId) });
  if (!lender) return void res.status(404).json({ error: "Lender not found" });

  const [sub] = await db.insert(lenderSubmissionsTable).values({
    leadId,
    lenderId,
    submittedBy: user.id,
    status: "submitted",
  }).returning();

  await db.insert(activityLogTable).values({
    userId: user.id,
    leadId,
    action: "lender_submitted",
    entityType: "lender_submission",
    entityId: String(sub!.id),
    details: { lenderName: lender.name, lenderId: lender.id },
  });

  const submitter = await db.query.usersTable.findFirst({ where: eq(usersTable.id, user.id) });
  res.status(201).json(submissionToApi(sub!, lender, submitter));
});

router.get("/leads/:id/submissions", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const leadId = parseInt(req.params["id"] as string, 10);
  if (isNaN(leadId)) return void res.status(400).json({ error: "Invalid lead ID" });

  const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, leadId) });
  if (!lead) return void res.status(404).json({ error: "Lead not found" });
  if (user.role === "rep" && lead.assignedRepId !== user.id) {
    return void res.status(403).json({ error: "Forbidden" });
  }

  const subs = await db.select().from(lenderSubmissionsTable)
    .where(eq(lenderSubmissionsTable.leadId, leadId))
    .orderBy(desc(lenderSubmissionsTable.submittedAt));

  const allLenders = await db.select().from(lendersTable);
  const lenderMap: Record<number, typeof lendersTable.$inferSelect> = {};
  for (const l of allLenders) lenderMap[l.id] = l;

  const allUsers = await db.select().from(usersTable);
  const userMap: Record<number, typeof usersTable.$inferSelect> = {};
  for (const u of allUsers) userMap[u.id] = u;

  res.json(subs.map((s) => submissionToApi(s, lenderMap[s.lenderId], s.submittedBy ? userMap[s.submittedBy] : null)));
});

router.put("/submissions/:id", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role === "rep") return void res.status(403).json({ error: "Managers/admins only" });

  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) return void res.status(400).json({ error: "Invalid ID" });

  const { status, response_notes } = req.body as { status?: string; response_notes?: string | null };
  if (status && !VALID_SUBMISSION_STATUSES.includes(status as any)) {
    return void res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_SUBMISSION_STATUSES.join(", ")}` });
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (status !== undefined) updates["status"] = status;
  if (response_notes !== undefined) updates["responseNotes"] = response_notes;

  const [updated] = await db.update(lenderSubmissionsTable)
    .set(updates as any)
    .where(eq(lenderSubmissionsTable.id, id))
    .returning();

  if (!updated) return void res.status(404).json({ error: "Submission not found" });

  const lender = updated.lenderId
    ? await db.query.lendersTable.findFirst({ where: eq(lendersTable.id, updated.lenderId) })
    : null;
  const submitter = updated.submittedBy
    ? await db.query.usersTable.findFirst({ where: eq(usersTable.id, updated.submittedBy) })
    : null;

  res.json(submissionToApi(updated, lender, submitter));
});

export default router;
