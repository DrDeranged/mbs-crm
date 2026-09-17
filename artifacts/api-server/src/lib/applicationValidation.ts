import { z } from "zod/v4";
import { normalizeSignature, validateApplicationRules } from "./applicationSignature";

/**
 * Treat only strings that are empty after trimming as omitted. Other values,
 * including non-empty strings with surrounding whitespace, are left for the
 * wrapped schema to validate.
 */
export function optionalStr<T extends z.ZodTypeAny>(
  inner: T,
): z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodOptional<T>> {
  return z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    inner.optional(),
  );
}

/** Normalize fields that are formatted by the public multipart application form. */
export function normalizeApplicationSubmissionBody(raw: unknown): Record<string, unknown> {
  const body = raw !== null && typeof raw === "object" && !Array.isArray(raw)
    ? { ...(raw as Record<string, unknown>) }
    : {};
  if (typeof body.ein === "string") {
    const digits = body.ein.replace(/\D/g, "");
    body.ein = digits.length === 9
      ? `${digits.slice(0, 2)}-${digits.slice(2)}`
      : body.ein;
  }
  if (typeof body.phone === "string") {
    body.phone = body.phone.trim();
  }
  if (typeof body.ownerSsn === "string") {
    body.ownerSsn = body.ownerSsn.replace(/\D/g, "");
  }
  if (typeof body.secondaryOwnerSsn === "string") {
    body.secondaryOwnerSsn = body.secondaryOwnerSsn.replace(/\D/g, "");
  }
  return body;
}

const isPositiveAmount = (v: string | undefined) => {
  if (!v) return true;
  const n = Number(v);
  return !isNaN(n) && n > 0;
};
const isNonNegativeAmount = (v: string | undefined) => {
  if (!v) return true;
  const n = Number(v);
  return !isNaN(n) && n >= 0;
};

/** The production multipart application schema. Keep parsing in one place so
 * route behavior and validation tests cannot drift apart. */
export const submitSchema = z.object({
  type: z.enum(["equipment", "working_capital"], { message: "Invalid application type" }),
  businessName: z.string().min(1, "Business name is required").max(200, "Business name must be 200 characters or fewer"),
  dba: optionalStr(z.string().max(200, "DBA must be 200 characters or fewer")),
  ein: optionalStr(z.string()
    .regex(/^\d{2}-\d{7}$/, "EIN must be in XX-XXXXXXX format (e.g. 12-3456789)")),
  businessAddress: optionalStr(z.string().max(300, "Address too long")),
  businessCity: optionalStr(z.string().max(100, "City too long")),
  businessState: optionalStr(z.string().max(50, "State too long")),
  businessZip: optionalStr(z.string().max(20, "ZIP too long")),
  industry: optionalStr(z.string().max(100, "Industry too long")),
  businessType: optionalStr(z.enum(["LLC", "Corp", "Sole Prop", "Partnership", "Other"])),
  annualRevenue: optionalStr(z.string()
    .refine(isPositiveAmount, "Annual revenue must be a positive number")
    .refine((v) => !v || Number(v) <= 1_000_000_000, "Annual revenue value out of range")),
  businessStartDate: optionalStr(z.string().regex(/^(0[1-9]|1[0-2])\/\d{4}$/, "Business start date must be in MM/YYYY format")),
  yearsUnderCurrentOwnership: optionalStr(z.string().regex(/^\d+$/, "Years under current ownership must be a whole number")),
  businessDescription: optionalStr(z.string().max(2000, "Business description must be 2000 characters or fewer")),
  estCreditScore: optionalStr(z.enum(["below_500", "500_549", "550_599", "600_649", "650_699", "700_plus"])),
  timelineFundsNeeded: optionalStr(z.string().max(100)),
  useOfFunds: optionalStr(z.string().max(1000, "Use of funds must be 1000 characters or fewer")),
  ownerFirstName: z.string().min(1, "Owner first name is required").max(100, "First name must be 100 characters or fewer"),
  ownerLastName: z.string().min(1, "Owner last name is required").max(100, "Last name must be 100 characters or fewer"),
  ownerDob: optionalStr(z.string().max(20)),
  ownerHomeAddress: optionalStr(z.string().max(300)),
  ownerHomeCity: optionalStr(z.string().max(100)),
  ownerHomeState: optionalStr(z.string().max(50)),
  ownerHomeZip: optionalStr(z.string().max(20)),
  email: optionalStr(z.string().email("Invalid email address").max(254, "Email too long")),
  phone: optionalStr(z.string().regex(/^\+?[\d\s\-().]{7,20}$/, "Invalid phone number — use digits, spaces, dashes, or parentheses")),
  ownerSsn: optionalStr(z.string().regex(/^\d{9}$/, "SSN must be exactly 9 digits (no dashes)")),
  secondaryOwnerName: optionalStr(z.string().max(200)),
  secondaryOwnerEmail: optionalStr(z.string().email("Invalid secondary owner email").max(254)),
  secondaryOwnerAddress: optionalStr(z.string().max(300)),
  secondaryOwnerSsn: optionalStr(z.string().regex(/^\d{9}$/, "Secondary owner SSN must be exactly 9 digits (no dashes)")),
  secondaryOwnerDob: optionalStr(z.string().max(20)),
  secondaryOwnerOwnershipPct: optionalStr(z.string().max(3)),
  secondaryOwnerCell: optionalStr(z.string().regex(/^\+?[\d\s\-().]{7,20}$/, "Invalid secondary owner cell number")),
  secondaryOwnerEstCreditScore: optionalStr(z.enum(["below_500", "500_549", "550_599", "600_649", "650_699", "700_plus"])),
  requestedAmount: optionalStr(z.string()
    .refine(isPositiveAmount, "Requested amount must be a positive number")
    .refine((v) => !v || Number(v) <= 10_000_000, "Requested amount cannot exceed $10,000,000")),
  monthlyRevenueStated: optionalStr(z.string()
    .refine(isPositiveAmount, "Monthly revenue must be a positive number")
    .refine((v) => !v || Number(v) <= 100_000_000, "Monthly revenue value out of range")),
  vendorQuoteAmount: optionalStr(z.string()
    .refine(isPositiveAmount, "Vendor quote amount must be a positive number")),
  consentCreditPull: z.union([z.literal("true"), z.literal(true)], { message: "Credit pull consent is required" }),
  consentTerms: z.union([z.literal("true"), z.literal(true)], { message: "Terms consent is required" }),
  signatureMethod: z.enum(["typed", "drawn"], { message: "Signature method must be typed or drawn" }),
  signatureData: z.string().max(500_000, "Signature data must be 500,000 characters or fewer"),
  equipmentDescription: z.string().max(2000, "Equipment description must be 2000 characters or fewer").optional(),
  vendorName: z.string().max(200, "Vendor name must be 200 characters or fewer").optional(),
  statementsSkipped: z.union([z.literal("true"), z.literal("false"), z.literal(true), z.literal(false)]).optional(),
  rep: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  usfaInviteToken: z.string().min(32).max(128).optional(),
  timeInBusinessMonths: optionalStr(z.string().max(4)),
  ownershipPct: optionalStr(z.string().max(3)),
  equipmentCondition: optionalStr(z.enum(["new", "used"])),
  yearMakeModel: optionalStr(z.string().max(200)),
  trucksInFleet: optionalStr(z.string().regex(/^\d+$/, "Trucks in fleet must be a whole number")),
  downPaymentAmount: optionalStr(z.string().refine(isNonNegativeAmount, "Down payment amount must be zero or greater")),
  hasFinancialStatements: z.union([z.literal("true"), z.literal("false"), z.literal(true), z.literal(false)]).optional(),
  hasFactoring: z.union([z.literal("true"), z.literal("false"), z.literal(true), z.literal(false)]).optional(),
  hasCollateral: z.union([z.literal("true"), z.literal("false"), z.literal(true), z.literal(false)]).optional(),
  industryExperienceMonths: optionalStr(z.string().regex(/^\d+$/, "Industry experience must be a whole number of months")),
  industryDetail: optionalStr(z.string().max(200)),
}).superRefine((data, ctx) => {
  for (const issue of validateApplicationRules(data)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue.error, path: [issue.field] });
  }
  if (data.industry === "Other" && !data.industryDetail) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Please specify the business industry", path: ["industryDetail"] });
  }
  const signature = normalizeSignature(data.signatureMethod, data.signatureData);
  if (!signature.success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: signature.error, path: [signature.field] });
  }
});

export function parseApplicationSubmission(raw: unknown) {
  return submitSchema.safeParse(normalizeApplicationSubmissionBody(raw));
}

export function firstValidationError(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): { field: string; message: string } {
  const issue = issues[0];
  const field = issue?.path.map(String).join(".") || "form";
  const message = issue?.message?.trim();
  return {
    field,
    message: message && !message.startsWith("Invalid input")
      ? message
      : `${field} is not valid`,
  };
}