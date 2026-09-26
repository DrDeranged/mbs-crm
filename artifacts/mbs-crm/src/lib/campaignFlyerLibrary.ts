import { getApiBaseUrl, resolveApiUrl } from "./apiBase.ts";

export const FLYER_CATEGORIES = [
  ["equipment_financing", "Equipment financing"],
  ["working_capital", "Working capital"],
] as const;
export const FLYER_VERTICALS = [
  ["yellow_iron", "Yellow iron"],
  ["trucking", "Trucking"],
  ["restaurants", "Restaurants"],
  ["amusement", "Amusement"],
  ["general", "General"],
] as const;
export const FLYER_AUDIENCES = [
  ["end_user", "End user"],
  ["vendor", "Vendor"],
] as const;

export type FlyerCategory = (typeof FLYER_CATEGORIES)[number][0];
export type FlyerVertical = (typeof FLYER_VERTICALS)[number][0];
export type FlyerAudience = (typeof FLYER_AUDIENCES)[number][0];
export type FlyerFilters = {
  category?: FlyerCategory;
  vertical?: FlyerVertical;
  audience?: FlyerAudience;
  repId?: number;
};
export type CampaignLibraryFlyer = {
  templateId: number;
  objectPath: string;
  name: string;
  contentType: "image/png" | "application/pdf";
  size: number;
  category: FlyerCategory;
  vertical: FlyerVertical;
  audience: FlyerAudience;
  repId?: number | null;
};
export type FlyerUploadFile = { originalFilename: string; size: number; contentType: "image/png" | "application/pdf" };
export type FlyerUploadSlot = FlyerUploadFile & { index: number; uploadUrl: string; objectPath: string };
export type FlyerRegistration = {
  objectPath: string;
  name: string;
  originalFilename: string;
  category: FlyerCategory;
  vertical: FlyerVertical;
  audience: FlyerAudience;
  repId?: number;
};

export function normalizeFlyerLabel(value: string): string {
  return value.replace(/Rahmare/gi, "Ray Davis");
}

async function requestJson<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, { credentials: "include", ...options });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = body && typeof body === "object" ? body as { error?: string; message?: string } : null;
    throw new Error(error?.error || error?.message || `Request failed (${response.status})`);
  }
  return body as T;
}

export function listCampaignLibraryFlyers(filters: FlyerFilters = {}): Promise<CampaignLibraryFlyer[]> {
  const query = new URLSearchParams();
  if (filters.category) query.set("category", filters.category);
  if (filters.vertical) query.set("vertical", filters.vertical);
  if (filters.audience) query.set("audience", filters.audience);
  if (filters.repId !== undefined) query.set("repId", String(filters.repId));
  return requestJson<CampaignLibraryFlyer[]>(`/collateral/flyers${query.size ? `?${query}` : ""}`).then((items) => {
    if (!Array.isArray(items)) throw new Error("The flyer library returned an unexpected response.");
    return items.map((item) => ({ ...item, name: normalizeFlyerLabel(item.name) }));
  });
}

export function requestFlyerUploadUrls(files: FlyerUploadFile[]): Promise<{ uploads: FlyerUploadSlot[] }> {
  if (files.length < 1 || files.length > 50) throw new Error("Select between 1 and 50 flyers.");
  return requestJson("/collateral/flyers/upload-urls", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files }),
  });
}

export async function putFlyerBytes(slot: FlyerUploadSlot, file: File): Promise<void> {
  const response = await fetch(resolveApiUrl(slot.uploadUrl), {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!response.ok) throw new Error(`Storage upload failed (${response.status})`);
}

export function registerCampaignLibraryFlyers(items: FlyerRegistration[]): Promise<{ templates: CampaignLibraryFlyer[] }> {
  return requestJson("/collateral/flyers/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: items.map((item) => ({ ...item, name: normalizeFlyerLabel(item.name) })) }),
  });
}

export async function getCampaignLibraryFlyerPublicUrl(templateId: number): Promise<string> {
  const result = await requestJson<{ url?: string; publicUrl?: string }>(`/collateral/flyers/${templateId}/public-url`);
  const url = result.url || result.publicUrl;
  if (!url) throw new Error("No flyer URL was returned.");
  return resolveApiUrl(url);
}