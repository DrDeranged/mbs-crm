import type { Deal } from "@workspace/api-client-react";

export const DEAL_STAGE_COLUMNS = [
  {
    id: "waiting_on_app",
    label: "Waiting on App",
    color: "bg-secondary text-foreground",
  },
  {
    id: "information_needed",
    label: "Info Needed",
    color: "bg-warning-bg text-warning",
  },
  {
    id: "submitted",
    label: "Submitted",
    color: "bg-info-bg text-info",
  },
  {
    id: "approved",
    label: "Approved",
    color: "bg-success-bg text-success",
  },
  {
    id: "in_funding",
    label: "In Funding",
    color: "bg-info-bg text-info",
  },
  {
    id: "funded",
    label: "Funded",
    color: "bg-primary/10 text-success",
  },
  {
    id: "hold_on",
    label: "Hold On",
    color: "bg-warning-bg text-warning",
  },
  {
    id: "declined",
    label: "Declined",
    color: "bg-danger-bg text-danger",
  },
  {
    id: "dead",
    label: "Dead",
    color: "bg-secondary text-foreground",
  },
] as const satisfies ReadonlyArray<{
  id: Deal["stage"];
  label: string;
  color: string;
}>;

export const KANBAN_COMPACT_BREAKPOINT = 1280;
export const KANBAN_COMPACT_COLUMN_MIN_WIDTH = 120;
export const KANBAN_COMPACT_GAP = 4;
export const KANBAN_COMPACT_SIDEBAR_WIDTH = 160;
export const KANBAN_FULL_SIDEBAR_BREAKPOINT = 1536;
export const KANBAN_FULL_SIDEBAR_WIDTH = 256;

export function kanbanCompactPreferenceKey(userId: number): string {
  return `mbs-crm:kanban-compact:${userId}`;
}

export function readKanbanCompactPreference(
  storage: { getItem(key: string): string | null },
  key: string,
): boolean {
  const stored = storage.getItem(key);
  if (stored === "false") return false;
  return true;
}

/** The minimum canvas needed for nine compact columns without horizontal overflow. */
export function compactKanbanRequiredWidth(
  columnCount = DEAL_STAGE_COLUMNS.length,
): number {
  return (
    columnCount * KANBAN_COMPACT_COLUMN_MIN_WIDTH +
    Math.max(0, columnCount - 1) * KANBAN_COMPACT_GAP
  );
}

export function compactKanbanAvailableWidth(viewportWidth: number): number {
  const sidebarWidth =
    viewportWidth >= KANBAN_FULL_SIDEBAR_BREAKPOINT
      ? KANBAN_FULL_SIDEBAR_WIDTH
      : viewportWidth >= KANBAN_COMPACT_BREAKPOINT
        ? KANBAN_COMPACT_SIDEBAR_WIDTH
        : KANBAN_FULL_SIDEBAR_WIDTH;
  return viewportWidth - sidebarWidth;
}

export function compactKanbanFits(viewportWidth: number): boolean {
  return compactKanbanAvailableWidth(viewportWidth) >= compactKanbanRequiredWidth();
}

export const DEAL_VIEW_STAGES = {
  all: undefined,
  fundedAndInFunding: ["funded", "in_funding"] as const,
  needsAction: ["waiting_on_app", "information_needed", "hold_on"] as const,
} as const;

export type DealView = keyof typeof DEAL_VIEW_STAGES;

export function stagesForDealView(
  view: DealView,
): readonly string[] | undefined {
  return DEAL_VIEW_STAGES[view];
}

/** The wire value used by the API's comma-separated multi-stage query filter. */
export function serializeDealViewStages(view: DealView): string | undefined {
  return stagesForDealView(view)?.join(",");
}

export function dealMatchesView(
  deal: Pick<Deal, "stage">,
  view: DealView,
): boolean {
  const stages = stagesForDealView(view);
  return !stages || stages.includes(deal.stage);
}

export function visibleDealTotals(
  deals: Array<Pick<Deal, "approxGm" | "actualGm">>,
) {
  return deals.reduce<{ approxGm: number; actualGm: number }>(
    (totals, deal) => ({
      approxGm: totals.approxGm + (deal.approxGm ?? 0),
      actualGm: totals.actualGm + (deal.actualGm ?? 0),
    }),
    { approxGm: 0, actualGm: 0 },
  );
}

export function formatGmDisplay(
  value: number | null | undefined,
  splitPct = 100,
): string {
  if (value == null) return "—";
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  })
    .format(value)
    .replace("K", "k");
  return splitPct < 100 ? `${formatted} · ${splitPct}%` : formatted;
}
