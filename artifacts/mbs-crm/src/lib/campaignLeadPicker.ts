import { getApiBaseUrl, resolveApiUrl } from "./apiBase.ts";

export const MAX_CAMPAIGN_PICKED_LEADS = 1000;
export const CAMPAIGN_LEAD_PICKER_PAGE_SIZE = 50;

export type CampaignPickerLead = {
  id: number;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  email: string | null;
  leadSource: string | null;
};

export type CampaignLeadPickerPage = {
  leads: CampaignPickerLead[];
  total: number;
  page: number;
  limit: number;
};

function endpoint(path: string) {
  return resolveApiUrl(path, getApiBaseUrl());
}

async function responsePayload(response: Response): Promise<any> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || `Lead picker request failed (${response.status})`);
  }
  return payload;
}

export async function searchCampaignLeads(search: string, page = 1, limit = CAMPAIGN_LEAD_PICKER_PAGE_SIZE): Promise<CampaignLeadPickerPage> {
  const params = new URLSearchParams({ search, page: String(page), limit: String(limit) });
  const payload = await responsePayload(await fetch(`${endpoint("/campaigns/lead-picker")}?${params}`, {
    credentials: "include",
  }));
  if (!Array.isArray(payload.leads) || typeof payload.total !== "number") {
    throw new Error("Lead picker returned an invalid search response.");
  }
  return payload as CampaignLeadPickerPage;
}

export async function resolveCampaignLeads(ids: number[]): Promise<CampaignPickerLead[]> {
  if (!ids.length) return [];
  const payload = await responsePayload(await fetch(endpoint("/campaigns/lead-picker/resolve"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  }));
  if (!Array.isArray(payload)) {
    throw new Error("Lead picker returned an invalid resolved-leads response.");
  }
  return payload as CampaignPickerLead[];
}

export function addCampaignLeadIds(currentIds: number[], addedIds: number[]): number[] {
  const merged = [...new Set([...currentIds, ...addedIds].map(Number).filter(Number.isInteger))];
  if (merged.length > MAX_CAMPAIGN_PICKED_LEADS) {
    throw new Error(`A campaign can include at most ${MAX_CAMPAIGN_PICKED_LEADS.toLocaleString()} manually picked leads.`);
  }
  return merged;
}

export function assertCampaignLeadResultCap(total: number): void {
  if (total > MAX_CAMPAIGN_PICKED_LEADS) {
    throw new Error(`This search returned ${total.toLocaleString()} leads. Refine the search to ${MAX_CAMPAIGN_PICKED_LEADS.toLocaleString()} results or fewer before selecting all.`);
  }
}