export interface EligibilityCriterion {
  criterion: string;
  passed: boolean;
  skipped?: boolean;
  detail: string;
}

export interface LenderEvaluationLender {
  name?: string;
  programTypes?: readonly string[] | null;
  minAmount?: number | null;
  maxAmount?: number | null;
  minCreditScore?: number | null;
  acceptedIndustries?: readonly string[] | null;
  minTimeInBusinessMonths?: number | null;
  acceptedStates?: readonly string[] | null;
  maxExistingPositions?: number | null;
  priorityWeight?: number | null;
}

export interface LenderEvaluationLead {
  applicationType: string;
  requestedAmount?: number | null;
  creditScore?: number | null;
  existingPositions?: number | null;
}

export interface LenderEvaluationApplication {
  businessStartDate?: string | null;
  estCreditScore?: string | null;
  // yearsUnderCurrentOwnership is intentionally not evaluated: lenders have
  // no ownership-tenure rule in the current schema.
}

export interface LenderEvaluationCompany {
  industry?: string | null;
  timeInBusinessMonths?: number | null;
  state?: string | null;
}

export interface LenderEvaluation {
  criteriaBreakdown: EligibilityCriterion[];
  eligible: boolean;
  matchScore: number;
  weightedScore: number;
}

const ESTIMATED_SCORE_MINIMUMS: Record<string, number> = {
  below_500: 300,
  "500_549": 500,
  "550_599": 550,
  "600_649": 600,
  "650_699": 650,
  "700_plus": 700,
};

function estimatedScoreMinimum(band: string | null | undefined): number | null {
  return band && ESTIMATED_SCORE_MINIMUMS[band] != null
    ? ESTIMATED_SCORE_MINIMUMS[band]
    : null;
}

function monthsFromBusinessStartDate(value: string | null | undefined): number | null {
  if (!value || !/^(0[1-9]|1[0-2])\/\d{4}$/.test(value)) return null;
  const [month, year] = value.split("/").map(Number);
  const now = new Date();
  const months = (now.getUTCFullYear() - year) * 12 + (now.getUTCMonth() + 1 - month);
  return Math.max(0, months);
}

/**
 * Missing criteria are omitted or marked skipped and do not exclude a lender.
 * Any applicable criterion that fails is a hard eligibility exclusion.
 */
export function isEligibleFromCriteria(criteria: EligibilityCriterion[]): boolean {
  return criteria.every((criterion) => criterion.skipped || criterion.passed);
}

/**
 * Pure lender evaluator. The DB matching loop supplies actual lender, lead,
 * and company records; this function intentionally has no persistence side
 * effects and does not evaluate revenue because the lender schema has no
 * revenue field.
 */
export function evaluateLender(
  lender: LenderEvaluationLender,
  lead: LenderEvaluationLead,
  company?: LenderEvaluationCompany | null,
  application?: LenderEvaluationApplication | null,
): LenderEvaluation {
  const breakdown: EligibilityCriterion[] = [];
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

  if (lender.minCreditScore != null) {
    const creditScore = lead.creditScore ?? estimatedScoreMinimum(application?.estCreditScore);
    if (creditScore == null) {
      breakdown.push({
        criterion: "Credit Score",
        passed: true,
        skipped: true,
        detail: "Credit score not yet available — criterion skipped",
      });
    } else {
      const passed = creditScore >= lender.minCreditScore;
      breakdown.push({
        criterion: "Credit Score",
        passed,
        detail: passed
          ? `Score ${creditScore}${lead.creditScore == null ? " (estimated band minimum)" : ""} meets minimum ${lender.minCreditScore}`
          : `Score ${creditScore}${lead.creditScore == null ? " (estimated band minimum)" : ""} is below minimum ${lender.minCreditScore}`,
      });
    }
  }

  const acceptedIndustries = lender.acceptedIndustries ?? [];
  if (acceptedIndustries.length > 0 && company?.industry) {
    const passed = acceptedIndustries.some(
      (ind) => ind.toLowerCase() === (company.industry ?? "").toLowerCase(),
    );
    breakdown.push({
      criterion: "Industry",
      passed,
      detail: passed
        ? `Industry "${company.industry}" is accepted`
        : `Industry "${company.industry}" not in accepted list [${acceptedIndustries.join(", ")}]`,
    });
  }

  const minMonths = lender.minTimeInBusinessMonths ?? 0;
  const timeInBusinessMonths = company?.timeInBusinessMonths
    ?? monthsFromBusinessStartDate(application?.businessStartDate);
  if (minMonths > 0 && timeInBusinessMonths != null) {
    const passed = timeInBusinessMonths >= minMonths;
    breakdown.push({
      criterion: "Time in Business",
      passed,
      detail: passed
        ? `${timeInBusinessMonths} months meets minimum ${minMonths} months`
        : `${timeInBusinessMonths} months is below minimum ${minMonths} months`,
    });
  }

  const acceptedStates = lender.acceptedStates ?? [];
  if (acceptedStates.length > 0 && company?.state) {
    const passed = acceptedStates.some(
      (state) => state.toUpperCase() === (company.state ?? "").toUpperCase(),
    );
    breakdown.push({
      criterion: "State",
      passed,
      detail: passed
        ? `State "${company.state}" is accepted`
        : `State "${company.state}" not in accepted states [${acceptedStates.join(", ")}]`,
    });
  }

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

  const applicable = breakdown.filter((criterion) => !criterion.skipped);
  const passed = applicable.filter((criterion) => criterion.passed).length;
  const total = applicable.length;
  const matchScore = total > 0 ? Math.round((passed / total) * 100) : 0;
  const priorityWeight = lender.priorityWeight ?? 5;
  const weightedScore = Math.min(100, Math.round(matchScore * (priorityWeight / 5)));

  return {
    criteriaBreakdown: breakdown,
    eligible: isEligibleFromCriteria(breakdown),
    matchScore,
    weightedScore,
  };
}