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
  guidelineVersion: string;
  guidelineSource: string;
  guidelineEffectiveAt: string;
  equipmentRestrictions: string;
  pricingMin: string;
  pricingMax: string;
  structures: string;
  termMonths: string;
  maxAdvancePct: string;
  minDownPaymentPct: string;
  requiredDocuments: string;
  turnaroundMin: string;
  turnaroundMax: string;
  compensationType: "points" | "percent" | "flat";
  compensationMin: string;
  compensationMax: string;
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
  guidelineVersion: "1",
  guidelineSource: "",
  guidelineEffectiveAt: "",
  equipmentRestrictions: "",
  pricingMin: "",
  pricingMax: "",
  structures: "",
  termMonths: "",
  maxAdvancePct: "",
  minDownPaymentPct: "",
  requiredDocuments: "",
  turnaroundMin: "",
  turnaroundMax: "",
  compensationType: "points",
  compensationMin: "",
  compensationMax: "",
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
    guidelineVersion: String(l.guidelineVersion ?? 1),
    guidelineSource: l.guidelineSource ?? "",
    guidelineEffectiveAt: l.guidelineEffectiveAt?.slice(0, 10) ?? "",
    equipmentRestrictions: (l.equipmentRestrictions ?? []).join(", "),
    pricingMin: l.pricing?.minRatePct != null ? String(l.pricing.minRatePct) : "",
    pricingMax: l.pricing?.maxRatePct != null ? String(l.pricing.maxRatePct) : "",
    structures: (l.pricing?.structures ?? []).join(", "),
    termMonths: (l.pricing?.termMonths ?? []).join(", "),
    maxAdvancePct: l.pricing?.maxAdvancePct != null ? String(l.pricing.maxAdvancePct) : "",
    minDownPaymentPct: l.pricing?.minDownPaymentPct != null ? String(l.pricing.minDownPaymentPct) : "",
    requiredDocuments: (l.requiredDocuments ?? []).join(", "),
    turnaroundMin: l.turnaroundBusinessDaysMin != null ? String(l.turnaroundBusinessDaysMin) : "",
    turnaroundMax: l.turnaroundBusinessDaysMax != null ? String(l.turnaroundBusinessDaysMax) : "",
    compensationType: l.compensation?.type ?? "points",
    compensationMin: l.compensation?.min != null ? String(l.compensation.min) : l.compensation?.flatAmount != null ? String(l.compensation.flatAmount) : "",
    compensationMax: l.compensation?.max != null ? String(l.compensation.max) : "",
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
    guidelineVersion: Math.max(1, parseInt(f.guidelineVersion, 10) || 1),
    guidelineSource: f.guidelineSource || null,
    guidelineEffectiveAt: f.guidelineEffectiveAt ? new Date(`${f.guidelineEffectiveAt}T12:00:00Z`).toISOString() : null,
    equipmentRestrictions: f.equipmentRestrictions.split(",").map((s) => s.trim()).filter(Boolean),
    pricing: (f.pricingMin || f.pricingMax || f.structures || f.termMonths || f.maxAdvancePct || f.minDownPaymentPct) ? {
      ...(f.pricingMin ? { minRatePct: Number(f.pricingMin) } : {}),
      ...(f.pricingMax ? { maxRatePct: Number(f.pricingMax) } : {}),
      structures: f.structures.split(",").map((s) => s.trim()).filter(Boolean),
      termMonths: f.termMonths.split(",").map(Number).filter((n) => Number.isFinite(n) && n > 0),
      ...(f.maxAdvancePct ? { maxAdvancePct: Number(f.maxAdvancePct) } : {}),
      ...(f.minDownPaymentPct ? { minDownPaymentPct: Number(f.minDownPaymentPct) } : {}),
    } : null,
    requiredDocuments: f.requiredDocuments.split(",").map((s) => s.trim()).filter(Boolean),
    turnaroundBusinessDaysMin: f.turnaroundMin ? Number(f.turnaroundMin) : null,
    turnaroundBusinessDaysMax: f.turnaroundMax ? Number(f.turnaroundMax) : null,
    compensation: f.compensationMin || f.compensationMax ? {
      type: f.compensationType,
      ...(f.compensationType === "flat"
        ? { flatAmount: Number(f.compensationMin || 0) }
        : { min: Number(f.compensationMin || 0), max: Number(f.compensationMax || f.compensationMin || 0) }),
    } : null,
  };
}