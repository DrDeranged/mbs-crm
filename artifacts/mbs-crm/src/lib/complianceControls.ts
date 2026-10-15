export const OPT_OUT_REASON_MAX = 2000;

/** A task deadline is a calendar date, not midnight in the browser's timezone. */
export function taskDueDateLabel(due?: string | null): string {
  if (!due) return "No due date";
  const date = new Date(`${due.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return due;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  }).format(date);
}

export function validateOptOutReason(reason: string): string | null {
  const trimmed = reason.trim();
  if (!trimmed) return "A reason is required.";
  if (trimmed.length > OPT_OUT_REASON_MAX) return `Reason must be ${OPT_OUT_REASON_MAX} characters or fewer.`;
  return null;
}

export type TaskFilter = "all" | "overdue" | "today" | "upcoming";
export const TASK_FILTERS: { value: TaskFilter; label: string }[] = [
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Due today" },
  { value: "upcoming", label: "Upcoming" },
  { value: "all", label: "All open" },
];

export function parseTaskFilter(search: string): TaskFilter {
  const raw = new URLSearchParams(search).get("filter");
  return raw === "overdue" || raw === "today" || raw === "upcoming" || raw === "all" ? raw : "all";
}

export function normalizeLeadIdList(ids: unknown): number[] {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))];
}

export function toggleExcludedLead(ids: number[], leadId: number): number[] {
  return ids.includes(leadId) ? ids.filter((id) => id !== leadId) : [...ids, leadId];
}

export const EXCLUSION_REASON_LABELS: Record<string, string> = {
  excluded_manually: "Excluded manually",
  excludedManually: "Excluded manually",
};

export function exclusionReasonLabel(reason: string | null | undefined): string {
  if (!reason) return "Other exclusion";
  return EXCLUSION_REASON_LABELS[reason] ?? reason.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export const CAMPAIGN_LIVE_POLL_MS = 15_000;
export function campaignPollInterval(status: string | null | undefined): number | false {
  return status === "running" || status === "paused" ? CAMPAIGN_LIVE_POLL_MS : false;
}
