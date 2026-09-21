export type Provenance = {
  source: "application" | "lead" | "company" | "bank_statement" | "document" | "user_correction";
  sourceId?: number;
  label: string;
  confidence: "verified" | "reported" | "extracted" | "corrected";
};

export type UnderwritingFact = {
  key: string;
  label: string;
  value: unknown;
  provenance: Provenance;
  estimated?: boolean;
};

export type HistoricalSignal = {
  submitted: number;
  approved: number;
  declined: number;
  funded: number;
  approvalRate: number | null;
  fundingRate: number | null;
};

export type RankingDimensions = {
  approvalProbability: number;
  customerPricing: number | null;
  fundingSpeed: number | null;
  mbsPayout: number | null;
  documentationBurden: number;
  overallStructure: number;
};

export function resolveRevenueFact(input: {
  averageMonthlyDeposits: number | null;
  bankSources: Array<{ id: number; documentId?: number | null }>;
  applicationRevenue: number | string | null | undefined;
  applicationId?: number;
}) {
  if (input.averageMonthlyDeposits != null && input.bankSources.length > 0) {
    const sourceIds = input.bankSources.map((row) => row.documentId ?? row.id);
    return {
      value: input.averageMonthlyDeposits,
      estimated: false,
      provenance: {
        source: "bank_statement" as const,
        sourceId: sourceIds[0],
        sourceIds,
        label: `Average deposits from ${input.bankSources.length} extracted bank statement${input.bankSources.length === 1 ? "" : "s"}`,
        confidence: "extracted" as const,
      },
    };
  }
  return {
    value: input.applicationRevenue ?? null,
    estimated: false,
    provenance: {
      source: "application" as const,
      sourceId: input.applicationId,
      sourceIds: input.applicationId == null ? [] : [input.applicationId],
      label: "Submitted application",
      confidence: "reported" as const,
    },
  };
}

export function historicalSignal(statuses: string[]): HistoricalSignal {
  const approved = statuses.filter((status) => status === "approved" || status === "funded").length;
  const declined = statuses.filter((status) => status === "declined").length;
  const funded = statuses.filter((status) => status === "funded").length;
  const decisions = approved + declined;
  return {
    submitted: statuses.length,
    approved,
    declined,
    funded,
    approvalRate: decisions ? Math.round((approved / decisions) * 100) : null,
    fundingRate: statuses.length ? Math.round((funded / statuses.length) * 100) : null,
  };
}

export function rankDimensions(input: {
  matchScore: number;
  history: HistoricalSignal;
  pricing?: { minRatePct?: number; maxRatePct?: number; minFactorRate?: number; maxFactorRate?: number; structures?: string[] } | null;
  turnaroundMin?: number | null;
  turnaroundMax?: number | null;
  compensation?: { min?: number; max?: number; flatAmount?: number } | null;
  requiredDocuments?: string[];
  maxAdvancePct?: number | null;
  minDownPaymentPct?: number | null;
}): RankingDimensions {
  const historyWeight = Math.min(input.history.submitted, 20) / 20;
  const historyRate = input.history.approvalRate ?? input.matchScore;
  const approvalProbability = Math.round(input.matchScore * (1 - historyWeight * 0.25) + historyRate * historyWeight * 0.25);
  const highPrice = input.pricing?.maxRatePct ?? input.pricing?.minRatePct
    ?? (input.pricing?.maxFactorRate != null ? (input.pricing.maxFactorRate - 1) * 100 : undefined)
    ?? (input.pricing?.minFactorRate != null ? (input.pricing.minFactorRate - 1) * 100 : undefined);
  const customerPricing = highPrice == null ? null : Math.max(0, Math.min(100, Math.round(100 - highPrice * 2)));
  const turnaround = input.turnaroundMax ?? input.turnaroundMin;
  const fundingSpeed = turnaround == null ? null : Math.max(0, Math.min(100, 100 - Math.max(0, turnaround - 1) * 10));
  const payout = input.compensation?.max ?? input.compensation?.min ?? input.compensation?.flatAmount;
  const mbsPayout = payout == null ? null : Math.max(0, Math.min(100, Math.round(payout)));
  const documentationBurden = Math.max(0, 100 - (input.requiredDocuments?.length ?? 0) * 12);
  const overallStructure = Math.round([
    input.maxAdvancePct ?? 50,
    input.minDownPaymentPct == null ? 50 : Math.max(0, 100 - input.minDownPaymentPct * 2),
    input.pricing?.structures?.length ? 70 : 50,
  ].reduce((sum, value) => sum + value, 0) / 3);
  return { approvalProbability, customerPricing, fundingSpeed, mbsPayout, documentationBurden, overallStructure };
}

export function rankingValue(dimensions: RankingDimensions, perspective: keyof RankingDimensions): number {
  return dimensions[perspective] ?? -1;
}