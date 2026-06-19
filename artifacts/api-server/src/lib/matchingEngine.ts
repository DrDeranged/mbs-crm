import { db } from "@workspace/db";
import {
  leadsTable, lendersTable, lenderMatchesTable, companiesTable,
  activityLogTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";

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
    const breakdown: CriterionResult[] = [];

    // 1. Program type match
    const programTypes = lender.programTypes ?? [];
    if (programTypes.length > 0) {
      const passed = programTypes.includes(lead.applicationType);
      breakdown.push({
        criterion: "Program Type",
        passed,
        detail: passed
          ? `Lead type "${lead.applicationType}" matches lender programs [${programTypes.join(", ")}]`
          : `Lead type "${lead.applicationType}" not in [${programTypes.join(", ")}]`,
      });
    }

    // 2. Requested amount in range
    if (lead.requestedAmount != null && (lender.minAmount != null || lender.maxAmount != null)) {
      const belowMin = lender.minAmount != null && lead.requestedAmount < lender.minAmount;
      const aboveMax = lender.maxAmount != null && lead.requestedAmount > lender.maxAmount;
      const passed = !belowMin && !aboveMax;
      const minStr = lender.minAmount != null ? `$${lender.minAmount.toLocaleString()}` : "any";
      const maxStr = lender.maxAmount != null ? `$${lender.maxAmount.toLocaleString()}` : "any";
      breakdown.push({
        criterion: "Requested Amount",
        passed,
        detail: passed
          ? `$${lead.requestedAmount.toLocaleString()} is within range ${minStr}–${maxStr}`
          : `$${lead.requestedAmount.toLocaleString()} is outside range ${minStr}–${maxStr}`,
      });
    }

    // 3. Credit score (skip if lead has no score yet)
    if (lender.minCreditScore != null) {
      if (lead.creditScore == null) {
        breakdown.push({
          criterion: "Credit Score",
          passed: true,
          skipped: true,
          detail: "Credit score not yet available — criterion skipped",
        });
      } else {
        const passed = lead.creditScore >= lender.minCreditScore;
        breakdown.push({
          criterion: "Credit Score",
          passed,
          detail: passed
            ? `Score ${lead.creditScore} meets minimum ${lender.minCreditScore}`
            : `Score ${lead.creditScore} is below minimum ${lender.minCreditScore}`,
        });
      }
    }

    // 4. Industry (skip if lender accepts all)
    const acceptedIndustries = lender.acceptedIndustries ?? [];
    if (acceptedIndustries.length > 0 && company?.industry) {
      const passed = acceptedIndustries.some(
        (ind) => ind.toLowerCase() === (company.industry ?? "").toLowerCase()
      );
      breakdown.push({
        criterion: "Industry",
        passed,
        detail: passed
          ? `Industry "${company.industry}" is accepted`
          : `Industry "${company.industry}" not in accepted list [${acceptedIndustries.join(", ")}]`,
      });
    }

    // 5. Time in business
    const minMonths = lender.minTimeInBusinessMonths ?? 0;
    if (minMonths > 0 && company?.timeInBusinessMonths != null) {
      const passed = company.timeInBusinessMonths >= minMonths;
      breakdown.push({
        criterion: "Time in Business",
        passed,
        detail: passed
          ? `${company.timeInBusinessMonths} months meets minimum ${minMonths} months`
          : `${company.timeInBusinessMonths} months is below minimum ${minMonths} months`,
      });
    }

    // 6. Accepted states (skip if lender accepts all)
    const acceptedStates = lender.acceptedStates ?? [];
    if (acceptedStates.length > 0 && company?.state) {
      const passed = acceptedStates.some(
        (s) => s.toUpperCase() === (company.state ?? "").toUpperCase()
      );
      breakdown.push({
        criterion: "State",
        passed,
        detail: passed
          ? `State "${company.state}" is accepted`
          : `State "${company.state}" not in accepted states [${acceptedStates.join(", ")}]`,
      });
    }

    // 7. Existing positions
    const maxPositions = lender.maxExistingPositions ?? 10;
    if (lead.existingPositions != null) {
      const passed = lead.existingPositions <= maxPositions;
      breakdown.push({
        criterion: "Existing Positions",
        passed,
        detail: passed
          ? `${lead.existingPositions} existing positions within max ${maxPositions}`
          : `${lead.existingPositions} existing positions exceeds max ${maxPositions}`,
      });
    }

    // Score: (passed / applicable) * 100, then apply priority weight
    const applicable = breakdown.filter((b) => !b.skipped);
    const passed = applicable.filter((b) => b.passed).length;
    const total = applicable.length;
    const baseScore = total > 0 ? Math.round((passed / total) * 100) : 0;
    const weight = lender.priorityWeight ?? 5;
    // Weighted score: base score adjusted by priority (weight/5 is the multiplier, capped at 100)
    const weightedScore = Math.min(100, Math.round(baseScore * (weight / 5)));

    results.push({
      lenderId: lender.id,
      lenderName: lender.name,
      matchScore: baseScore,
      weightedScore,
      criteriaBreakdown: breakdown,
    });
  }

  // Sort by weighted score descending
  results.sort((a, b) => b.weightedScore - a.weightedScore);

  // Upsert: delete existing matches and store new results
  if (results.length > 0) {
    await db.delete(lenderMatchesTable).where(eq(lenderMatchesTable.leadId, leadId));
    await db.insert(lenderMatchesTable).values(
      results.map((r) => ({
        leadId,
        lenderId: r.lenderId,
        matchScore: r.weightedScore,
        criteriaBreakdown: r.criteriaBreakdown,
      }))
    );

    // Log activity
    await db.insert(activityLogTable).values({
      leadId,
      action: "lender_match_run",
      entityType: "lead",
      entityId: String(leadId),
      details: { matchCount: results.length, topLender: results[0]?.lenderName },
    });
  }

  return results;
}
