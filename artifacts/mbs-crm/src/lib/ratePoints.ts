export type PaymentTiming = "arrears" | "advance";
export type RatePointsMode = "spread" | "reverse";

export type RatePointsInput = {
  advance: number;
  payment: number;
  term: number;
  timing: PaymentTiming;
  buyNominalRate: number;
};

export type ScheduleRow = {
  period: number;
  openingBalance: number;
  payment: number;
  interest: number;
  principal: number;
  closingBalance: number;
};

export function parseDealRatePointsQuery(search: string): {
  dealId: number | null;
  advance: string;
  payment: string;
  term: string;
} {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const parsedDealId = Number(params.get("dealId"));
  return {
    dealId: Number.isInteger(parsedDealId) && parsedDealId > 0 ? parsedDealId : null,
    advance: params.get("advance") ?? "",
    payment: params.get("payment") ?? "",
    term: params.get("term") ?? "",
  };
}

const EPSILON = 1e-10;

function validate(input: RatePointsInput): boolean {
  return Number.isFinite(input.advance) && input.advance > 0 &&
    Number.isFinite(input.payment) && input.payment > 0 &&
    Number.isInteger(input.term) && input.term > 0 &&
    Number.isFinite(input.buyNominalRate) && input.buyNominalRate >= 0;
}

function presentValue(payment: number, rate: number, term: number, timing: PaymentTiming): number {
  let value = 0;
  for (let period = 0; period < term; period++) {
    const exponent = timing === "advance" ? period : period + 1;
    value += payment / Math.pow(1 + rate, exponent);
  }
  return value;
}

export function solveMonthlyRate(
  advance: number,
  payment: number,
  term: number,
  timing: PaymentTiming,
): number | null {
  if (!(advance > 0) || !(payment > 0) || !Number.isInteger(term) || term <= 0) return null;
  if (Math.abs(presentValue(payment, 0, term, timing) - advance) < EPSILON) return 0;
  if (presentValue(payment, 0, term, timing) < advance) return null;
  let low = 0;
  let high = 0.01;
  while (presentValue(payment, high, term, timing) > advance && high < 1e6) high *= 2;
  if (high >= 1e6) return null;
  for (let i = 0; i < 160; i++) {
    const middle = (low + high) / 2;
    if (presentValue(payment, middle, term, timing) > advance) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

export function annuityPayment(advance: number, nominalRate: number, term: number, timing: PaymentTiming): number | null {
  if (!(advance > 0) || nominalRate < 0 || !Number.isFinite(nominalRate) || !Number.isInteger(term) || term <= 0) return null;
  const monthly = nominalRate / 12;
  if (monthly === 0) return advance / term;
  const ordinary = advance * monthly / (1 - Math.pow(1 + monthly, -term));
  return timing === "advance" ? ordinary / (1 + monthly) : ordinary;
}

export function buildPaymentSchedule(input: RatePointsInput, nominalRate = input.buyNominalRate): ScheduleRow[] {
  const monthly = nominalRate / 12;
  let balance = input.advance;
  const rows: ScheduleRow[] = [];
  for (let period = 1; period <= input.term; period++) {
    const openingBalance = balance;
    const payment = input.payment;
    const interest = input.timing === "advance" && period === 1 ? 0 : openingBalance * monthly;
    const principal = Math.min(openingBalance, Math.max(0, payment - interest));
    const closingBalance = Math.max(0, openingBalance - principal);
    rows.push({ period, openingBalance, payment, interest, principal, closingBalance });
    balance = closingBalance;
  }
  return rows;
}

export function calculateRatePoints(input: RatePointsInput) {
  if (!validate(input)) return null;
  const monthlyRate = solveMonthlyRate(input.advance, input.payment, input.term, input.timing);
  const buyPayment = annuityPayment(input.advance, input.buyNominalRate, input.term, input.timing);
  if (monthlyRate == null || buyPayment == null) return null;
  const nominalRate = monthlyRate * 12;
  const totalCommission = (input.payment - buyPayment) * input.term;
  return {
    monthlyRate,
    nominalRate,
    effectiveRate: Math.pow(1 + monthlyRate, 12) - 1,
    simpleRate: ((input.payment * input.term - input.advance) / input.advance) / (input.term / 12),
    buyPayment,
    totalCommission,
    points: totalCommission / input.advance * 100,
    schedule: buildPaymentSchedule(input, nominalRate),
  };
}

export function reverseFromPoints(input: Omit<RatePointsInput, "payment"> & { targetPoints: number }) {
  if (!(input.targetPoints >= 0) || !Number.isFinite(input.targetPoints)) return null;
  const buyPayment = annuityPayment(input.advance, input.buyNominalRate, input.term, input.timing);
  if (buyPayment == null) return null;
  const totalCommission = input.advance * input.targetPoints / 100;
  const payment = buyPayment + totalCommission / input.term;
  const result = calculateRatePoints({ ...input, payment });
  return result ? { ...result, payment, targetPoints: input.targetPoints } : null;
}