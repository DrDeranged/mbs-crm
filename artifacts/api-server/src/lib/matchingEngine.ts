import { db } from "@workspace/db";
import {
  leadsTable, lendersTable, lenderMatchesTable, companiesTable,
  applicationsTable,
  activityLogTable,
  bankStatementExtractionsTable,
  underwritingCorrectionsTable,
  documentsTable,
} from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { evaluateLender } from "./matchingEligibility";
import { partnerMatchGroup } from "./partnerFlows";

export { evaluateLender, isEligibleFromCriteria } from "./matchingEligibility";

export interface CriterionResult {
  criterion: string;
  passed: boolean;
  skipped?: boolean;
  detail: string;
}

export interface LenderMatchResult {
  lenderId: number;
  lenderName: string;
  matchScore: number;
  weightedScore: number;
  criteriaBreakdown: CriterionResult[];
  partnerType?: "direct_lender" | "broker_out" | "broker_in";
  matchGroup?: "lender" | "super_broker";
  verdict: "Likely" | "Possible" | "Excluded";
  reason: string;
  expectedTier: string | null;
  downPaymentPct: number | null;
  points: number | null;
  downPayment: string | null;
  turnaround: { min: number | null; max: number | null } | null;
  needsBeforeSubmit: string[];
  exclusions: string[];
}

export function lenderNeedsBusinessStatements(requiredDocuments: readonly string[] = []): boolean {
  return requiredDocuments.some((document) => /bank|statement|business account/i.test(document));
}

function dealPointsUpperBound(
  lender: { compensation?: { type?: string; min?: number; max?: number } | null; notes?: string | null },
  context: { requestedAmount?: number | null; businessState?: string | null; industry?: string | null; equipmentCategory?: string | null; downPaymentPct?: number | null },
): number | null {
  if (lender.compensation?.type !== "points" || !lender.notes) return null;
  const notes = lender.notes;
  if (/\bnew york[-\s]based borrowers?\b/i.test(notes) && /^NY$/i.test(context.businessState ?? "")) {
    const nyTail = notes.match(/up to\s+(\d+)%?\s+on fundings for new york/i);
    if (nyTail) return Number(nyTail[1]);
  }
  const isTruck = context.equipmentCategory === "otr_truck" || /\b(trucking|transportation)\b/i.test(context.industry ?? "");
  if (isTruck) {
    const down = context.downPaymentPct;
    if (down == null) return null;
    if (down >= 40 && /up to\s+10%/.test(notes)) return 10;
    if (down >= 20 && /commission:\s*8%/.test(notes)) return 8;
    return null;
  }
  if (/TRUCKS\s*&\s*TRAILERS/i.test(notes) && !context.equipmentCategory && !context.industry) return null;
  const amount = context.requestedAmount;
  if (amount == null) return null;
  const tiers = [...notes.matchAll(/up to\s+(\d+)%?\s*(?:commission\s*)?(?:≤\s*\$?([\d,]+)|\$?[\d,]+\s*[–-]\s*\$?([\d,]+)|under\s*\$?([\d,]+))/gi)]
    .map((match) => ({ points: Number(match[1]), cap: Number((match[2] ?? match[3] ?? match[4]).replace(/,/g, "")) }))
    .sort((a, b) => a.cap - b.cap);
  const tier = tiers.find((candidate) => amount <= candidate.cap);
  return tier?.points ?? null;
}

export function repFacingMatchDetails(
  evaluation: { eligible: boolean; criteriaBreakdown: CriterionResult[]; matchScore: number; weightedScore: number },
  lender: { requiredDocuments?: readonly string[] | null; requiresFinancialStatements?: boolean | null; compensation?: { type?: string; min?: number; max?: number; flatAmount?: number } | null; turnaroundBusinessDaysMin?: number | null; turnaroundBusinessDaysMax?: number | null; pricing?: { minDownPaymentPct?: number | null; structures?: string[] } | null; notes?: string | null },
  context: { businessStatementsPersonalOrJoint?: boolean; businessStatementStatus?: "business" | "personal_or_joint" | "unknown"; uploadedDocuments?: readonly string[]; uploadedDocumentCategories?: readonly string[]; requestedAmount?: number | null; businessState?: string | null; industry?: string | null; equipmentCategory?: string | null; downPaymentPct?: number | null; capturedApproval?: { tier: string; downPayment?: string | null } } = {},
) {
  const failures = evaluation.criteriaBreakdown.filter((criterion) => !criterion.skipped && !criterion.passed);
  const exclusions = failures.map((criterion) => criterion.detail);
  const uploaded = (context.uploadedDocuments ?? []).join(" ").toLowerCase();
  const categories = context.uploadedDocumentCategories ?? [];
  const satisfies = (document: string) => {
    const required = document.toLowerCase();
    if (/bank|statement|financial/.test(required)) {
      const monthsRequired = /(?:last|past|previous)\s*3|3\s*months?/i.test(required) ? 3 : 1;
      const statements = categories.filter((category) => category === "bank_statement").length;
      const status = context.businessStatementStatus ?? (context.businessStatementsPersonalOrJoint ? "personal_or_joint" : "unknown");
      return statements >= monthsRequired && status !== "personal_or_joint";
    }
    if (/invoice|quote|equipment spec/.test(required)) return categories.includes("invoice_quote")
      || /\b(invoice|quote|spec)\b/i.test(uploaded);
    if (/application/.test(required)) return categories.includes("signed_application") || /\b(application|credit application)\b/i.test(uploaded);
    if (/driver|passport|dl/.test(required)) return categories.includes("drivers_license") || /\b(driver|passport|license)\b/i.test(uploaded);
    return new RegExp(document.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(uploaded);
  };
  const needsBeforeSubmit = (lender.requiredDocuments ?? []).filter((document) => !satisfies(document));
  if ((lender.requiresFinancialStatements || lenderNeedsBusinessStatements(lender.requiredDocuments ?? []))
    && (context.businessStatementStatus === "personal_or_joint" || context.businessStatementsPersonalOrJoint)) {
    const blocker = "Business bank statements (uploaded statements are personal/joint)";
    if (!needsBeforeSubmit.some((item) => /bank|statement/i.test(item))) needsBeforeSubmit.push(blocker);
    exclusions.push(blocker);
  }
  const points = dealPointsUpperBound(lender, context);
  const downPayment = context.capturedApproval?.downPayment
    ?? (lender.pricing?.minDownPaymentPct != null
    ? `${lender.pricing.minDownPaymentPct}%`
    : null);
  const verdict: "Excluded" | "Likely" | "Possible" = !evaluation.eligible ? "Excluded" : evaluation.matchScore >= 80 ? "Likely" : "Possible";
  return {
    verdict,
    reason: !evaluation.eligible ? exclusions[0] ?? "A documented eligibility criterion failed" : verdict === "Likely" ? "Meets the documented lender criteria" : "Potential fit; confirm remaining underwriting conditions",
    expectedTier: context.capturedApproval?.tier ?? null,
    downPaymentPct: lender.pricing?.minDownPaymentPct ?? null,
    downPayment,
    points,
    turnaround: lender.turnaroundBusinessDaysMin == null && lender.turnaroundBusinessDaysMax == null ? null : {
      min: lender.turnaroundBusinessDaysMin ?? null, max: lender.turnaroundBusinessDaysMax ?? null,
    },
    needsBeforeSubmit,
    exclusions,
  };
}

export async function matchLeadToLenders(leadId: number): Promise<LenderMatchResult[]> {
  const lead = await db.query.leadsTable.findFirst({
    where: eq(leadsTable.id, leadId),
    with: { company: true },
  });
  if (!lead) throw new Error(`Lead ${leadId} not found`);

  const company = (lead as any).company as typeof companiesTable.$inferSelect | null;
  const application = await db.query.applicationsTable.findFirst({
    where: eq(applicationsTable.leadId, leadId),
    orderBy: [desc(applicationsTable.submittedAt), desc(applicationsTable.id)],
  });
  const lenders = await db.select().from(lendersTable).where(eq(lendersTable.isActive, true));
  const [bankRows, corrections, documents] = await Promise.all([
    db.select().from(bankStatementExtractionsTable).where(eq(bankStatementExtractionsTable.leadId, leadId)),
    db.select().from(underwritingCorrectionsTable).where(eq(underwritingCorrectionsTable.leadId, leadId)).orderBy(desc(underwritingCorrectionsTable.createdAt), desc(underwritingCorrectionsTable.id)),
    db.select().from(documentsTable).where(eq(documentsTable.leadId, leadId)),
  ]);
  const latestCorrection = new Map<string, unknown>();
  for (const correction of corrections) if (!latestCorrection.has(correction.field)) latestCorrection.set(correction.field, correction.correctedValue);
  const correctedLead = { ...lead } as any;
  const correctedCompany = company ? { ...company } as any : {};
  const correctedApplication = application ? { ...application } as any : {};
  const target: Record<string, [Record<string, unknown>, string]> = {
    requestedAmount: [correctedLead, "requestedAmount"],
    creditScore: [correctedLead, "creditScore"],
    existingPositions: [correctedLead, "existingPositions"],
    industry: [correctedApplication, "industry"],
    businessState: [correctedApplication, "businessState"],
    timeInBusinessMonths: [correctedApplication, "timeInBusinessMonths"],
    monthlyRevenue: [correctedApplication, "monthlyRevenueStated"],
    equipmentDescription: [correctedApplication, "equipmentDescription"],
    equipmentCategory: [correctedApplication, "equipmentCategory"],
    equipmentYear: [correctedApplication, "yearMakeModel"],
    vendorName: [correctedApplication, "vendorName"],
    transactionAmount: [correctedApplication, "vendorQuoteAmount"],
    intendedUse: [correctedApplication, "useOfFunds"],
  };
  for (const [field, value] of latestCorrection) {
    const destination = target[field];
    if (destination) destination[0][destination[1]] = value;
  }
  if (!latestCorrection.has("monthlyRevenue")) {
    const deposits = bankRows.map((row) => row.totalDeposits == null ? null : Number(row.totalDeposits)).filter((value): value is number => value != null && Number.isFinite(value));
    if (deposits.length) correctedApplication.monthlyRevenueStated = Math.round(deposits.reduce((sum, value) => sum + value, 0) / deposits.length);
  }

  const results: LenderMatchResult[] = [];

  const uploadedDocumentCategories = documents.map((document) => document.category);
  const uploadedDocuments = documents.flatMap((document) => [document.category, document.label, document.filename].filter(Boolean) as string[]);
  const bankSignals = bankRows.flatMap((row) => {
    const raw = (row.rawExtractionJson ?? {}) as Record<string, unknown>;
    return [raw.accountType, raw.account_type, raw.ownershipType, raw.ownership_type].filter(Boolean).map(String);
  }).concat(uploadedDocuments);
  const hasBusinessStatement = bankSignals.some((value) => /business account|business checking|business savings/i.test(value));
  const businessStatementStatus = hasBusinessStatement
    ? "business" as const
    : bankSignals.some((value) => /personal|joint/i.test(value))
      ? "personal_or_joint" as const
      : "unknown" as const;

  for (const lender of lenders) {
    const evaluation = evaluateLender(lender, correctedLead, correctedCompany, {
      ...correctedApplication,
      hasFinancialStatements: correctedApplication.hasFinancialStatements ?? documents.some((document) => document.category === "tax_return"),
    });
    const details = repFacingMatchDetails(evaluation, lender, {
      businessStatementStatus, uploadedDocuments, uploadedDocumentCategories,
      requestedAmount: correctedLead.requestedAmount,
      businessState: correctedCompany.state ?? correctedApplication.businessState,
      industry: correctedCompany.industry ?? correctedApplication.industry,
      equipmentCategory: correctedApplication.equipmentCategory,
    });
    // Keep document gaps in the persisted criteria payload so a later GET
    // renders the same blocker without requiring a new schema column.
    const persistedCriteria = details.needsBeforeSubmit
      .filter((item) => /personal\/joint|business bank statements/i.test(item))
      .map((detail) => ({ criterion: "Document Gap", passed: true, skipped: true, detail }));
    results.push({
      lenderId: lender.id,
      lenderName: lender.name,
      matchScore: evaluation.matchScore,
      weightedScore: evaluation.weightedScore,
      criteriaBreakdown: [...evaluation.criteriaBreakdown, ...persistedCriteria],
      partnerType: lender.partnerType,
      matchGroup: partnerMatchGroup(lender.partnerType),
      ...details,
    });
  }

  // Reps need approval likelihood first, then points, then speed. Exclusions
  // remain visible so the failing criterion is actionable.
  results.sort((a, b) => {
    if (a.verdict !== b.verdict) return a.verdict === "Excluded" ? 1 : -1;
    if (b.weightedScore !== a.weightedScore) return b.weightedScore - a.weightedScore;
    if ((b.points ?? -1) !== (a.points ?? -1)) return (b.points ?? -1) - (a.points ?? -1);
    return (a.turnaround?.max ?? 999) - (b.turnaround?.max ?? 999);
  });

  // Always clear prior matches first, then insert new results (even if empty)
  await db.delete(lenderMatchesTable).where(eq(lenderMatchesTable.leadId, leadId));
  if (results.length > 0) {
    await db.insert(lenderMatchesTable).values(
      results.map((r) => ({
        leadId,
        lenderId: r.lenderId,
        matchScore: r.weightedScore,
        criteriaBreakdown: r.criteriaBreakdown,
      }))
    );
  }

  // Log activity
   await db.insert(activityLogTable).values({
    leadId,
    action: "lender_match_run",
    entityType: "lead",
    entityId: String(leadId),
    details: { matchCount: results.filter((result) => result.verdict !== "Excluded").length, topLender: results[0]?.lenderName },
  });

  return results;
}
