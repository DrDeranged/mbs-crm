export type LoanAmortizationResult = {
  nominalApr: number;
  effectiveApr: number;
  simpleInterestRate: number;
  monthlyPaymentPer10k: number;
  totalPaybackPer10k: number;
};

export type LoanSourceType = "nominalApr" | "effectiveApr" | "simpleInterestRate";

function solveRateBisection(pv: number, pmt: number, n: number): number | null {
  const totalPayments = pmt * n;
  if (Math.abs(totalPayments - pv) < 1e-10) return 0;
  if (totalPayments < pv) return null;

  const presentValue = (rate: number) =>
    rate === 0 ? totalPayments : (pmt * (1 - Math.pow(1 + rate, -n))) / rate;

  let low = 0;
  let high = 0.01;

  while (presentValue(high) > pv && high < 1_000_000) {
    high *= 2;
  }
  if (!Number.isFinite(high) || high >= 1_000_000) return null;

  for (let i = 0; i < 120; i++) {
    const r = (low + high) / 2;
    const currentPv = presentValue(r);
    if (Math.abs(currentPv - pv) < 1e-6) return r;
    if (currentPv > pv) {
      low = r;
    } else {
      high = r;
    }
  }
  return (low + high) / 2;
}

export function calculateAmortization(
  termMonths: number,
  sourceValue: number,
  sourceType: LoanSourceType,
): LoanAmortizationResult | null {
  if (
    !Number.isInteger(termMonths) ||
    termMonths <= 0 ||
    !Number.isFinite(sourceValue) ||
    sourceValue < 0
  ) {
    return null;
  }

  const P = 10000;
  const n = termMonths;
  let r = 0;

  if (sourceValue === 0) {
    return {
      nominalApr: 0,
      effectiveApr: 0,
      simpleInterestRate: 0,
      monthlyPaymentPer10k: P / n,
      totalPaybackPer10k: P,
    };
  }

  if (sourceType === "nominalApr") {
    r = sourceValue / 12;
  } else if (sourceType === "effectiveApr") {
    r = Math.pow(1 + sourceValue, 1 / 12) - 1;
  } else if (sourceType === "simpleInterestRate") {
    const totalPayback = P * (1 + sourceValue * (n / 12));
    const pmt = totalPayback / n;
    const solvedRate = solveRateBisection(P, pmt, n);
    if (solvedRate === null) return null;
    r = solvedRate;
  }

  const nominalApr = r * 12;
  const effectiveApr = Math.pow(1 + r, 12) - 1;
  const pmt = r > 0 ? (P * r) / (1 - Math.pow(1 + r, -n)) : P / n;
  const totalPayback = pmt * n;
  const simpleInterestRate = ((totalPayback - P) / P) / (n / 12);

  if (![nominalApr, effectiveApr, simpleInterestRate, pmt, totalPayback].every(Number.isFinite)) {
    return null;
  }

  return {
    nominalApr,
    effectiveApr,
    simpleInterestRate,
    monthlyPaymentPer10k: pmt,
    totalPaybackPer10k: totalPayback,
  };
}

export type McaPeriodType = "weeks" | "months";
export type McaSourceType = "factor" | "apr";

export type McaResult = {
  factor: number;
  impliedNominalApr: number;
  periodicPaymentPer10k: number;
  totalPaybackPer10k: number;
};

export function calculateMca(
  term: number,
  periodType: McaPeriodType,
  sourceValue: number,
  sourceType: McaSourceType,
): McaResult | null {
  if (
    !Number.isInteger(term) ||
    term <= 0 ||
    !Number.isFinite(sourceValue) ||
    sourceValue < 0
  ) {
    return null;
  }

  const periodsPerYear = periodType === "weeks" ? 52 : 12;
  const n = term;
  const P = 10000;

  if (sourceType === "factor") {
    if (sourceValue < 1) return null;
    if (sourceValue === 1) {
      return {
        factor: 1,
        impliedNominalApr: 0,
        periodicPaymentPer10k: P / n,
        totalPaybackPer10k: P,
      };
    }
    const totalPayback = P * sourceValue;
    const pmt = totalPayback / n;
    const periodicRate = solveRateBisection(P, pmt, n);
    if (periodicRate === null) return null;

    return {
      factor: sourceValue,
      impliedNominalApr: periodicRate * periodsPerYear,
      periodicPaymentPer10k: pmt,
      totalPaybackPer10k: totalPayback,
    };
  } else if (sourceType === "apr") {
    if (sourceValue === 0) {
      return {
        factor: 1,
        impliedNominalApr: 0,
        periodicPaymentPer10k: P / n,
        totalPaybackPer10k: P,
      };
    }
    const periodicRate = sourceValue / periodsPerYear;
    const pmt = (P * periodicRate) / (1 - Math.pow(1 + periodicRate, -n));
    const totalPayback = pmt * n;
    const factor = totalPayback / P;

    if (![pmt, totalPayback, factor].every(Number.isFinite)) return null;

    return {
      factor,
      impliedNominalApr: sourceValue,
      periodicPaymentPer10k: pmt,
      totalPaybackPer10k: totalPayback,
    };
  }
  return null;
}
