import type { LeadListResponse } from "@workspace/api-client-react";

export const DESKTOP_LEADS_BATCH_SIZE = 50;

export function nextLeadPage(page: number, totalPages: number): number | undefined {
  return Number.isInteger(totalPages) && page < totalPages ? page + 1 : undefined;
}

/** Keep loaded order stable if records move between server pages during updates. */
export function mergeLeadPages(pages: LeadListResponse[]): LeadListResponse | undefined {
  if (!pages.length) return undefined;
  const unique = new Map<number, LeadListResponse["leads"][number]>();
  for (const page of pages) for (const lead of page.leads) {
    if (!unique.has(lead.id)) unique.set(lead.id, lead);
  }
  return { ...pages[0], leads: [...unique.values()] };
}
