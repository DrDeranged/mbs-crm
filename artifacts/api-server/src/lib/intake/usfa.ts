export const USFA_HEADERS = [
  "Id", "COMPANY", "Credit Score", "Industry", "OWNER NAME", "First Name",
  "Last Name", "Email", "Phone 1", "Phone 2", "EIN", "START DATE", "SSN",
  "Street", "City", "State", "Zip/postal code", "DOB", "REVENUE",
  "AMOUNT REQUESTED", "Comment / feedback", "CREATEDAT", "Comment 2",
  "Comment 3", "STATEMENT(A)", "STATEMENT(B)", "STATEMENT(C)", "STATEMENT(D)",
] as const;

export type UsfaHeader = (typeof USFA_HEADERS)[number];
export type UsfaRow = Partial<Record<UsfaHeader, unknown>> & Record<string, unknown>;

export type UsfaMappedLead = {
  externalId: string;
  lead: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    companyName: string | null;
    ein: string | null;
    applicationType: "working_capital";
    leadSource: "usfundadvisor";
    externalId: string;
    requestedAmount: number | null;
    creditScore: number | null;
    creditScoreBand: string | null;
    monthlyRevenueBand: string | null;
    createdAt: Date | null;
  };
  company: {
    name: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    industry: string | null;
    timeInBusinessMonths: number | null;
    annualRevenue: number | null;
  };
  /** Encrypt JSON.stringify(intakePrefill) before inserting usfa_intake_prefill. */
  intakePrefill: { ssn: string | null; dob: string | null } | null;
  metadata: {
    creditScoreRaw: string | null;
    revenueRaw: string | null;
    ownerName: string | null;
    monthlyRevenueFloor: number | null;
    monthlyRevenueCeiling: number | null;
    annualRevenueDerivation: "monthly_floor_x_12" | null;
    altPhone: string | null;
    phoneInvalid: boolean;
    einWasShort: boolean;
    statementLinks: string[];
    comments: string[];
  };
  taskPlan: {
    title: "Download bank statements from USFA dashboard and upload as Bank statement";
    statementCount: number;
  } | null;
  dedupePlan: {
    externalId: string;
    email: string | null;
    phone: string | null;
    matchOrder: readonly ["external_id", "email", "phone"];
    allowEmailMatch: boolean;
    action: "external_id_first_then_reapplication";
  };
};

const text = (value: unknown): string | null => {
  if (value == null) return null;
  const result = String(value).trim();
  return result ? result : null;
};

const stripFloat = (value: unknown): string | null => {
  const result = text(value);
  return result?.replace(/\.0+$/, "") ?? null;
};

const digits = (value: unknown): string | null => {
  const result = stripFloat(value)?.replace(/\D/g, "") ?? "";
  return result || null;
};

const numberValue = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = text(value)?.replace(/[$,\s]/g, "");
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

function phone(value: unknown): string | null {
  const valueDigits = digits(value);
  return valueDigits && valueDigits.length === 10 ? valueDigits : valueDigits;
}

function ein(value: unknown): { value: string | null; wasShort: boolean } {
  const valueDigits = digits(value);
  if (!valueDigits) return { value: null, wasShort: false };
  const wasShort = valueDigits.length < 8;
  const padded = valueDigits.padStart(9, "0");
  return {
    value: padded.length === 9 ? `${padded.slice(0, 2)}-${padded.slice(2)}` : padded,
    wasShort,
  };
}

function score(value: unknown): { floor: number | null; raw: string | null } {
  const raw = text(value);
  if (!raw) return { floor: null, raw: null };
  const over = raw.match(/over\s+(\d+)/i);
  if (over) return { floor: Number(over[1]), raw };
  const range = raw.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (range) return { floor: Number(range[1]), raw };
  const under = raw.match(/under\s+(\d+)/i);
  if (under) return { floor: null, raw };
  const numeric = numberValue(raw);
  return { floor: numeric, raw };
}

function revenue(value: unknown): {
  floor: number | null;
  ceiling: number | null;
  raw: string | null;
} {
  const raw = text(value);
  if (!raw) return { floor: null, ceiling: null, raw: null };
  const amounts = [...raw.matchAll(/\$?\s*([\d,]+(?:\.\d+)?)/g)].map((match) => Number(match[1].replace(/,/g, "")));
  if (amounts.length >= 2) return { floor: amounts[0], ceiling: amounts[1], raw };
  if (amounts.length === 1) return { floor: amounts[0], ceiling: amounts[0], raw };
  return { floor: null, ceiling: null, raw };
}

function monthsSince(value: unknown, now: Date): number | null {
  const raw = text(value);
  if (!raw) return null;
  const start = new Date(raw);
  if (Number.isNaN(start.getTime())) return null;
  const months = (now.getUTCFullYear() - start.getUTCFullYear()) * 12
    + now.getUTCMonth() - start.getUTCMonth();
  return Math.max(0, months - (now.getUTCDate() < start.getUTCDate() ? 1 : 0));
}

function sourceDate(value: unknown): Date | null {
  const raw = text(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function mapUsfaRow(row: UsfaRow, now = new Date()): UsfaMappedLead {
  const externalId = text(row.Id);
  if (!externalId) throw new Error("USFA row Id is required");
  const firstName = text(row["First Name"]);
  const lastName = text(row["Last Name"]);
  const ownerName = text(row["OWNER NAME"]) ?? ([firstName, lastName].filter(Boolean).join(" ") || null);
  const primaryPhone = phone(row["Phone 1"]);
  const secondaryPhone = phone(row["Phone 2"]);
  const einResult = ein(row.EIN);
  const scoreResult = score(row["Credit Score"]);
  const revenueResult = revenue(row.REVENUE);
  const statementLinks = ["STATEMENT(A)", "STATEMENT(B)", "STATEMENT(C)", "STATEMENT(D)"]
    .map((header) => text(row[header])).filter((link): link is string => Boolean(link));
  const comments = ["Comment / feedback", "Comment 2", "Comment 3"]
    .map((header) => text(row[header])).filter((comment): comment is string => Boolean(comment));
  const email = text(row.Email)?.toLowerCase() ?? null;
  const metadata = {
    creditScoreRaw: scoreResult.raw,
    revenueRaw: revenueResult.raw,
    ownerName,
    monthlyRevenueFloor: revenueResult.floor,
    monthlyRevenueCeiling: revenueResult.ceiling,
    annualRevenueDerivation: revenueResult.floor == null ? null : "monthly_floor_x_12" as const,
    altPhone: secondaryPhone,
    phoneInvalid: Boolean(primaryPhone && primaryPhone.length !== 10),
    einWasShort: einResult.wasShort,
    statementLinks,
    comments,
  };
  return {
    externalId,
    lead: {
      firstName,
      lastName,
      email,
      phone: primaryPhone,
      companyName: text(row.COMPANY),
      ein: einResult.value,
      applicationType: "working_capital",
      leadSource: "usfundadvisor",
      externalId,
      requestedAmount: numberValue(row["AMOUNT REQUESTED"]),
      creditScore: scoreResult.floor,
      creditScoreBand: scoreResult.raw,
      monthlyRevenueBand: revenueResult.raw,
      createdAt: sourceDate(row.CREATEDAT),
    },
    company: {
      name: text(row.COMPANY),
      address: text(row.Street),
      city: text(row.City),
      state: text(row.State),
      zip: (() => {
        const value = digits(row["Zip/postal code"]);
        return value ? value.padStart(5, "0") : null;
      })(),
      industry: text(row.Industry),
      timeInBusinessMonths: monthsSince(row["START DATE"], now),
      annualRevenue: revenueResult.floor == null ? null : revenueResult.floor * 12,
    },
    intakePrefill: row.SSN != null || row.DOB != null
      ? { ssn: stripFloat(row.SSN), dob: text(row.DOB) }
      : null,
    metadata,
    taskPlan: statementLinks.length ? {
      title: "Download bank statements from USFA dashboard and upload as Bank statement",
      statementCount: statementLinks.length,
    } : null,
    dedupePlan: {
      externalId,
      email,
      phone: primaryPhone,
      matchOrder: ["external_id", "email", "phone"],
      allowEmailMatch: email !== "tech@usfundadvisor.ai",
      action: "external_id_first_then_reapplication",
    },
  };
}