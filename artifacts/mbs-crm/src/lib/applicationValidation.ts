const FIELD_LABELS: Record<string, string> = {
  type: "Application type",
  businessName: "Business name",
  dba: "DBA",
  ein: "EIN",
  businessAddress: "Business address",
  businessCity: "Business city",
  businessState: "Business state",
  businessZip: "Business ZIP",
  industry: "Industry",
  timeInBusinessMonths: "Time in business",
  monthlyRevenueStated: "Monthly revenue",
  requestedAmount: "Requested amount",
  useOfFunds: "Use of funds",
  equipmentDescription: "Equipment description",
  vendorName: "Vendor name",
  vendorQuoteAmount: "Vendor quote amount",
  equipmentCondition: "Equipment condition",
  email: "Email",
  phone: "Phone",
  ownerFirstName: "Owner first name",
  ownerLastName: "Owner last name",
  ownerSsn: "Social Security number",
  ownerDob: "Date of birth",
  ownerHomeAddress: "Owner home address",
  ownerHomeCity: "Owner home city",
  ownerHomeState: "Owner home state",
  ownerHomeZip: "Owner home ZIP",
  ownershipPct: "Ownership percentage",
  consentCreditPull: "Credit pull consent",
  consentTerms: "Terms consent",
  signatureMethod: "Signature method",
  signatureData: "Signature",
  statementsSkipped: "Bank statements",
};

const FIELD_STEPS: Record<string, number> = {
  type: 1,
  businessName: 2,
  dba: 2,
  ein: 2,
  businessAddress: 2,
  businessCity: 2,
  businessState: 2,
  businessZip: 2,
  industry: 2,
  timeInBusinessMonths: 2,
  monthlyRevenueStated: 2,
  requestedAmount: 2,
  useOfFunds: 2,
  equipmentDescription: 2,
  vendorName: 2,
  vendorQuoteAmount: 2,
  equipmentCondition: 2,
  email: 2,
  phone: 2,
  ownerFirstName: 3,
  ownerLastName: 3,
  ownerSsn: 3,
  ownerDob: 3,
  ownerHomeAddress: 3,
  ownerHomeCity: 3,
  ownerHomeState: 3,
  ownerHomeZip: 3,
  ownershipPct: 3,
  statementsSkipped: 4,
  consentCreditPull: 5,
  consentTerms: 5,
  signatureMethod: 5,
  signatureData: 5,
};

/** Format EIN input as digits with a dash after the first two digits. */
export function formatEinTyping(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 9);
  return digits.length > 2 ? `${digits.slice(0, 2)}-${digits.slice(2)}` : digits;
}

export function applicationFieldStep(field: string): number | undefined {
  return FIELD_STEPS[field];
}

export function humanizeApplicationField(field: string): string {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  const label = field
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^[a-z]/, (letter) => letter.toUpperCase())
    .trim();
  return label || "Application";
}

export function formatApplicationValidationError(
  field: string,
  message: unknown,
): { message: string; step?: number } {
  const step = applicationFieldStep(field);
  const safeMessage = typeof message === "string" ? message.trim() : "";
  const error = safeMessage && !safeMessage.startsWith("Invalid input")
    ? safeMessage
    : "Submission failed. Please try again.";
  if (step === undefined) {
    return { message: error };
  }
  const label = humanizeApplicationField(field);
  return {
    message: `Please fix: ${label} — ${error === "Submission failed. Please try again." ? `${label} is not valid` : error}`,
    step,
  };
}

export type ApplicationResponse = {
  error?: unknown;
  field?: unknown;
  lead_id?: number;
};

export function parseApplicationResponse(value: unknown): ApplicationResponse | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as ApplicationResponse;
}

export function sanitizeApplicationError(message: unknown, fallback: string): string {
  const safeMessage = typeof message === "string" ? message.trim() : "";
  return safeMessage && !safeMessage.startsWith("Invalid input") ? safeMessage : fallback;
}