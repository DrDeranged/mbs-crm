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
  restrictedIndustries?: readonly string[] | null;
  prohibitedIndustries?: readonly string[] | null;
  minMonthlyRevenue?: number | null;
  restrictedIndustryMinMonthlyRevenue?: number | null;
  startupMinCreditScore?: number | null;
  startupMaxTimeInBusinessMonths?: number | null;
  startupMaxAmount?: number | null;
  minIndustryExperienceMonths?: number | null;
  requiresFinancialStatements?: boolean | null;
  truckingRules?: readonly TruckingRule[] | null;
  industryTimeInBusinessOverrides?: readonly IndustryTimeInBusinessOverride[] | null;
  programEligibilityRules?: readonly ProgramEligibilityRule[] | null;
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
  businessState?: string | null;
}

export interface LenderEvaluationApplication {
  businessStartDate?: string | null;
  estCreditScore?: string | null;
  industry?: string | null;
  businessState?: string | null;
  timeInBusinessMonths?: number | null;
  monthlyRevenueStated?: number | null;
  trucksInFleet?: number | null;
  hasFinancialStatements?: boolean | null;
  hasFactoring?: boolean | null;
  hasCollateral?: boolean | null;
  industryExperienceMonths?: number | null;
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

export interface TruckingRule {
  industry: "long_haul" | "local" | "any";
  prohibited?: boolean;
  minTrucks?: number;
  minTimeInBusinessMonths?: number;
  requiresNoFactoring?: boolean;
}
export interface IndustryTimeInBusinessOverride {
  industry: string;
  minTimeInBusinessMonths: number;
}
export interface ProgramEligibilityRule {
  programType: string;
  minMonthlyRevenue?: number;
  restrictedIndustryMinMonthlyRevenue?: number;
  restrictedIndustries?: readonly string[];
  prohibitedIndustries?: readonly string[];
  truckingRules?: readonly TruckingRule[];
  requiresCollateral?: boolean;
}

export const PACKET_TRUCKING_INDUSTRY_GATING_SUPPORTED = true;

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

function normalizedIndustry(value: string): string {
  return value
    .toLowerCase()
    .replace(/[()]/g, " ")
    .replace(/[—–/&,]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function industryMatches(industry: string, criterion: string): boolean {
  const normalized = normalizedIndustry(industry);
  const candidates = criterion
    .split(/[\/&]/)
    .map(normalizedIndustry)
    .filter(Boolean);
  return candidates.some((candidate) => {
    if ((candidate === "law offices" || candidate === "law firm" || candidate === "law firms")
      && /\blaw\b/.test(normalized)) return true;
    return normalized === candidate
      || normalized.includes(candidate);
  });
}

function isTransportationIndustry(industry: string | null): boolean {
  return industry != null && /\b(trucking|transportation|transport|long haul|long-haul|otr)\b/i.test(industry);
}

function truckingRuleApplies(rule: TruckingRule, industry: string): boolean {
  if (rule.industry === "any") return true;
  if (rule.industry === "long_haul") return /\b(long haul|long-haul|otr)\b/i.test(industry);
  return /\blocal\b/i.test(industry);
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
 * effects.
 */
export function evaluateLender(
  lender: LenderEvaluationLender,
  lead: LenderEvaluationLead,
  company?: LenderEvaluationCompany | null,
  application?: LenderEvaluationApplication | null,
): LenderEvaluation {
  const breakdown: EligibilityCriterion[] = [];
  const industry = company?.industry ?? application?.industry ?? null;
  const timeInBusinessMonths = company?.timeInBusinessMonths
    ?? application?.timeInBusinessMonths
    ?? monthsFromBusinessStartDate(application?.businessStartDate);
  const monthlyRevenue = application?.monthlyRevenueStated ?? null;
  const programEligibilityRule = lender.programEligibilityRules
    ?.find((rule) => rule.programType === lead.applicationType);
  if (programEligibilityRule?.requiresCollateral) {
    const passed = application?.hasCollateral === true;
    breakdown.push({
      criterion: "Collateral",
      passed,
      detail: passed ? "Required collateral is reported" : "Real-estate or equipment collateral is required",
    });
  }
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

  if (lender.minAmount != null || lender.maxAmount != null) {
    const requestedAmount = lead.requestedAmount;
    const belowMin = requestedAmount != null && lender.minAmount != null && requestedAmount < lender.minAmount;
    const aboveMax = requestedAmount != null && lender.maxAmount != null && requestedAmount > lender.maxAmount;
    const passed = requestedAmount != null && !belowMin && !aboveMax;
    const minStr = lender.minAmount != null ? `$${lender.minAmount.toLocaleString()}` : "any";
    const maxStr = lender.maxAmount != null ? `$${lender.maxAmount.toLocaleString()}` : "any";
    breakdown.push({
      criterion: "Requested Amount",
      passed,
      detail: passed
        ? `$${requestedAmount.toLocaleString()} is within range ${minStr}–${maxStr}`
        : requestedAmount == null
          ? `Requested amount is required for range ${minStr}–${maxStr}`
          : `$${requestedAmount.toLocaleString()} is outside range ${minStr}–${maxStr}`,
    });
  }

  if (lender.minCreditScore != null) {
    const creditScore = lead.creditScore ?? estimatedScoreMinimum(application?.estCreditScore);
    if (creditScore == null) {
      breakdown.push({
        criterion: "Credit Score",
        passed: false,
        detail: `Credit score is required (minimum ${lender.minCreditScore})`,
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

  if (lender.startupMinCreditScore != null && lender.startupMaxTimeInBusinessMonths != null) {
    if (timeInBusinessMonths == null) {
      breakdown.push({
        criterion: "Startup Eligibility",
        passed: false,
        detail: "Time in business is required to evaluate startup eligibility",
      });
    } else if (timeInBusinessMonths < lender.startupMaxTimeInBusinessMonths) {
    const creditScore = lead.creditScore ?? estimatedScoreMinimum(application?.estCreditScore);
    if (creditScore == null) {
      breakdown.push({
        criterion: "Startup Credit Score",
        passed: false,
        detail: "Credit score is required for startup eligibility",
      });
    } else {
      const passed = creditScore >= lender.startupMinCreditScore;
      breakdown.push({
        criterion: "Startup Credit Score",
        passed,
        detail: passed
          ? `Score ${creditScore} meets startup minimum ${lender.startupMinCreditScore}`
          : `Score ${creditScore} is below startup minimum ${lender.startupMinCreditScore}`,
      });
    }
    if (lender.startupMaxAmount != null) {
      const passed = lead.requestedAmount != null && lead.requestedAmount <= lender.startupMaxAmount;
      breakdown.push({
        criterion: "Startup Requested Amount",
        passed,
        detail: passed
          ? `$${lead.requestedAmount} is within startup maximum $${lender.startupMaxAmount}`
          : lead.requestedAmount == null
            ? `Requested amount is required (startup maximum $${lender.startupMaxAmount})`
            : `$${lead.requestedAmount} exceeds startup maximum $${lender.startupMaxAmount}`,
      });
    }
    }
  }

  if (lender.minIndustryExperienceMonths != null) {
    const experience = application?.industryExperienceMonths ?? null;
    const passed = experience != null && experience >= lender.minIndustryExperienceMonths;
    breakdown.push({
      criterion: "Industry Experience",
      passed,
      detail: passed
        ? `${experience} months meets minimum industry experience ${lender.minIndustryExperienceMonths} months`
        : experience == null
          ? `Industry experience is required (minimum ${lender.minIndustryExperienceMonths} months)`
          : `${experience} months is below minimum industry experience ${lender.minIndustryExperienceMonths} months`,
    });
  }

  if (lender.requiresFinancialStatements) {
    const passed = application?.hasFinancialStatements === true;
    breakdown.push({
      criterion: "Financial Statements",
      passed,
      detail: passed
        ? "Required financial statements are available"
        : "Required financial statements are not available",
    });
  }

  const minMonthlyRevenue = programEligibilityRule?.minMonthlyRevenue ?? lender.minMonthlyRevenue;
  if (minMonthlyRevenue != null) {
    if (monthlyRevenue == null) {
      breakdown.push({
        criterion: "Monthly Revenue",
        passed: false,
        detail: `Monthly revenue is required (minimum $${minMonthlyRevenue.toLocaleString()})`,
      });
    } else {
      const passed = monthlyRevenue >= minMonthlyRevenue;
      breakdown.push({
        criterion: "Monthly Revenue",
        passed,
        detail: passed
          ? `$${monthlyRevenue.toLocaleString()} meets minimum $${minMonthlyRevenue.toLocaleString()}`
          : `$${monthlyRevenue.toLocaleString()} is below minimum $${minMonthlyRevenue.toLocaleString()}`,
      });
    }
  }

  const prohibitedIndustries = programEligibilityRule?.prohibitedIndustries ?? lender.prohibitedIndustries ?? [];
  const restrictedIndustries = programEligibilityRule?.restrictedIndustries ?? lender.restrictedIndustries ?? [];
  const acceptedIndustries = lender.acceptedIndustries ?? [];
  if ((prohibitedIndustries.length > 0 || restrictedIndustries.length > 0 || acceptedIndustries.length > 0)
    && (!industry || /^other$/i.test(industry.trim()))) {
    breakdown.push({
      criterion: "Industry Classification",
      passed: false,
      detail: "A specific industry is required for lender industry-rule evaluation",
    });
  }
  if (industry && prohibitedIndustries.length > 0) {
    const prohibited = prohibitedIndustries.find((criterion) => industryMatches(industry, criterion));
    breakdown.push({
      criterion: "Prohibited Industry",
      passed: !prohibited,
      detail: prohibited
        ? `Industry "${industry}" matches prohibited industry "${prohibited}"`
        : `Industry "${industry}" is not prohibited`,
    });
  }

  if (industry && restrictedIndustries.length > 0) {
    const restricted = restrictedIndustries.find((criterion) => industryMatches(industry, criterion));
    const truckingRules = programEligibilityRule?.truckingRules ?? lender.truckingRules ?? [];
    const hasTruckingException = Boolean(restricted && isTransportationIndustry(industry)
      && truckingRules.some((rule) => truckingRuleApplies(rule, industry)));
    if (restricted && !hasTruckingException) {
      const exceptionFloor = programEligibilityRule?.restrictedIndustryMinMonthlyRevenue
        ?? lender.restrictedIndustryMinMonthlyRevenue;
      const passed = exceptionFloor != null && monthlyRevenue != null && monthlyRevenue >= exceptionFloor;
      breakdown.push({
        criterion: "Restricted Industry",
        passed,
        detail: passed
          ? `Industry "${industry}" meets its $${exceptionFloor!.toLocaleString()} monthly-revenue exception`
          : exceptionFloor != null && monthlyRevenue == null
            ? `Industry "${industry}" requires $${exceptionFloor.toLocaleString()} monthly revenue`
            : exceptionFloor != null
              ? `Industry "${industry}" is below its $${exceptionFloor.toLocaleString()} monthly-revenue exception`
              : `Industry "${industry}" is restricted without a stated structural exception`,
      });
    }
  }

  const truckingRules = programEligibilityRule?.truckingRules ?? lender.truckingRules ?? [];
  if (industry && isTransportationIndustry(industry) && truckingRules.length > 0) {
    const rules = truckingRules.filter((rule) => truckingRuleApplies(rule, industry));
    for (const rule of rules) {
      if (rule.prohibited) {
        breakdown.push({
          criterion: "Trucking Industry",
          passed: false,
          detail: `Industry "${industry}" is prohibited for this trucking rule`,
        });
        continue;
      }
      if (rule.minTrucks != null) {
        const trucksInFleet = application?.trucksInFleet ?? null;
        const passed = trucksInFleet != null && trucksInFleet >= rule.minTrucks;
        breakdown.push({
          criterion: "Trucking Fleet",
          passed,
          detail: passed
            ? `${trucksInFleet} trucks meets minimum fleet of ${rule.minTrucks}`
            : trucksInFleet == null
              ? `Trucks in fleet is required (minimum ${rule.minTrucks})`
              : `${trucksInFleet} trucks is below minimum fleet of ${rule.minTrucks}`,
        });
      }
      if (rule.minTimeInBusinessMonths != null) {
        const passed = timeInBusinessMonths != null && timeInBusinessMonths >= rule.minTimeInBusinessMonths;
        breakdown.push({
          criterion: "Trucking Time in Business",
          passed,
          detail: passed
            ? `${timeInBusinessMonths} months meets trucking minimum ${rule.minTimeInBusinessMonths} months`
            : timeInBusinessMonths == null
              ? `Time in business is required (minimum ${rule.minTimeInBusinessMonths} months)`
              : `${timeInBusinessMonths} months is below trucking minimum ${rule.minTimeInBusinessMonths} months`,
        });
      }
      if (rule.requiresNoFactoring) {
        const passed = application?.hasFactoring === false;
        breakdown.push({
          criterion: "Trucking Factoring",
          passed,
          detail: passed
            ? "No factoring is reported"
            : application?.hasFactoring == null
              ? "Factoring status is required"
              : "Factoring is reported",
        });
      }
    }
  }

  if (industry && (lender.industryTimeInBusinessOverrides?.length ?? 0) > 0) {
    for (const override of lender.industryTimeInBusinessOverrides!) {
      if (!industryMatches(industry, override.industry)) continue;
      const passed = timeInBusinessMonths != null
        && timeInBusinessMonths >= override.minTimeInBusinessMonths;
      breakdown.push({
        criterion: "Industry Time in Business",
        passed,
        detail: passed
          ? `${timeInBusinessMonths} months meets ${override.industry} minimum ${override.minTimeInBusinessMonths} months`
          : timeInBusinessMonths == null
            ? `${override.industry} requires ${override.minTimeInBusinessMonths} months in business`
            : `${timeInBusinessMonths} months is below ${override.industry} minimum ${override.minTimeInBusinessMonths} months`,
      });
    }
  }

  if (acceptedIndustries.length > 0 && industry) {
    const passed = acceptedIndustries.some(
      (ind) => industryMatches(industry, ind),
    );
    breakdown.push({
      criterion: "Industry",
      passed,
      detail: passed
        ? `Industry "${industry}" is accepted`
        : `Industry "${industry}" not in accepted list [${acceptedIndustries.join(", ")}]`,
    });
  }

  const minMonths = lender.minTimeInBusinessMonths ?? 0;
  if (minMonths > 0) {
    const passed = timeInBusinessMonths != null && timeInBusinessMonths >= minMonths;
    breakdown.push({
      criterion: "Time in Business",
      passed,
      detail: passed
        ? `${timeInBusinessMonths} months meets minimum ${minMonths} months`
        : timeInBusinessMonths == null
          ? `Time in business is required (minimum ${minMonths} months)`
          : `${timeInBusinessMonths} months is below minimum ${minMonths} months`,
    });
  }

  const acceptedStates = lender.acceptedStates ?? [];
  if (acceptedStates.length > 0) {
    const businessState = company?.state ?? application?.businessState ?? lead.businessState ?? null;
    const passed = businessState != null && acceptedStates.some(
      (state) => state.toUpperCase() === businessState.toUpperCase(),
    );
    breakdown.push({
      criterion: "State",
      passed,
      detail: passed
        ? `State "${businessState}" is accepted`
        : businessState == null
          ? "Business state is required for lender state eligibility"
          : `State "${businessState}" not in accepted states [${acceptedStates.join(", ")}]`,
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