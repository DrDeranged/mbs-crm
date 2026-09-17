import type { Deal } from "@workspace/api-client-react";

export const DEAL_STAGE_COLUMNS = [
  {
    id: "waiting_on_app",
    label: "Waiting on App",
    color: "bg-gray-100 text-gray-700",
  },
  {
    id: "information_needed",
    label: "Info Needed",
    color: "bg-orange-100 text-orange-700",
  },
  {
    id: "submitted",
    label: "Submitted",
    color: "bg-blue-100 text-blue-700",
  },
  {
    id: "approved",
    label: "Approved",
    color: "bg-green-100 text-green-700",
  },
  {
    id: "in_funding",
    label: "In Funding",
    color: "bg-indigo-100 text-indigo-700",
  },
  {
    id: "funded",
    label: "Funded",
    color: "bg-[#17A567]/10 text-[#149258]",
  },
  {
    id: "hold_on",
    label: "Hold On",
    color: "bg-yellow-100 text-yellow-700",
  },
  {
    id: "declined",
    label: "Declined",
    color: "bg-red-100 text-red-700",
  },
  {
    id: "dead",
    label: "Dead",
    color: "bg-slate-100 text-slate-700",
  },
] as const satisfies ReadonlyArray<{
  id: Deal["stage"];
  label: string;
  color: string;
}>;

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
