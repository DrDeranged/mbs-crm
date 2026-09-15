import { getUserDisplayName } from "./authHelpers";

export const dealCsvHeaders = [
  "Deal",
  "Stage",
  "Amount",
  "Approx GM",
  "Actual GM",
  "Notes",
  "gmSplitPct",
  "Assigned Rep",
  "Last Activity",
  "Created At",
  "Updated At",
  "Funded At",
  "Archived",
] as const;

type CsvDeal = {
  dealName: string;
  stage: string;
  amount: number | null;
  approxGm: number | null;
  actualGm: number | null;
  notes: string | null;
  gmSplitPct: number | null;
  assignedUser?: Parameters<typeof getUserDisplayName>[0] | null;
  createdAt: Date;
  updatedAt: Date;
  fundedAt: Date | null;
  isArchived: boolean;
};

export function dealCsvRow(deal: CsvDeal, activityAt?: Date | null) {
  return [
    deal.dealName,
    deal.stage,
    deal.amount,
    deal.approxGm,
    deal.actualGm,
    deal.notes ?? "",
    deal.gmSplitPct ?? 100,
    deal.assignedUser ? getUserDisplayName(deal.assignedUser as any) : "",
    activityAt?.toISOString() ?? "",
    deal.createdAt.toISOString(),
    deal.updatedAt.toISOString(),
    deal.fundedAt?.toISOString() ?? "",
    deal.isArchived ? "Yes" : "No",
  ];
}