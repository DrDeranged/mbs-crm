export type RatePointsTiming = "arrears" | "advance";

export type RatePointsValues = {
  advance: number;
  payment: number;
  term: number;
  timing: RatePointsTiming;
  buyNominalRate: number;
};

function pv(payment: number, rate: number, term: number, timing: RatePointsTiming) {
  let total = 0;
  for (let i = 0; i < term; i++) total += payment / Math.pow(1 + rate, timing === "advance" ? i : i + 1);
  return total;
}

export function annuityPayment(advance: number, nominalRate: number, term: number, timing: RatePointsTiming) {
  const monthly = nominalRate / 12;
  if (monthly === 0) return advance / term;
  const ordinary = advance * monthly / (1 - Math.pow(1 + monthly, -term));
  return timing === "advance" ? ordinary / (1 + monthly) : ordinary;
}

export function solveMonthlyRate(advance: number, payment: number, term: number, timing: RatePointsTiming) {
  if (pv(payment, 0, term, timing) < advance) return null;
  let low = 0;
  let high = 0.01;
  while (pv(payment, high, term, timing) > advance && high < 1e6) high *= 2;
  if (high >= 1e6) return null;
  for (let i = 0; i < 160; i++) {
    const middle = (low + high) / 2;
    if (pv(payment, middle, term, timing) > advance) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

export function calculateRatePoints(input: RatePointsValues) {
  if (!(input.advance > 0) || !(input.payment > 0) || !Number.isInteger(input.term) || input.term <= 0 ||
      !Number.isFinite(input.buyNominalRate) || input.buyNominalRate < 0) return null;
  const monthlyRate = solveMonthlyRate(input.advance, input.payment, input.term, input.timing);
  if (monthlyRate == null) return null;
  const buyPayment = annuityPayment(input.advance, input.buyNominalRate, input.term, input.timing);
  const totalCommission = (input.payment - buyPayment) * input.term;
  return {
    advance: input.advance,
    payment: input.payment,
    term: input.term,
    timing: input.timing,
    buyNominalRate: input.buyNominalRate,
    nominalRate: monthlyRate * 12,
    effectiveRate: Math.pow(1 + monthlyRate, 12) - 1,
    simpleRate: ((input.payment * input.term - input.advance) / input.advance) / (input.term / 12),
    buyPayment,
    totalCommission,
    points: totalCommission / input.advance * 100,
  };
}