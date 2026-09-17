import { parseNullableCurrency } from "./forms.ts";

export interface LenderFormData {
  name: string;
  partnerType: "direct_lender" | "broker_out" | "broker_in";
  referralSplitPct: string;
  requiresFinancialStatements: boolean;
  programTypes: string[];
  minAmount: string;
  maxAmount: string;
  minCreditScore: string;
  acceptedIndustries: string;
  restrictedIndustries: string;
  prohibitedIndustries: string;
  minMonthlyRevenue: string;
  minTimeInBusinessMonths: string;
  acceptedStates: string[];
  maxExistingPositions: string;
  priorityWeight: string;
  notes: string;
  isActive: boolean;
}

export const emptyForm = (): LenderFormData => ({
  name: "",
  partnerType: "direct_lender",
  referralSplitPct: "",
  requiresFinancialStatements: false,
  programTypes: [],
  minAmount: "",
  maxAmount: "",
  minCreditScore: "",
  acceptedIndustries: "",
  restrictedIndustries: "",
  prohibitedIndustries: "",
  minMonthlyRevenue: "",
  minTimeInBusinessMonths: "",
  acceptedStates: [],
  maxExistingPositions: "10",
  priorityWeight: "5",
  notes: "",
  isActive: true,
});

export function lenderToForm(l: any): LenderFormData {
  return {
    name: l.name ?? "",
    partnerType: l.partnerType ?? "direct_lender",
    referralSplitPct: l.referralSplitPct != null ? String(l.referralSplitPct) : "",
    requiresFinancialStatements: l.requiresFinancialStatements ?? false,
    programTypes: l.programTypes ?? [],
    minAmount: l.minAmount != null ? String(l.minAmount) : "",
    maxAmount: l.maxAmount != null ? String(l.maxAmount) : "",
    minCreditScore: l.minCreditScore != null ? String(l.minCreditScore) : "",
    acceptedIndustries: (l.acceptedIndustries ?? []).join(", "),
    restrictedIndustries: (l.restrictedIndustries ?? []).join(", "),
    prohibitedIndustries: (l.prohibitedIndustries ?? []).join(", "),
    minMonthlyRevenue: l.minMonthlyRevenue != null ? String(l.minMonthlyRevenue) : "",
    minTimeInBusinessMonths: String(l.minTimeInBusinessMonths ?? 0),
    acceptedStates: l.acceptedStates ?? [],
    maxExistingPositions: String(l.maxExistingPositions ?? 10),
    priorityWeight: String(l.priorityWeight ?? 5),
    notes: l.notes ?? "",
    isActive: l.isActive ?? true,
  };
}

export function formToPayload(f: LenderFormData) {
  return {
    name: f.name,
    partnerType: f.partnerType,
    referralSplitPct: f.partnerType === "broker_in" && f.referralSplitPct ? Number(f.referralSplitPct) : null,
    requiresFinancialStatements: f.requiresFinancialStatements,
    programTypes: f.programTypes,
    minAmount: parseNullableCurrency(f.minAmount),
    maxAmount: parseNullableCurrency(f.maxAmount),
    minCreditScore: f.minCreditScore ? parseInt(f.minCreditScore, 10) : null,
    acceptedIndustries: f.acceptedIndustries
      ? f.acceptedIndustries.split(",").map((s) => s.trim()).filter(Boolean)
      : [],
    restrictedIndustries: f.restrictedIndustries
      ? f.restrictedIndustries.split(",").map((s) => s.trim()).filter(Boolean)
      : [],
    prohibitedIndustries: f.prohibitedIndustries
      ? f.prohibitedIndustries.split(",").map((s) => s.trim()).filter(Boolean)
      : [],
    minMonthlyRevenue: f.minMonthlyRevenue ? parseInt(f.minMonthlyRevenue, 10) : null,
    minTimeInBusinessMonths: f.minTimeInBusinessMonths ? parseInt(f.minTimeInBusinessMonths, 10) : null,
    acceptedStates: f.acceptedStates,
    maxExistingPositions: parseInt(f.maxExistingPositions, 10) || 10,
    priorityWeight: Math.max(1, Math.min(10, parseInt(f.priorityWeight, 10) || 5)),
    notes: f.notes || null,
    isActive: f.isActive,
  };
}