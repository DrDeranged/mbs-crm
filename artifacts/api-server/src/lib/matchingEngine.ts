import { db } from "@workspace/db";
import {
  leadsTable, lendersTable, lenderMatchesTable, companiesTable,
  applicationsTable,
  activityLogTable,
  bankStatementExtractionsTable,
  underwritingCorrectionsTable,
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
  const [bankRows, corrections] = await Promise.all([
    db.select().from(bankStatementExtractionsTable).where(eq(bankStatementExtractionsTable.leadId, leadId)),
    db.select().from(underwritingCorrectionsTable).where(eq(underwritingCorrectionsTable.leadId, leadId)).orderBy(desc(underwritingCorrectionsTable.createdAt), desc(underwritingCorrectionsTable.id)),
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

  for (const lender of lenders) {
    const evaluation = evaluateLender(lender, correctedLead, correctedCompany, correctedApplication);
    if (!evaluation.eligible) continue;

    results.push({
      lenderId: lender.id,
      lenderName: lender.name,
      matchScore: evaluation.matchScore,
      weightedScore: evaluation.weightedScore,
      criteriaBreakdown: evaluation.criteriaBreakdown,
      partnerType: lender.partnerType,
      matchGroup: partnerMatchGroup(lender.partnerType),
    });
  }

  // Sort by weighted score descending
  results.sort((a, b) => {
    if (a.matchGroup !== b.matchGroup) return a.matchGroup === "super_broker" ? 1 : -1;
    return b.weightedScore - a.weightedScore;
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
    details: { matchCount: results.length, topLender: results[0]?.lenderName },
  });

  return results;
}
