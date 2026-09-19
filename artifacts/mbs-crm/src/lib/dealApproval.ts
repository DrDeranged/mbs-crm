export type DealApprovalForPrefill = {
  advance: number;
  payment: number;
  term: number;
};

export type CalculatorPrefill = {
  amount: string;
  payment: string;
  term: string;
};

export function latestApproval<T extends { createdAt: string; id: number }>(
  approvals: T[] | undefined,
): T | null {
  if (!approvals?.length) return null;
  return [...approvals].sort((a, b) => {
    const created = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    return created || b.id - a.id;
  })[0] ?? null;
}

export function approvalToCalculatorPrefill(
  approval: DealApprovalForPrefill | null | undefined,
): CalculatorPrefill | null {
  if (!approval) return null;
  return {
    amount: String(approval.advance),
    payment: String(approval.payment),
    term: String(approval.term),
  };
}

export function approvalDaysUntil(expiry: string, today = new Date()): number {
  const expiryUtc = Date.parse(`${expiry}T00:00:00Z`);
  const todayUtc = Date.parse(`${today.toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.ceil((expiryUtc - todayUtc) / 86_400_000);
}