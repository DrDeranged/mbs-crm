import type { CampaignMetrics } from "@workspace/api-client-react";
export type MetricsLike = Pick<CampaignMetrics, "sent" | "delivered" | "deliveredPct" | "bounced" | "blocked" |
  "opensApproximate" | "uniqueFlyerClicks" | "totalFlyerClicks" | "firstClickAt" | "replies" | "calls" |
  "referredLeads" | "submitted" | "approved" | "funded" | "fundedDollars" | "mbsPoints">;

/** null means "not tracked historically", which must never render as zero. */
export const NOT_TRACKED = "Not tracked";

export function formatTracked(value: number | null | undefined): string {
  return value == null ? NOT_TRACKED : value.toLocaleString("en-US");
}
export function formatPct(value: number | null | undefined): string {
  return value == null ? "—" : `${value.toFixed(1)}%`;
}
export function formatMoney(value: number | null): string {
  return value == null ? NOT_TRACKED : value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export type MetricRow = { key: string; label: string; format: (m: MetricsLike) => string; note?: string };

export const METRIC_ROWS: MetricRow[] = [
  { key: "sent", label: "Sent", format: (m) => formatTracked(m.sent) },
  { key: "delivered", label: "Delivered %", format: (m) => formatPct(m.deliveredPct), note: "Delivered email ÷ accepted email sends" },
  { key: "bounced", label: "Bounced", format: (m) => formatTracked(m.bounced) },
  { key: "blocked", label: "Blocked", format: (m) => formatTracked(m.blocked) },
  { key: "opens", label: "Opens (approximate)", format: (m) => formatTracked(m.opensApproximate), note: "Mail apps may preload images" },
  { key: "uniqueClicks", label: "Unique flyer clicks", format: (m) => formatTracked(m.uniqueFlyerClicks) },
  { key: "totalClicks", label: "Total flyer clicks", format: (m) => formatTracked(m.totalFlyerClicks) },
  { key: "firstClick", label: "First click", format: (m) => m.firstClickAt ? new Date(m.firstClickAt).toLocaleString() : "—" },
  { key: "replies", label: "Replies", format: (m) => formatTracked(m.replies) },
  { key: "calls", label: "Calls", format: (m) => formatTracked(m.calls) },
  { key: "referred", label: "Referred leads", format: (m) => formatTracked(m.referredLeads) },
  { key: "submitted", label: "Submitted", format: (m) => formatTracked(m.submitted) },
  { key: "approved", label: "Approved", format: (m) => formatTracked(m.approved) },
  { key: "funded", label: "Funded", format: (m) => formatTracked(m.funded) },
  { key: "dollars", label: "$ funded (referred deals)", format: (m) => formatMoney(m.fundedDollars) },
  { key: "points", label: "MBS points (referred deals)", format: (m) => m.mbsPoints == null ? NOT_TRACKED : m.mbsPoints.toLocaleString("en-US", { maximumFractionDigits: 2 }) },
];

export const DEFAULT_DEFINITIONS = [
  "Delivered % uses delivered email ÷ accepted email sends; SMS is not in this denominator.",
  "Opens are approximate; they are not verified human engagement.",
  "Attribution is 30-day last-touch; unique clicks count leads, total counts every click.",
  "$ funded and MBS points cover referred deals only.",
];

/** Encodes a referrer for form/select values. */
export const referrerKey = (r: { type: "lead" | "partner"; id: number }) => `${r.type}:${r.id}`;

export function referrerPayload(r: { type: "lead" | "partner"; id: number } | null) {
  return {
    referredByLeadId: r?.type === "lead" ? r.id : null,
    referredByPartnerId: r?.type === "partner" ? r.id : null,
  };
}
export function referralFromIds(leadId?: number | null, partnerId?: number | null) {
  if (leadId) return { type: "lead" as const, id: leadId };
  if (partnerId) return { type: "partner" as const, id: partnerId };
  return null;
}
