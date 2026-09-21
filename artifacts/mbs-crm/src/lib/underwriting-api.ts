import { useMutation, useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";

export type UnderwritingFact = {
  key: string;
  label: string;
  value: unknown;
  estimated?: boolean;
  provenance: { source: string; sourceId?: number; label: string; confidence: string };
};

export type UnderwritingProfile = {
  leadId: number;
  applicationId: number | null;
  applicationType: string;
  facts: UnderwritingFact[];
  bank: null | {
    monthsAnalyzed: number;
    averageMonthlyDeposits: number | null;
    averageDailyBalance: number | null;
    nsfCount: number;
    negativeBalanceDays: number;
    returnedItems: number;
    overdrafts: number;
    positions: unknown[];
  };
  documents: Array<{ id: number; category: string; label: string | null; filename: string }>;
  readiness: { readyForMatching: boolean; missingFields: string[]; requiresHumanReview: boolean };
  corrections: Array<{ id: number; field: string; value: unknown; reason: string; createdAt: string }>;
};

export const underwritingProfileKey = (leadId: number) => ["/api/leads", leadId, "underwriting-profile"] as const;

export function useUnderwritingProfile(leadId: number) {
  return useQuery({
    queryKey: underwritingProfileKey(leadId),
    queryFn: ({ signal }) => customFetch<UnderwritingProfile>(`/api/leads/${leadId}/underwriting-profile`, { signal }),
    enabled: leadId > 0,
  });
}

export function useCreateUnderwritingCorrection() {
  return useMutation({
    mutationFn: ({ leadId, data }: {
      leadId: number;
      data: { field: string; value: string | number | boolean | null; reason: string; evidenceDocumentId?: number | null };
    }) => customFetch(`/api/leads/${leadId}/underwriting-corrections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  });
}