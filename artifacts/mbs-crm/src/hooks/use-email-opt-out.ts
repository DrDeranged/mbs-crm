import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getApiBaseUrl } from "@/lib/apiBase";

export type EmailOptOutInput = { isUnsubscribed: boolean; reason: string };

async function post(path: string, body: unknown): Promise<{ updated: number }> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? data?.message ?? `Request failed (${res.status})`);
  return data;
}

/** Invalidate every query that may show a lead's unsubscribe state. */
function invalidateLeadQueries(qc: ReturnType<typeof useQueryClient>) {
  return qc.invalidateQueries({
    predicate: (q) => {
      const k = String(q.queryKey?.[0] ?? "");
      return k.includes("/leads") || k.includes("activity") || k.includes("compliance") || k.includes("consent");
    },
  });
}

export function useSetLeadEmailOptOut(leadId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EmailOptOutInput) => post(`/leads/${leadId}/email-opt-out`, { ...input, reason: input.reason.trim() }),
    onSuccess: () => invalidateLeadQueries(qc),
  });
}

export function useBulkEmailOptOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EmailOptOutInput & { ids: number[] }) => post(`/leads/bulk/email-opt-out`, { ...input, reason: input.reason.trim() }),
    onSuccess: () => invalidateLeadQueries(qc),
  });
}
