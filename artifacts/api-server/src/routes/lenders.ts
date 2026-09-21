import { Router, type IRouter, type Request, type Response } from "express";
import { createHash } from "crypto";
import { z } from "zod/v4";
import { db, pool } from "@workspace/db";
import {
  lendersTable, lenderGuidelineVersionsTable, lenderMatchesTable, lenderSubmissionsTable, lenderSubmissionDeliveriesTable,
  leadsTable, usersTable, activityLogTable, dealsTable, applicationsTable, documentsTable, emailTemplatesTable,
  companiesTable, bankStatementExtractionsTable, underwritingCorrectionsTable,
  dealApprovalsTable,
  insertLenderSchema,
} from "@workspace/db";
import { eq, desc, asc, and, gte, sql, inArray, isNotNull } from "drizzle-orm";
import { requireUser } from "../lib/authHelpers";
import { matchLeadToLenders } from "../lib/matchingEngine";
import { logActivity } from "../lib/activityHelper";
import { recordManualLenderSubmission } from "../lib/manualLenderSubmission";
import { buildLenderPackagePdf, decryptLenderPackageSsns, parseLenderPackageConfig, parsePersistedLenderPackageConfig, sanitizeLenderPackageBusinessName, type LenderPackageConfig } from "../lib/lenderPackage";
import { safeLenderPackageReason } from "../lib/lenderPackageErrors";
import { logPiiAccess } from "../lib/piiAccess";
import { doSendEmail, renderTemplate, buildVariables } from "./email";
import { getPublicBaseUrl } from "../lib/brand";
import { createNotification } from "../lib/notify";
import {
  seedNewLenders,
  type LenderSeedOperationResult,
} from "../lib/productionMaintenance";
import { historicalSignal, rankDimensions, resolveRevenueFact } from "../lib/underwritingIntelligence";

const router: IRouter = Router();
const requestIdSchema = z.coerce.number().int().positive();
const submissionRequestSchema = z.object({
  lender_id: requestIdSchema,
  via_broker_id: requestIdSchema.optional(),
  end_lender_id: requestIdSchema.optional(),
  admin_override: z.boolean().optional(),
  adminOverride: z.boolean().optional(),
  package_config: z.unknown().optional(),
  packageConfig: z.unknown().optional(),
}).strict();
const submissionUpdateSchema = z.object({
  status: z.enum(["submitted", "approved", "declined", "funded", "withdrawn"]).optional(),
  notes: z.string().nullable().optional(),
  response_notes: z.string().nullable().optional(),
}).strict().refine(
  (value) => Object.keys(value).length > 0,
  { message: "At least one submission field is required" },
);
const manualSubmissionSchema = z.object({
  lender_id: requestIdSchema,
  deal_id: requestIdSchema.optional(),
  submitted_at: z.string().datetime().optional(),
  status: z.enum(["submitted", "approved", "declined", "funded", "withdrawn"]).default("submitted"),
  notes: z.string().nullable().optional(),
  approval_pdf_base64: z.string().optional(),
}).strict();
const correctionSchema = z.object({
  field: z.enum([
    "requestedAmount", "creditScore", "industry", "businessState", "timeInBusinessMonths",
    "monthlyRevenue", "existingPositions", "equipmentDescription", "equipmentCategory",
    "equipmentYear", "vendorName", "transactionAmount", "intendedUse",
  ]),
  value: z.union([z.string().max(1000), z.number().finite(), z.boolean(), z.null()]),
  reason: z.string().trim().min(1).max(500),
  evidenceDocumentId: z.number().int().positive().nullable().optional(),
}).strict();
const GUIDELINE_FIELDS = new Set([
  "programTypes", "minAmount", "maxAmount", "minCreditScore", "acceptedIndustries",
  "restrictedIndustries", "prohibitedIndustries", "minMonthlyRevenue",
  "restrictedIndustryMinMonthlyRevenue", "startupMinCreditScore",
  "startupMaxTimeInBusinessMonths", "startupMaxAmount", "minIndustryExperienceMonths",
  "requiresFinancialStatements", "truckingRules", "industryTimeInBusinessOverrides",
  "programEligibilityRules", "minTimeInBusinessMonths", "acceptedStates",
  "maxExistingPositions", "equipmentRestrictions", "pricing", "requiredDocuments",
  "turnaroundBusinessDaysMin", "turnaroundBusinessDaysMax", "compensation",
]);

function inputError(res: Response, parsed: z.ZodSafeParseError<unknown>): void {
  const field = parsed.error.issues[0]?.path.join(".") || "body";
  res.status(400).json({ error: `Invalid ${field}` });
}

function lenderToApi(lender: typeof lendersTable.$inferSelect) {
  return {
    id: lender.id,
    name: lender.name,
    programTypes: lender.programTypes ?? [],
    minAmount: lender.minAmount ?? null,
    maxAmount: lender.maxAmount ?? null,
    minCreditScore: lender.minCreditScore ?? null,
    acceptedIndustries: lender.acceptedIndustries ?? [],
    restrictedIndustries: lender.restrictedIndustries ?? [],
    prohibitedIndustries: lender.prohibitedIndustries ?? [],
    minMonthlyRevenue: lender.minMonthlyRevenue ?? null,
    restrictedIndustryMinMonthlyRevenue: lender.restrictedIndustryMinMonthlyRevenue ?? null,
    startupMinCreditScore: lender.startupMinCreditScore ?? null,
    startupMaxTimeInBusinessMonths: lender.startupMaxTimeInBusinessMonths ?? null,
    startupMaxAmount: lender.startupMaxAmount ?? null,
    minIndustryExperienceMonths: lender.minIndustryExperienceMonths ?? null,
    requiresFinancialStatements: lender.requiresFinancialStatements,
    truckingRules: lender.truckingRules ?? null,
    industryTimeInBusinessOverrides: lender.industryTimeInBusinessOverrides ?? null,
    programEligibilityRules: lender.programEligibilityRules ?? null,
    minTimeInBusinessMonths: lender.minTimeInBusinessMonths,
    acceptedStates: lender.acceptedStates ?? [],
    maxExistingPositions: lender.maxExistingPositions,
    priorityWeight: lender.priorityWeight,
    contactName: lender.contactName ?? null,
    contactEmail: lender.contactEmail ?? null,
    notes: lender.notes ?? null,
    isActive: lender.isActive,
    partnerType: lender.partnerType,
    referralSplitPct: lender.referralSplitPct == null ? null : Number(lender.referralSplitPct),
    submissionMethod: lender.submissionMethod,
    portalUrl: lender.portalUrl ?? null,
    guidelineVersion: lender.guidelineVersion,
    guidelineSource: lender.guidelineSource ?? null,
    guidelineEffectiveAt: lender.guidelineEffectiveAt?.toISOString() ?? null,
    equipmentRestrictions: lender.equipmentRestrictions ?? [],
    pricing: lender.pricing ?? null,
    requiredDocuments: lender.requiredDocuments ?? [],
    turnaroundBusinessDaysMin: lender.turnaroundBusinessDaysMin ?? null,
    turnaroundBusinessDaysMax: lender.turnaroundBusinessDaysMax ?? null,
    compensation: lender.compensation ?? null,
    createdAt: lender.createdAt.toISOString(),
    updatedAt: lender.updatedAt.toISOString(),
  };
}

function guidelineSnapshot(lender: typeof lendersTable.$inferSelect) {
  return {
    programTypes: lender.programTypes ?? [], minAmount: lender.minAmount, maxAmount: lender.maxAmount,
    minCreditScore: lender.minCreditScore, acceptedIndustries: lender.acceptedIndustries ?? [],
    restrictedIndustries: lender.restrictedIndustries ?? [], prohibitedIndustries: lender.prohibitedIndustries ?? [],
    minMonthlyRevenue: lender.minMonthlyRevenue, minTimeInBusinessMonths: lender.minTimeInBusinessMonths,
    acceptedStates: lender.acceptedStates ?? [], maxExistingPositions: lender.maxExistingPositions,
    equipmentRestrictions: lender.equipmentRestrictions ?? [], pricing: lender.pricing,
    requiredDocuments: lender.requiredDocuments ?? [], turnaroundBusinessDaysMin: lender.turnaroundBusinessDaysMin,
    turnaroundBusinessDaysMax: lender.turnaroundBusinessDaysMax, compensation: lender.compensation,
  };
}

function normalizeLenderBody(body: unknown): unknown {
  if (!body || typeof body !== "object") return body;
  const value = { ...(body as Record<string, unknown>) };
  if (typeof value.guidelineEffectiveAt === "string") value.guidelineEffectiveAt = new Date(value.guidelineEffectiveAt);
  return value;
}

function matchToApi(
  match: typeof lenderMatchesTable.$inferSelect,
  lender?: typeof lendersTable.$inferSelect | null,
  outcomeStatuses: string[] = [],
  requestedAmount?: number | null,
) {
  const history = historicalSignal(outcomeStatuses);
  const dimensions = lender ? rankDimensions({
    matchScore: match.matchScore,
    history,
    pricing: lender.pricing,
    turnaroundMin: lender.turnaroundBusinessDaysMin,
    turnaroundMax: lender.turnaroundBusinessDaysMax,
    compensation: lender.compensation,
    requiredDocuments: lender.requiredDocuments,
    maxAdvancePct: lender.pricing?.maxAdvancePct,
    minDownPaymentPct: lender.pricing?.minDownPaymentPct,
  }) : rankDimensions({ matchScore: match.matchScore, history });
  const compensation = lender?.compensation;
  const percentageCompensation = compensation?.max ?? compensation?.min;
  const estimatedGrossRevenue = compensation?.flatAmount != null
    ? compensation.flatAmount
    : requestedAmount != null && percentageCompensation != null
      ? Math.round(requestedAmount * Number(percentageCompensation) / 100)
      : null;
  return {
    id: match.id,
    leadId: match.leadId,
    lenderId: match.lenderId,
    lender: lender ? lenderToApi(lender) : null,
    partnerType: lender?.partnerType ?? "direct_lender",
    matchGroup: lender?.partnerType === "broker_out" ? "super_broker" : "lender",
    matchScore: match.matchScore,
    criteriaBreakdown: (match.criteriaBreakdown as unknown as object[]) ?? [],
    eligibilityStatus: "plausible",
    rankingVersion: "underwriting-v1",
    rankingDimensions: dimensions,
    historicalSignal: history,
    estimatedGrossRevenue,
    economics: lender ? {
      pricing: lender.pricing ?? null,
      turnaroundBusinessDays: lender.turnaroundBusinessDaysMin == null && lender.turnaroundBusinessDaysMax == null ? null : {
        min: lender.turnaroundBusinessDaysMin, max: lender.turnaroundBusinessDaysMax,
      },
      compensation: lender.compensation ?? null,
      requiredDocuments: lender.requiredDocuments ?? [],
      guidelineVersion: lender.guidelineVersion,
      guidelineSource: lender.guidelineSource ?? null,
    } : null,
    matchedAt: match.matchedAt.toISOString(),
  };
}

async function buildUnderwritingProfile(leadId: number) {
  const [lead, application, company, banks, documents, corrections] = await Promise.all([
    db.query.leadsTable.findFirst({ where: eq(leadsTable.id, leadId) }),
    db.query.applicationsTable.findFirst({ where: eq(applicationsTable.leadId, leadId), orderBy: [desc(applicationsTable.submittedAt), desc(applicationsTable.id)] }),
    db.query.companiesTable.findFirst({ where: eq(companiesTable.leadId, leadId) }),
    db.select().from(bankStatementExtractionsTable).where(eq(bankStatementExtractionsTable.leadId, leadId)).orderBy(asc(bankStatementExtractionsTable.statementYear), asc(bankStatementExtractionsTable.statementMonth)),
    db.select({ id: documentsTable.id, category: documentsTable.category, label: documentsTable.label, filename: documentsTable.filename }).from(documentsTable).where(eq(documentsTable.leadId, leadId)),
    db.select().from(underwritingCorrectionsTable).where(eq(underwritingCorrectionsTable.leadId, leadId)).orderBy(desc(underwritingCorrectionsTable.createdAt), desc(underwritingCorrectionsTable.id)),
  ]);
  if (!lead) return null;
  const latestCorrections = new Map<string, typeof corrections[number]>();
  for (const correction of corrections) if (!latestCorrections.has(correction.field)) latestCorrections.set(correction.field, correction);
  const fact = (
    key: string,
    label: string,
    value: unknown,
    source: "lead" | "application" | "company" | "bank_statement",
    sourceId?: number,
    estimated = false,
    provenanceOverride?: { source: string; sourceId?: number; sourceIds?: number[]; label: string; confidence: string },
  ) => {
    const correction = latestCorrections.get(key);
    return {
      key, label,
      value: correction ? correction.correctedValue : value,
      estimated: correction ? false : estimated,
      provenance: correction
        ? { source: "user_correction", sourceId: correction.id, label: `Corrected by user: ${correction.reason}`, confidence: "corrected" }
        : provenanceOverride ?? { source, sourceId, label: source === "application" ? "Submitted application" : source === "company" ? "CRM company record" : "CRM lead record", confidence: source === "application" ? "reported" : source === "bank_statement" ? "extracted" : "verified" },
    };
  };
  const numeric = (value: unknown) => value == null || value === "" ? null : Number(value);
  const totalDeposits = banks.map((row) => numeric(row.totalDeposits)).filter((value): value is number => value != null && Number.isFinite(value));
  const balances = banks.map((row) => numeric(row.averageDailyBalance)).filter((value): value is number => value != null && Number.isFinite(value));
  const positions = banks.flatMap((row) => Array.isArray(row.existingPositionsJson) ? row.existingPositionsJson as object[] : []);
  const bank = banks.length ? {
    monthsAnalyzed: banks.length,
    averageMonthlyDeposits: totalDeposits.length ? totalDeposits.reduce((a, b) => a + b, 0) / totalDeposits.length : null,
    averageDailyBalance: balances.length ? balances.reduce((a, b) => a + b, 0) / balances.length : null,
    nsfCount: banks.reduce((sum, row) => sum + row.nsfCount, 0),
    negativeBalanceDays: banks.reduce((sum, row) => sum + row.negativeBalanceDays, 0),
    returnedItems: banks.reduce((sum, row) => sum + Number((row.rawExtractionJson as any)?.returnedItems ?? 0), 0),
    overdrafts: banks.reduce((sum, row) => sum + Number((row.rawExtractionJson as any)?.overdrafts ?? 0), 0),
    positions,
    provenance: banks.map((row) => ({ source: "bank_statement", sourceId: row.documentId ?? row.id, label: `${row.statementMonth ?? "?"}/${row.statementYear ?? "?"} bank statement extraction`, confidence: "extracted" })),
  } : null;
  const appId = application?.id;
  const revenue = resolveRevenueFact({
    averageMonthlyDeposits: bank?.averageMonthlyDeposits ?? null,
    bankSources: banks,
    applicationRevenue: application?.monthlyRevenueStated,
    applicationId: appId,
  });
  const facts = [
    fact("requestedAmount", "Requested amount", application?.requestedAmount ?? lead.requestedAmount, application?.requestedAmount != null ? "application" : "lead", appId ?? lead.id),
    fact("creditScore", "Credit score", lead.creditScore ?? application?.estCreditScore, lead.creditScore != null ? "lead" : "application", lead.creditScore != null ? lead.id : appId, lead.creditScore == null && application?.estCreditScore != null),
    fact("industry", "Industry", company?.industry ?? application?.industry, company?.industry ? "company" : "application", company?.id ?? appId),
    fact("businessState", "Business state", company?.state ?? application?.businessState, company?.state ? "company" : "application", company?.id ?? appId),
    fact("timeInBusinessMonths", "Time in business", company?.timeInBusinessMonths ?? application?.timeInBusinessMonths, company?.timeInBusinessMonths != null ? "company" : "application", company?.id ?? appId),
    fact("monthlyRevenue", "Monthly revenue", revenue.value, revenue.provenance.source, revenue.provenance.sourceId, revenue.estimated, revenue.provenance),
    fact("existingPositions", "Existing debt positions", positions.length || lead.existingPositions, positions.length ? "application" : "lead", appId ?? lead.id),
    fact("equipmentDescription", "Equipment", application?.equipmentDescription, "application", appId),
    fact("equipmentCategory", "Equipment type", application?.equipmentCategory, "application", appId),
    fact("equipmentYear", "Equipment year/make/model", application?.yearMakeModel, "application", appId),
    fact("vendorName", "Vendor", application?.vendorName, "application", appId),
    fact("transactionAmount", "Invoice / transaction amount", numeric(application?.vendorQuoteAmount) ?? application?.requestedAmount, "application", appId),
    fact("intendedUse", "Intended use", application?.useOfFunds, "application", appId),
  ];
  const requiredKeys = lead.applicationType === "equipment"
    ? ["requestedAmount", "industry", "businessState", "timeInBusinessMonths", "equipmentDescription", "vendorName", "transactionAmount"]
    : ["requestedAmount", "industry", "businessState", "timeInBusinessMonths", "monthlyRevenue"];
  const missingFields = requiredKeys.filter((key) => facts.find((candidate) => candidate.key === key)?.value == null);
  return {
    leadId, applicationId: appId ?? null, applicationType: lead.applicationType,
    facts, bank, documents,
    readiness: { readyForMatching: missingFields.length === 0, missingFields, requiresHumanReview: true },
    corrections: corrections.map((row) => ({ id: row.id, field: row.field, value: row.correctedValue, reason: row.reason, evidenceDocumentId: row.evidenceDocumentId, createdAt: row.createdAt.toISOString() })),
  };
}

function submissionToApi(
  sub: typeof lenderSubmissionsTable.$inferSelect,
  lender?: typeof lendersTable.$inferSelect | null,
  submittedByUser?: typeof usersTable.$inferSelect | null,
  approvalDocumentId?: number | null,
) {
  return {
    id: sub.id,
    leadId: sub.leadId,
    lenderId: sub.lenderId,
    viaBrokerId: sub.viaBrokerId ?? null,
    endLenderId: sub.endLenderId ?? null,
    lender: lender ? lenderToApi(lender) : null,
    sentBy: sub.sentBy ?? null,
    sentByUser: submittedByUser
      ? { id: submittedByUser.id, name: submittedByUser.name, email: submittedByUser.email }
      : null,
    status: sub.status,
    source: sub.source ?? "crm",
    notes: sub.notes ?? null,
    decisionDate: sub.decisionDate?.toISOString() ?? null,
    hasApprovalAttachment: Boolean(sub.approvalAttachmentKey || approvalDocumentId),
    approvalDocumentId: approvalDocumentId ?? null,
    sentAt: sub.sentAt.toISOString(),
    dealId: sub.dealId ?? null,
    messageId: sub.messageId ?? null,
    packageConfigSnapshot: parsePersistedLenderPackageConfig(sub.packageConfigSnapshot),
    hasExactPackage: Boolean(sub.exactPackageKey && sub.exactPackageSha256),
    updatedAt: sub.updatedAt.toISOString(),
  };
}

async function approvalDocumentsBySubmission(
  submissions: Array<typeof lenderSubmissionsTable.$inferSelect>,
): Promise<Map<string, number>> {
  const dealIds = [...new Set(submissions.flatMap((submission) => submission.dealId ? [submission.dealId] : []))];
  if (dealIds.length === 0) return new Map();
  const approvals = await db.select({
    dealId: dealApprovalsTable.dealId,
    lenderId: dealApprovalsTable.lenderId,
    approvalDocumentId: dealApprovalsTable.approvalDocumentId,
  }).from(dealApprovalsTable)
    .where(and(
      inArray(dealApprovalsTable.dealId, dealIds),
      isNotNull(dealApprovalsTable.approvalDocumentId),
    ))
    .orderBy(desc(dealApprovalsTable.createdAt), desc(dealApprovalsTable.id));
  const result = new Map<string, number>();
  for (const approval of approvals) {
    const key = `${approval.dealId}:${approval.lenderId}`;
    if (!result.has(key) && approval.approvalDocumentId != null) {
      result.set(key, approval.approvalDocumentId);
    }
  }
  return result;
}

// --- Lender CRUD ---

router.get("/lenders", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const lenders = await db.select().from(lendersTable).orderBy(desc(lendersTable.priorityWeight));
  const submissions = await db.select({ lenderId: lenderSubmissionsTable.lenderId, status: lenderSubmissionsTable.status }).from(lenderSubmissionsTable);
  const stats = new Map<number, { submitted: number; approved: number; declined: number }>();
  for (const row of submissions) {
    const current = stats.get(row.lenderId) ?? { submitted: 0, approved: 0, declined: 0 };
    current.submitted++;
    if (row.status === "approved") current.approved++;
    if (row.status === "declined") current.declined++;
    stats.set(row.lenderId, current);
  }
  res.json(lenders.map((lender) => {
    const stat = stats.get(lender.id) ?? { submitted: 0, approved: 0, declined: 0 };
    const decisions = stat.approved + stat.declined;
    return { ...lenderToApi(lender), submissionStats: { ...stat, approvalRate: decisions ? Math.round(stat.approved / decisions * 100) : 0 } };
  }));
});

router.post("/lenders", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") return void res.status(403).json({ error: "Admin only" });

  const body = insertLenderSchema.safeParse(normalizeLenderBody(req.body));
  if (!body.success) return void res.status(400).json({ error: "Invalid lender data" });

  const [lender] = await db.insert(lendersTable).values({
    name: body.data.name!,
    programTypes: (body.data.programTypes as string[]) ?? [],
    minAmount: body.data.minAmount ?? null,
    maxAmount: body.data.maxAmount ?? null,
    minCreditScore: body.data.minCreditScore ?? null,
    acceptedIndustries: (body.data.acceptedIndustries as string[]) ?? [],
    restrictedIndustries: (body.data.restrictedIndustries as string[]) ?? [],
    prohibitedIndustries: (body.data.prohibitedIndustries as string[]) ?? [],
    minMonthlyRevenue: body.data.minMonthlyRevenue ?? null,
    restrictedIndustryMinMonthlyRevenue: body.data.restrictedIndustryMinMonthlyRevenue ?? null,
    startupMinCreditScore: body.data.startupMinCreditScore ?? null,
    startupMaxTimeInBusinessMonths: body.data.startupMaxTimeInBusinessMonths ?? null,
    startupMaxAmount: body.data.startupMaxAmount ?? null,
    minIndustryExperienceMonths: body.data.minIndustryExperienceMonths ?? null,
    requiresFinancialStatements: body.data.requiresFinancialStatements ?? false,
    truckingRules: body.data.truckingRules ?? null,
    industryTimeInBusinessOverrides: body.data.industryTimeInBusinessOverrides ?? null,
    programEligibilityRules: body.data.programEligibilityRules ?? null,
    minTimeInBusinessMonths: body.data.minTimeInBusinessMonths ?? null,
    acceptedStates: (body.data.acceptedStates as string[]) ?? [],
    maxExistingPositions: body.data.maxExistingPositions ?? 10,
    priorityWeight: body.data.priorityWeight ?? 5,
    contactName: body.data.contactName ?? null,
    contactEmail: body.data.contactEmail ?? null,
    notes: body.data.notes ?? null,
    isActive: body.data.isActive ?? true,
    partnerType: body.data.partnerType ?? "direct_lender",
    referralSplitPct: body.data.referralSplitPct ?? null,
    submissionMethod: body.data.submissionMethod ?? "email",
    portalUrl: body.data.portalUrl ?? null,
    guidelineVersion: body.data.guidelineVersion ?? 1,
    guidelineSource: body.data.guidelineSource ?? null,
    guidelineEffectiveAt: body.data.guidelineEffectiveAt ?? null,
    equipmentRestrictions: (body.data.equipmentRestrictions as string[]) ?? [],
    pricing: body.data.pricing ?? null,
    requiredDocuments: (body.data.requiredDocuments as string[]) ?? [],
    turnaroundBusinessDaysMin: body.data.turnaroundBusinessDaysMin ?? null,
    turnaroundBusinessDaysMax: body.data.turnaroundBusinessDaysMax ?? null,
    compensation: body.data.compensation ?? null,
  } as any).returning();

  await db.insert(lenderGuidelineVersionsTable).values({
    lenderId: lender!.id, version: lender!.guidelineVersion, source: lender!.guidelineSource,
    effectiveAt: lender!.guidelineEffectiveAt, snapshot: guidelineSnapshot(lender!), createdBy: user.id,
  }).onConflictDoNothing();
  res.status(201).json(lenderToApi(lender!));
});

router.get("/lenders/:id/guideline-versions", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) return void res.status(400).json({ error: "Invalid ID" });
  const versions = await db.select().from(lenderGuidelineVersionsTable)
    .where(eq(lenderGuidelineVersionsTable.lenderId, id))
    .orderBy(desc(lenderGuidelineVersionsTable.version), desc(lenderGuidelineVersionsTable.createdAt));
  res.json(versions.map((version) => ({
    id: version.id, lenderId: version.lenderId, version: version.version, source: version.source,
    effectiveAt: version.effectiveAt?.toISOString() ?? null, snapshot: version.snapshot,
    createdAt: version.createdAt.toISOString(),
  })));
});

router.put("/lenders/:id", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") return void res.status(403).json({ error: "Admin only" });

  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) return void res.status(400).json({ error: "Invalid ID" });

  const body = insertLenderSchema.partial().safeParse(normalizeLenderBody(req.body));
  if (!body.success) return void res.status(400).json({ error: "Invalid lender data" });
  const existing = await db.query.lendersTable.findFirst({ where: eq(lendersTable.id, id) });
  if (!existing) return void res.status(404).json({ error: "Lender not found" });
  const changesGuideline = Object.keys(body.data).some((key) => GUIDELINE_FIELDS.has(key));
  if (changesGuideline && (body.data.guidelineVersion ?? existing.guidelineVersion) <= existing.guidelineVersion) {
    return void res.status(409).json({
      error: `Increase guidelineVersion above ${existing.guidelineVersion} before changing documented underwriting rules`,
    });
  }

  const [updated] = await db.update(lendersTable)
    .set({ ...body.data as any, updatedAt: new Date() })
    .where(eq(lendersTable.id, id))
    .returning();

  if (!updated) return void res.status(404).json({ error: "Lender not found" });
  await db.insert(lenderGuidelineVersionsTable).values({
    lenderId: updated.id, version: updated.guidelineVersion, source: updated.guidelineSource,
    effectiveAt: updated.guidelineEffectiveAt, snapshot: guidelineSnapshot(updated), createdBy: user.id,
  }).onConflictDoNothing();
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

// POST /admin/lenders/seed-new — admin-only, idempotent, and exact-name
// matched. Configured new seeds are only inserted when absent; Section B
// packet updates are only applied when their marker is absent.
export type MaintenanceRouteUser = {
  id: number;
  role: string;
};

export type MaintenanceRequireUser = (
  req: Request,
  res: Response,
) => Promise<MaintenanceRouteUser | null>;

export function createSeedNewLendersRouter(dependencies: {
  requireUser?: MaintenanceRequireUser;
  seedNewLenders?: () => Promise<LenderSeedOperationResult>;
} = {}): IRouter {
  const routeRouter: IRouter = Router();
  const requireUserForRoute = dependencies.requireUser ?? requireUser;
  const seedNewLendersForRoute = dependencies.seedNewLenders ?? seedNewLenders;

  routeRouter.post("/admin/lenders/seed-new", async (req: Request, res: Response) => {
    const user = await requireUserForRoute(req, res);
    if (!user) return;
    if (user.role !== "admin") return void res.status(403).json({ error: "Admin only" });

    try {
      const result = await seedNewLendersForRoute();
      res.status(200).json({
        created: result.created,
        updated: result.updated,
        unchanged: result.unchanged,
        createdNames: result.createdNames,
        updatedNames: result.updatedNames,
        unchangedNames: result.unchangedNames,
        missingUpdateNames: result.missingUpdateNames,
        lenders: result.lenders.map(lenderToApi),
      });
    } catch (error) {
      console.error("Failed to seed new lenders", error);
      res.status(500).json({ error: "Unable to seed new lenders" });
    }
  });

  return routeRouter;
}

router.use(createSeedNewLendersRouter());

// --- Match endpoints ---

router.get("/leads/:id/underwriting-profile", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const leadId = parseInt(req.params["id"] as string, 10);
  if (isNaN(leadId)) return void res.status(400).json({ error: "Invalid lead ID" });
  const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, leadId) });
  if (!lead) return void res.status(404).json({ error: "Lead not found" });
  if (user.role === "rep" && lead.assignedRepId !== user.id) return void res.status(403).json({ error: "Forbidden" });
  res.json(await buildUnderwritingProfile(leadId));
});

router.post("/leads/:id/underwriting-corrections", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const leadId = parseInt(req.params["id"] as string, 10);
  if (isNaN(leadId)) return void res.status(400).json({ error: "Invalid lead ID" });
  const parsed = correctionSchema.safeParse(req.body);
  if (!parsed.success) return inputError(res, parsed);
  const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, leadId) });
  if (!lead) return void res.status(404).json({ error: "Lead not found" });
  if (user.role === "rep" && lead.assignedRepId !== user.id) return void res.status(403).json({ error: "Forbidden" });
  if (parsed.data.evidenceDocumentId) {
    const evidence = await db.select({ id: documentsTable.id }).from(documentsTable).where(and(eq(documentsTable.id, parsed.data.evidenceDocumentId), eq(documentsTable.leadId, leadId)));
    if (!evidence.length) return void res.status(400).json({ error: "Evidence document does not belong to this lead" });
  }
  const [created] = await db.insert(underwritingCorrectionsTable).values({
    leadId, field: parsed.data.field, correctedValue: parsed.data.value,
    reason: parsed.data.reason, evidenceDocumentId: parsed.data.evidenceDocumentId ?? null, createdBy: user.id,
  }).returning();
  await logActivity({ userId: user.id, leadId, action: "underwriting_fact_corrected", entityType: "lead", entityId: leadId, details: { field: parsed.data.field, correctionId: created.id } });
  res.status(201).json({ id: created.id, field: created.field, value: created.correctedValue, reason: created.reason, evidenceDocumentId: created.evidenceDocumentId, createdAt: created.createdAt.toISOString() });
});

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
  const outcomes = await db.select({ lenderId: lenderSubmissionsTable.lenderId, status: lenderSubmissionsTable.status }).from(lenderSubmissionsTable);
  const outcomeMap = new Map<number, string[]>();
  for (const row of outcomes) outcomeMap.set(row.lenderId, [...(outcomeMap.get(row.lenderId) ?? []), row.status]);
  const lenderMap: Record<number, typeof lendersTable.$inferSelect> = {};
  for (const l of allLenders) lenderMap[l.id] = l;

  const sorted = matches
    .sort((a, b) => b.matchScore - a.matchScore)
    .map((m) => matchToApi(m, lenderMap[m.lenderId], outcomeMap.get(m.lenderId), lead.requestedAmount));

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
  const outcomes = await db.select({ lenderId: lenderSubmissionsTable.lenderId, status: lenderSubmissionsTable.status }).from(lenderSubmissionsTable);
  const outcomeMap = new Map<number, string[]>();
  for (const row of outcomes) outcomeMap.set(row.lenderId, [...(outcomeMap.get(row.lenderId) ?? []), row.status]);
  const lenderMap: Record<number, typeof lendersTable.$inferSelect> = {};
  for (const l of allLenders) lenderMap[l.id] = l;

  const sorted = matches
    .sort((a, b) => b.matchScore - a.matchScore)
    .map((m) => matchToApi(m, lenderMap[m.lenderId], outcomeMap.get(m.lenderId), lead.requestedAmount));

  res.json(sorted);
});

// --- Submission endpoints ---

const VALID_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function apiAmount(value: number | null | undefined): string {
  return value == null ? "—" : `$${value.toLocaleString("en-US")}`;
}

function apiApplicationType(value: unknown): string {
  return value === "equipment" ? "Equipment Financing" : value === "working_capital" ? "Working Capital" : "—";
}

function piiPackageMetadata(packageConfig: LenderPackageConfig | null, ssnUnmasked: boolean): Record<string, unknown> {
  return {
    sections: packageConfig?.sections ?? null,
    documentIds: packageConfig?.documentIds ?? null,
    options: packageConfig?.options ?? null,
    ssnUnmasked,
  };
}

async function canAccessSubmissionLead(database: any, user: { id: number; role: string }, leadId: number) {
  const lead = await database.query.leadsTable.findFirst({ where: eq(leadsTable.id, leadId) });
  if (!lead) return { lead: null, allowed: false };
  return { lead, allowed: user.role === "admin" || (user.role === "rep" && lead.assignedRepId === user.id) };
}

export type LenderSubmissionRouteDependencies = {
  database?: any;
  authenticate?: typeof requireUser;
  buildPackage?: typeof buildLenderPackagePdf;
  sendEmail?: typeof doSendEmail;
  getBaseUrl?: typeof getPublicBaseUrl;
  recordActivity?: typeof logActivity;
  notify?: typeof createNotification;
  storeExactPackage?: (key: string, bytes: Buffer) => Promise<void>;
  downloadExactPackage?: (key: string) => Promise<Buffer>;
  acquireSubmissionLock?: (leadId: number, lenderId: number) => Promise<(() => Promise<void>) | null>;
  auditPiiAccess?: typeof logPiiAccess;
  deliveryReceipt?: {
    reserve: (input: DeliveryReceiptInput) => Promise<{ id: number } | null>;
    markSent: (id: number, messageId: string | null) => Promise<void>;
    markSubmitted: (id: number) => Promise<void>;
    markFailed: (id: number, message: string) => Promise<void>;
    markUncertain: (id: number, message: string) => Promise<void>;
  };
};

type DeliveryReceiptInput = {
  leadId: number; lenderId: number; sentBy: number; packageConfig: unknown;
  exactPackageKey: string; exactPackageSha256: string; exactPackageBytes: number;
};

function createDeliveryReceiptStore(routeDb: any): NonNullable<LenderSubmissionRouteDependencies["deliveryReceipt"]> {
  const activeStates = ["pending", "sent", "uncertain"] as const;
  return {
    async reserve(input) {
      const existing = await routeDb.query.lenderSubmissionDeliveriesTable.findFirst({
        where: and(eq(lenderSubmissionDeliveriesTable.leadId, input.leadId), eq(lenderSubmissionDeliveriesTable.lenderId, input.lenderId), inArray(lenderSubmissionDeliveriesTable.state, activeStates)),
      });
      if (existing) return null;
      const [created] = await routeDb.insert(lenderSubmissionDeliveriesTable).values({
        ...input, packageConfigSnapshot: input.packageConfig, state: "pending",
      }).onConflictDoNothing().returning();
      return created ? { id: created.id } : null;
    },
    async markSent(id, messageId) {
      await routeDb.update(lenderSubmissionDeliveriesTable).set({ state: "sent", messageId, updatedAt: new Date() }).where(eq(lenderSubmissionDeliveriesTable.id, id));
    },
    async markSubmitted(id) {
      await routeDb.update(lenderSubmissionDeliveriesTable).set({ state: "submitted", updatedAt: new Date() }).where(eq(lenderSubmissionDeliveriesTable.id, id));
    },
    async markFailed(id, message) {
      await routeDb.update(lenderSubmissionDeliveriesTable).set({ state: "failed", failureMessage: message, updatedAt: new Date() }).where(eq(lenderSubmissionDeliveriesTable.id, id));
    },
    async markUncertain(id, message) {
      await routeDb.update(lenderSubmissionDeliveriesTable).set({ state: "uncertain", failureMessage: message, updatedAt: new Date() }).where(eq(lenderSubmissionDeliveriesTable.id, id));
    },
  };
}

/** A dedicated session lock prevents two API instances from sending the same lead/lender package at once. */
export async function acquireSubmissionLock(leadId: number, lenderId: number): Promise<(() => Promise<void>) | null> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock($1, $2) AS acquired", [leadId, lenderId]);
    if (!result.rows[0]?.acquired) {
      client.release();
      return null;
    }
  } catch (error) {
    client.release();
    throw error;
  }
  return async () => {
    try {
      await client.query("SELECT pg_advisory_unlock($1, $2)", [leadId, lenderId]);
    } finally {
      client.release();
    }
  };
}

async function storeSubmissionPackage(key: string, bytes: Buffer): Promise<void> {
  const { ObjectStorageService, objectStorageClient } = await import("../lib/objectStorage");
  const privateDir = new ObjectStorageService().getPrivateObjectDir().replace(/\/+$/, "");
  if (!key.startsWith("/objects/")) throw new Error("Submission package key must be a private object entity path");
  const [bucketName, ...objectParts] = `${privateDir}/${key.slice("/objects/".length)}`.replace(/^\//, "").split("/");
  if (!bucketName || objectParts.length === 0) throw new Error("PRIVATE_OBJECT_DIR must identify a bucket and private prefix");
  await objectStorageClient.bucket(bucketName).file(objectParts.join("/")).save(bytes, {
    contentType: "application/pdf", resumable: false, metadata: { cacheControl: "private, no-store" },
  });
}

async function downloadSubmissionPackage(key: string): Promise<Buffer> {
  const { ObjectStorageService } = await import("../lib/objectStorage");
  const [bytes] = await new ObjectStorageService().getObjectEntityFile(key).then((file) => file.download());
  return Buffer.from(bytes);
}

export function createSubmissionHandler(
  dependencies: LenderSubmissionRouteDependencies = {},
) {
  const routeDb = dependencies.database ?? db;
  const authenticate = dependencies.authenticate ?? requireUser;
  const buildPackage = dependencies.buildPackage ?? buildLenderPackagePdf;
  const sendEmail = dependencies.sendEmail ?? doSendEmail;
  const getBaseUrl = dependencies.getBaseUrl ?? getPublicBaseUrl;
  const recordActivity = dependencies.recordActivity ?? logActivity;
  const storeExactPackage = dependencies.storeExactPackage ?? storeSubmissionPackage;
  const acquireLock = dependencies.acquireSubmissionLock ?? acquireSubmissionLock;
  const auditPiiAccess = dependencies.auditPiiAccess ?? logPiiAccess;
  const deliveryReceipt = dependencies.deliveryReceipt ?? createDeliveryReceiptStore(routeDb);

  return async function createSubmission(req: Request, res: Response): Promise<void> {
    const user = await authenticate(req, res);
    if (!user) return;

    const leadId = parseInt(req.params["id"] as string, 10);
    if (isNaN(leadId)) return void res.status(400).json({ error: "Invalid lead ID" });

    const lead = await routeDb.query.leadsTable.findFirst({ where: eq(leadsTable.id, leadId) });
    if (!lead) return void res.status(404).json({ error: "Lead not found" });
    if (user.role !== "admin" && !(user.role === "rep" && lead.assignedRepId === user.id)) {
      return void res.status(403).json({ error: "Forbidden" });
    }

    const body = submissionRequestSchema.safeParse(req.body);
    if (!body.success) return inputError(res, body);
    const lenderId = body.data.lender_id;

    const lender = await routeDb.query.lendersTable.findFirst({ where: eq(lendersTable.id, lenderId) });
    if (!lender) return void res.status(404).json({ error: "Lender not found" });
    if (!lender.isActive) return void res.status(409).json({ error: "Selected lender is inactive" });
    if (!lender.contactEmail || !VALID_EMAIL.test(lender.contactEmail.trim())) {
      return void res.status(409).json({ error: "Selected lender has no valid contact email" });
    }

    const adminOverride = body.data.admin_override ?? body.data.adminOverride ?? false;
    if (adminOverride && user.role !== "admin") {
      return void res.status(403).json({ error: "Only administrators may override the 24-hour submission limit" });
    }
    let releaseLock: (() => Promise<void>) | null;
    try {
      releaseLock = await acquireLock(leadId, lenderId);
    } catch (error) {
      req.log?.error({ err: error }, "Could not acquire lender submission lock");
      return void res.status(503).json({ error: "Lender submission is temporarily unavailable", reason: "submission_lock_unavailable" });
    }
    if (!releaseLock) {
      return void res.status(409).json({ error: "A submission to this lender is already in progress", reason: "submission_in_progress" });
    }
    try {
    if (!adminOverride) {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recent = await routeDb.query.lenderSubmissionsTable.findFirst({
        where: and(
          eq(lenderSubmissionsTable.leadId, leadId),
          eq(lenderSubmissionsTable.lenderId, lenderId),
          gte(lenderSubmissionsTable.sentAt, cutoff),
        ),
      });
      if (recent) {
        return void res.status(409).json({
          error: "This lead was already submitted to this lender within the last 24 hours",
          reason: "duplicate_24h",
        });
      }
    }

    const application = await routeDb.query.applicationsTable.findFirst({
      where: eq(applicationsTable.leadId, leadId),
      orderBy: (table: any, { desc: orderDesc }: { desc: any }) => [orderDesc(table.submittedAt), orderDesc(table.id)],
    });
    if (!application || !application.signatureSignedAt ||
        !["typed", "drawn"].includes(application.signatureMethod ?? "") ||
        !application.signatureData) {
      return void res.status(409).json({ error: "A signed application is required before submitting to a lender", reason: "missing_signed_application" });
    }

    // Existing deal conventions allow one lead to have historical/archived
    // deals. Choose the earliest active deal by id, deterministically; this
    // avoids silently attaching a submission to an arbitrary deal.
    const deal = (await routeDb.query.dealsTable.findMany({
      where: and(eq(dealsTable.leadId, leadId), eq(dealsTable.isArchived, false)),
      orderBy: (table: any, { asc: orderAsc }: { asc: any }) => [orderAsc(table.id)],
      limit: 1,
    }))[0] ?? null;
    const assignedRep = lead.assignedRepId
      ? await routeDb.query.usersTable.findFirst({ where: eq(usersTable.id, lead.assignedRepId) })
      : null;
    const documents = await routeDb.query.documentsTable.findMany({
      where: eq(documentsTable.leadId, leadId),
      orderBy: (table: any, { asc: orderAsc }: { asc: any }) => [orderAsc(table.createdAt), orderAsc(table.id)],
    });
      const rawPackageConfig = body.data.package_config ?? body.data.packageConfig;
      const packageConfig = rawPackageConfig === undefined ? null : parseLenderPackageConfig(rawPackageConfig);
      if (rawPackageConfig !== undefined && !packageConfig) {
        return void res.status(400).json({ error: "Invalid package selection" });
      }
      if ((packageConfig?.documentIds ?? []).some((documentId) => !documents.some((document: any) => document.id === documentId))) {
        return void res.status(400).json({ error: "Every selected document must belong to this lead" });
      }
      let packagePdf: Buffer;
      let ssnUnmasked = false;
    try {
        const fullSsn = decryptLenderPackageSsns(application);
        ssnUnmasked = true;
        packagePdf = (await buildPackage({ lead, application, assignedRep: assignedRep ?? null, documents, selection: packageConfig ?? undefined, fullSsn })).pdf;
    } catch (error) {
      return void res.status(500).json({
        error: "Lender package generation failed",
        reason: safeLenderPackageReason(error),
      });
    }

    const rep = assignedRep ?? (user.role === "rep" ? await routeDb.query.usersTable.findFirst({ where: eq(usersTable.id, user.id) }) : null);
    const vars = buildVariables(lead, rep, {
      lender_name: lender.name,
      requested_amount: apiAmount(application.requestedAmount ?? lead.requestedAmount),
      application_type: apiApplicationType(application.type),
    });
    const template = await routeDb.query.emailTemplatesTable.findFirst({
      where: eq(emailTemplatesTable.name, "Lender Submission"),
    });
    if (!template || !template.isActive) {
      return void res.status(500).json({ error: "Lender Submission email template is unavailable" });
    }
    const amount = apiAmount(application.requestedAmount ?? lead.requestedAmount);
    const type = apiApplicationType(application.type);
    const subject = `MBS Submission – ${application.businessName || lead.companyName} – ${amount} – ${type}`;
      const filename = `MBS-Application-${sanitizeLenderPackageBusinessName(application.businessName || lead.companyName)}-${lead.id}.pdf`;
      const packageHash = createHash("sha256").update(packagePdf).digest("hex");
      const exactPackageKey = `/objects/lender-submissions/${leadId}/${Date.now()}-${packageHash}.pdf`;
      try {
        await storeExactPackage(exactPackageKey, packagePdf);
      } catch (error) {
        req.log?.error({ err: error }, "Failed to store immutable lender package");
        return void res.status(500).json({ error: "Lender package could not be stored for submission" });
      }
      const receipt = await deliveryReceipt.reserve({
        leadId, lenderId, sentBy: user.id, packageConfig,
        exactPackageKey, exactPackageSha256: packageHash, exactPackageBytes: packagePdf.length,
      });
      if (!receipt) {
        return void res.status(409).json({
          error: "A lender delivery receipt is already pending recovery",
          reason: "submission_delivery_pending",
        });
      }
    let sendResult: Awaited<ReturnType<typeof doSendEmail>>;
    try {
      sendResult = await sendEmail({
      leadId,
      userId: user.id,
      templateId: template.id,
      subject,
      bodyHtml: renderTemplate(template.bodyHtml, vars),
      toEmail: lender.contactEmail.trim(),
      ccEmail: rep?.email ?? null,
      baseUrl: getBaseUrl(),
      rep,
      attachments: [{
        content: packagePdf.toString("base64"),
        filename,
        type: "application/pdf",
        disposition: "attachment",
      }],
      });
    } catch (error) {
      // A throw (including a transport timeout) cannot prove the provider did
      // not accept the message. Preserve an active recovery barrier.
      await deliveryReceipt.markUncertain(receipt.id, "The provider outcome could not be confirmed after a transport error.");
      return void res.status(502).json({ error: "Lender email delivery outcome is uncertain; do not retry", reason: "send_outcome_uncertain" });
    }
    if (sendResult.error) {
      if (sendResult.deliveryOutcome === "definite_failure") {
        await deliveryReceipt.markFailed(receipt.id, sendResult.configurationReason ?? sendResult.error);
        return void res.status(502).json({ error: "Lender email delivery failed", reason: sendResult.configurationReason ?? "send_failed" });
      }
      await deliveryReceipt.markUncertain(receipt.id, sendResult.error);
      return void res.status(502).json({ error: "Lender email delivery outcome is uncertain; do not retry", reason: "send_outcome_uncertain" });
    }
    // A confirmed provider acceptance is the disclosure boundary. Audit it
    // before any receipt or database finalization that may fail afterward.
    auditPiiAccess({
      userId: user.id,
      leadId,
      fieldCategory: "application",
      action: "export",
      ip: req.ip,
      metadata: piiPackageMetadata(packageConfig, ssnUnmasked),
    });
    try {
      await deliveryReceipt.markSent(receipt.id, sendResult.send?.sendgridMessageId ?? null);
    } catch (error) {
      // The existing pending receipt is deliberately retained: a provider
      // success without this update is uncertain and must never be retried.
      req.log?.error({ err: error, receiptId: receipt.id }, "Could not confirm lender delivery receipt");
      return void res.status(500).json({ error: "Lender package was sent but is pending recovery; do not retry" });
    }

    let sub: any;
    try {
      [sub] = await routeDb.transaction(async (tx: any) => {
      const submissionDeal = deal ?? (await tx.insert(dealsTable).values({
        leadId,
        dealName: application.businessName || lead.companyName ||
          [lead.firstName, lead.lastName].filter(Boolean).join(" ") ||
          `Lead ${lead.id}`,
        stage: "submitted",
        amount: application.requestedAmount ?? lead.requestedAmount,
        assignedTo: lead.assignedRepId,
      }).returning())[0];
      const [created] = await tx.insert(lenderSubmissionsTable).values({
        leadId, dealId: submissionDeal.id, lenderId, sentBy: user.id,
        viaBrokerId: body.data.via_broker_id ?? (lender.partnerType === "broker_out" ? lender.id : null),
        endLenderId: body.data.end_lender_id ?? null,
        messageId: sendResult.send?.sendgridMessageId ?? null, status: "submitted",
        packageConfigSnapshot: packageConfig,
        exactPackageKey, exactPackageSha256: packageHash, exactPackageBytes: packagePdf.length,
      }).returning();
      if (deal) {
        await tx.update(dealsTable).set({
          stage: "submitted",
          ...(lender.partnerType === "broker_in"
            ? { referredByPartnerId: lender.id, referralSplitPct: lender.referralSplitPct }
            : {}),
          updatedAt: new Date(),
        }).where(eq(dealsTable.id, deal.id));
      }
      if (lender.partnerType === "broker_in") {
        await tx.update(leadsTable).set({
          referredByPartnerId: lender.id,
          referralSplitPct: lender.referralSplitPct,
          updatedAt: new Date(),
        }).where(eq(leadsTable.id, leadId));
      }
      // Keep the lead preference and the submitted immutable snapshot aligned
      // in the final application transaction; the client also persists before
      // Send so it is never dependent on its debounce timer.
      if (packageConfig) {
        await tx.update(leadsTable).set({ packageConfig, updatedAt: new Date() }).where(eq(leadsTable.id, leadId));
      }
      await recordActivity({
        userId: user.id, leadId, dealId: submissionDeal.id,
        action: "lender_submitted", entityType: "lender_submission", entityId: created.id,
        details: {
          lenderName: lender.name, lenderId: lender.id, dealId: submissionDeal.id,
          adminOverride,
          packageSections: packageConfig?.sections ?? null,
          packageDocumentIds: packageConfig?.documentIds ?? null,
          ssnUnmasked,
        },
      }, tx);
      return [created] as const;
      });
    } catch (error) {
      // `sent` is a durable provider receipt and remains a retry barrier.
      req.log?.error({ err: error, receiptId: receipt.id }, "Lender delivery sent but submission finalization failed");
      return void res.status(500).json({ error: "Lender package was sent but finalization is pending recovery; do not retry" });
    }
    try {
      await deliveryReceipt.markSubmitted(receipt.id);
    } catch (error) {
      req.log?.error({ err: error, receiptId: receipt.id }, "Could not mark lender delivery receipt submitted");
    }
    const submitter = await routeDb.query.usersTable.findFirst({ where: eq(usersTable.id, user.id) });
    res.status(201).json(submissionToApi(sub, lender, submitter));
    } finally {
      await releaseLock();
    }
  };
}

router.post("/leads/:id/submissions", createSubmissionHandler());

/** Record a submission received outside the CRM. The attachment is private object storage. */
router.post("/leads/:id/submissions/manual", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const leadId = Number(req.params.id);
  const body = manualSubmissionSchema.safeParse(req.body);
  if (!Number.isSafeInteger(leadId) || !body.success) return void res.status(400).json({ error: "Invalid manual submission" });
  const access = await canAccessSubmissionLead(db, user, leadId);
  if (!access.lead) return void res.status(404).json({ error: "Lead not found" });
  if (!access.allowed) return void res.status(403).json({ error: "Forbidden" });
  const lender = await db.query.lendersTable.findFirst({ where: eq(lendersTable.id, body.data.lender_id) });
  if (!lender) return void res.status(404).json({ error: "Lender not found" });
  let linkedDeal = null;
  if (body.data.deal_id) {
    linkedDeal = await db.query.dealsTable.findFirst({ where: and(eq(dealsTable.id, body.data.deal_id), eq(dealsTable.leadId, leadId)) });
    if (!linkedDeal) return void res.status(400).json({ error: "Deal does not belong to this lead" });
    if (user.role === "rep" && linkedDeal.assignedTo !== user.id) return void res.status(403).json({ error: "Forbidden" });
  } else {
    linkedDeal = (await db.query.dealsTable.findMany({
      where: and(eq(dealsTable.leadId, leadId), eq(dealsTable.isArchived, false)),
      orderBy: (table: any, { asc: orderAsc }: { asc: any }) => [orderAsc(table.id)],
      limit: 1,
    }))[0] ?? null;
  }
  let approvalAttachmentKey: string | null = null;
  if (body.data.approval_pdf_base64) {
    const bytes = Buffer.from(body.data.approval_pdf_base64, "base64");
    if (bytes.subarray(0, 4).toString() !== "%PDF") return void res.status(400).json({ error: "Approval attachment must be a PDF" });
    approvalAttachmentKey = `/objects/lender-approval-attachments/${leadId}/${Date.now()}-${createHash("sha256").update(bytes).digest("hex")}.pdf`;
    await storeSubmissionPackage(approvalAttachmentKey, bytes);
  }
  const sentAt = body.data.submitted_at ? new Date(body.data.submitted_at) : new Date();
  const submission = await db.transaction(async (tx: any) =>
    recordManualLenderSubmission({
      insert: async (values) => {
        const [row] = await tx.insert(lenderSubmissionsTable).values(values).returning();
        return row;
      },
      logActivity: async (params) => logActivity(params, tx),
    }, {
      leadId,
      dealId: linkedDeal?.id ?? null,
      lenderId: lender.id,
      sentBy: user.id,
      status: body.data.status,
      notes: body.data.notes ?? null,
      sentAt,
      decisionDate: ["approved", "declined"].includes(body.data.status) ? sentAt : null,
      approvalAttachmentKey,
    }));
  res.status(201).json(submissionToApi(submission, lender, user));
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
     .orderBy(desc(lenderSubmissionsTable.sentAt));

  const allLenders = await db.select().from(lendersTable);
  const lenderMap: Record<number, typeof lendersTable.$inferSelect> = {};
  for (const l of allLenders) lenderMap[l.id] = l;

  const allUsers = await db.select().from(usersTable);
  const userMap: Record<number, typeof usersTable.$inferSelect> = {};
  for (const u of allUsers) userMap[u.id] = u;
  const approvalDocuments = await approvalDocumentsBySubmission(subs);

   res.json(subs.map((s) => submissionToApi(
     s,
     lenderMap[s.lenderId],
     s.sentBy ? userMap[s.sentBy] : null,
     s.dealId ? approvalDocuments.get(`${s.dealId}:${s.lenderId}`) : null,
   )));
});

export function createUpdateSubmissionHandler(
  dependencies: LenderSubmissionRouteDependencies = {},
) {
  const routeDb = dependencies.database ?? db;
  const authenticate = dependencies.authenticate ?? requireUser;
  const recordActivity = dependencies.recordActivity ?? logActivity;
  const notify = dependencies.notify ?? createNotification;

  return async function updateSubmission(req: Request, res: Response): Promise<void> {
    const user = await authenticate(req, res);
    if (!user) return;

    const id = parseInt(req.params["id"] as string, 10);
    if (isNaN(id)) return void res.status(400).json({ error: "Invalid ID" });

    const body = submissionUpdateSchema.safeParse(req.body);
    if (!body.success) return inputError(res, body);
    const { status, notes, response_notes } = body.data;

    const existing = await routeDb.query.lenderSubmissionsTable.findFirst({ where: eq(lenderSubmissionsTable.id, id) });
    if (!existing) return void res.status(404).json({ error: "Submission not found" });
    const access = await canAccessSubmissionLead(routeDb, user, existing.leadId);
    if (!access.allowed) return void res.status(403).json({ error: "Forbidden" });
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (status !== undefined) updates["status"] = status;
    if (status === "approved" || status === "declined") updates["decisionDate"] = new Date();
    if (notes !== undefined || response_notes !== undefined) updates["notes"] = notes ?? response_notes;

    const [updated] = await routeDb.transaction(async (tx: any) => {
      const [row] = await tx.update(lenderSubmissionsTable).set(updates as any).where(eq(lenderSubmissionsTable.id, id)).returning();
      if (status !== undefined && status !== existing.status) {
        await recordActivity({
          userId: user.id, leadId: existing.leadId, dealId: existing.dealId,
          action: "lender_submission_status_changed", entityType: "lender_submission", entityId: id,
          details: { from: existing.status, to: status },
        }, tx);
      }
      if ((notes !== undefined || response_notes !== undefined) && (notes ?? response_notes) !== existing.notes) {
        await recordActivity({
          userId: user.id, leadId: existing.leadId, dealId: existing.dealId,
          action: "lender_submission_notes_updated", entityType: "lender_submission", entityId: id,
        }, tx);
      }
      return [row] as const;
    });

    const lender = updated.lenderId
      ? await routeDb.query.lendersTable.findFirst({ where: eq(lendersTable.id, updated.lenderId) })
      : null;
    const submitter = updated.sentBy
      ? await routeDb.query.usersTable.findFirst({ where: eq(usersTable.id, updated.sentBy) })
      : null;
    if (status !== undefined && status !== existing.status) {
      const lead = await routeDb.query.leadsTable.findFirst({ where: eq(leadsTable.id, existing.leadId) });
      if (lead?.assignedRepId) {
        await notify({
          userId: lead.assignedRepId,
          type: "status_changed",
          event: "submission_status_changed",
          title: "Lender submission status changed",
          body: `Submission status changed to ${status}`,
          leadId: existing.leadId,
        });
      }
    }

    res.json(submissionToApi(updated, lender, submitter));
  };
}

router.put("/submissions/:id", createUpdateSubmissionHandler());
router.patch("/submissions/:id", createUpdateSubmissionHandler());

export function createDownloadSubmissionPackageHandler(dependencies: LenderSubmissionRouteDependencies = {}) {
  const routeDb = dependencies.database ?? db;
  const authenticate = dependencies.authenticate ?? requireUser;
  const downloadExactPackage = dependencies.downloadExactPackage ?? downloadSubmissionPackage;
  const recordActivity = dependencies.recordActivity ?? logActivity;
  const auditPiiAccess = dependencies.auditPiiAccess ?? logPiiAccess;
  return async function downloadSubmissionPackage(req: Request, res: Response): Promise<void> {
    const user = await authenticate(req, res);
    if (!user) return;
    const id = Number(req.params["id"]);
    if (!Number.isSafeInteger(id) || id <= 0) return void res.status(400).json({ error: "Invalid ID" });
    const submission = await routeDb.query.lenderSubmissionsTable.findFirst({ where: eq(lenderSubmissionsTable.id, id) });
    if (!submission) return void res.status(404).json({ error: "Submission not found" });
    const access = await canAccessSubmissionLead(routeDb, user, submission.leadId);
    if (!access.allowed) return void res.status(403).json({ error: "Forbidden" });
    const packageConfig = parsePersistedLenderPackageConfig(submission.packageConfigSnapshot);
    const ssnUnmasked = true;
    if (!submission.exactPackageKey || !submission.exactPackageSha256) {
      return void res.status(404).json({ error: "The exact sent package is unavailable" });
    }
    try {
      const bytes = await downloadExactPackage(submission.exactPackageKey);
      const hash = createHash("sha256").update(bytes).digest("hex");
      if (hash !== submission.exactPackageSha256 || (submission.exactPackageBytes != null && bytes.length !== submission.exactPackageBytes)) {
        req.log?.error({ submissionId: id }, "Stored lender package integrity check failed");
        return void res.status(409).json({ error: "The stored package failed its integrity check" });
      }
      await recordActivity({
        userId: user.id, leadId: submission.leadId, dealId: submission.dealId,
        action: "lender_package_downloaded", entityType: "lender_submission", entityId: submission.id,
        details: {
          packageSections: packageConfig?.sections ?? null,
          packageDocumentIds: packageConfig?.documentIds ?? null,
          ssnUnmasked,
        },
      });
      auditPiiAccess({ userId: user.id, leadId: submission.leadId, fieldCategory: "application", action: "export", ip: req.ip, metadata: piiPackageMetadata(packageConfig, ssnUnmasked) });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Content-Disposition", `attachment; filename="MBS-Submission-${id}.pdf"`);
      res.setHeader("Content-Length", String(bytes.length));
      res.send(bytes);
    } catch (error) {
      req.log?.error({ err: error, submissionId: id }, "Failed to retrieve lender submission package");
      res.status(500).json({ error: "Could not retrieve the exact sent package" });
    }
  };
}

router.get("/submissions/:id/package", createDownloadSubmissionPackageHandler());

router.get("/submissions/:id/approval-attachment", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const id = Number(req.params.id);
  const submission = await db.query.lenderSubmissionsTable.findFirst({ where: eq(lenderSubmissionsTable.id, id) });
  if (!submission) return void res.status(404).json({ error: "Submission not found" });
  const access = await canAccessSubmissionLead(db, user, submission.leadId);
  if (!access.allowed) return void res.status(403).json({ error: "Forbidden" });
  if (!submission.approvalAttachmentKey) return void res.status(404).json({ error: "No approval attachment" });
  try {
    const bytes = await downloadSubmissionPackage(submission.approvalAttachmentKey);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", `attachment; filename="Lender-Approval-${id}.pdf"`);
    res.send(bytes);
  } catch {
    res.status(404).json({ error: "Approval attachment unavailable" });
  }
});

router.get("/deals/:id/submissions", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const dealId = Number(req.params["id"]);
  if (!Number.isSafeInteger(dealId) || dealId <= 0) return void res.status(400).json({ error: "Invalid deal ID" });
  const deal = await db.query.dealsTable.findFirst({ where: eq(dealsTable.id, dealId) });
  if (!deal) return void res.status(404).json({ error: "Deal not found" });
  if (user.role !== "admin" && !(user.role === "rep" && deal.assignedTo === user.id)) return void res.status(403).json({ error: "Forbidden" });
  const subs = await db.select().from(lenderSubmissionsTable).where(eq(lenderSubmissionsTable.dealId, dealId)).orderBy(desc(lenderSubmissionsTable.sentAt));
  const lenders = await db.select().from(lendersTable);
  const users = await db.select().from(usersTable);
  const lenderMap = Object.fromEntries(lenders.map((row) => [row.id, row]));
  const userMap = Object.fromEntries(users.map((row) => [row.id, row]));
  const approvalDocuments = await approvalDocumentsBySubmission(subs);
  res.json(subs.map((row) => submissionToApi(
    row,
    lenderMap[row.lenderId],
    row.sentBy ? userMap[row.sentBy] : null,
    approvalDocuments.get(`${dealId}:${row.lenderId}`),
  )));
});

export default router;
