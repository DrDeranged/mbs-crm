import { db } from "@workspace/db";
import {
  leadsTable, lendersTable, lenderMatchesTable, companiesTable,
  activityLogTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { evaluateLender } from "./matchingEligibility";

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
}

export async function matchLeadToLenders(leadId: number): Promise<LenderMatchResult[]> {
  const lead = await db.query.leadsTable.findFirst({
    where: eq(leadsTable.id, leadId),
    with: { company: true },
  });
  if (!lead) throw new Error(`Lead ${leadId} not found`);

  const company = (lead as any).company as typeof companiesTable.$inferSelect | null;
  const lenders = await db.select().from(lendersTable).where(eq(lendersTable.isActive, true));

  const results: LenderMatchResult[] = [];

  for (const lender of lenders) {
    const evaluation = evaluateLender(lender, lead, company);
    if (!evaluation.eligible) continue;

    results.push({
      lenderId: lender.id,
      lenderName: lender.name,
      matchScore: evaluation.matchScore,
      weightedScore: evaluation.weightedScore,
      criteriaBreakdown: evaluation.criteriaBreakdown,
    });
  }

  // Sort by weighted score descending
  results.sort((a, b) => b.weightedScore - a.weightedScore);

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
