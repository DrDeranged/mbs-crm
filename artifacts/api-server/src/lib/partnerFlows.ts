export type PartnerType = "direct_lender" | "broker_out" | "broker_in";

export function partnerMatchGroup(partnerType: PartnerType): "lender" | "super_broker" {
  return partnerType === "broker_out" ? "super_broker" : "lender";
}

export function netGmAfterReferralSplit(grossGm: number, referralSplitPct: number | null | undefined): {
  grossGm: number;
  referralAmount: number;
  netGm: number;
} {
  const pct = Math.max(0, Math.min(100, Number(referralSplitPct ?? 0)));
  const referralAmount = Math.round(grossGm * pct) / 100;
  return { grossGm, referralAmount, netGm: grossGm - referralAmount };
}