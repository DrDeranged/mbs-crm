import { buildApplicationFormHtml, type ApplicationPdfRep } from "./applicationPdf";

export type SignatureMethod = "typed" | "drawn";

export type SignatureValidation =
  | { success: true; method: SignatureMethod; data: string }
  | { success: false; field: "signatureData"; error: string };

export type ApplicationRuleInput = {
  type: "equipment" | "working_capital";
  equipmentDescription?: string;
  vendorName?: string;
  consentCreditPull?: unknown;
  consentTerms?: unknown;
};

/** Rules shared by multipart validation and focused unit tests. */
export function validateApplicationRules(data: ApplicationRuleInput): Array<{ field: string; error: string }> {
  const issues: Array<{ field: string; error: string }> = [];
  if (data.type === "equipment" && !data.equipmentDescription?.trim()) {
    issues.push({ field: "equipmentDescription", error: "Equipment description is required" });
  }
  // vendorName is intentionally not validated here: it is optional, including
  // for equipment applications.
  if (!(data.consentCreditPull === "true" || data.consentCreditPull === true)) {
    issues.push({ field: "consentCreditPull", error: "Credit pull consent is required" });
  }
  if (!(data.consentTerms === "true" || data.consentTerms === true)) {
    issues.push({ field: "consentTerms", error: "Terms consent is required" });
  }
  return issues;
}

/** Escapes a value for safe HTML insertion (prevents XSS). */
export function escapeHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/** Validates a base64 image data URL without allowing SVG/script payloads. */
export function isSafeImageDataUrl(v: string): boolean {
  const match = /^data:image\/(?:png|jpeg|gif|webp|bmp|x-icon);base64,([A-Za-z0-9+/]+={0,2})$/.exec(v);
  if (!match) return false;
  // Padding is optional in data URLs, but a one-character remainder can
  // never be valid base64.
  return match[1].length % 4 !== 1;
}

/** Normalizes and validates the applicant's method-specific signature. */
export function normalizeSignature(method: unknown, value: unknown): SignatureValidation {
  if (method !== "typed" && method !== "drawn") {
    return { success: false, field: "signatureData", error: "Signature method must be typed or drawn" };
  }
  if (typeof value !== "string") {
    return { success: false, field: "signatureData", error: `${method === "typed" ? "Typed" : "Drawn"} signature is required` };
  }

  if (method === "typed") {
    const data = value.trim();
    if (!data) return { success: false, field: "signatureData", error: "Typed signature is required" };
    if (data.length < 2) return { success: false, field: "signatureData", error: "Typed signature must be at least 2 characters" };
    if (data.length > 200) return { success: false, field: "signatureData", error: "Typed signature must be 200 characters or fewer" };
    return { success: true, method, data };
  }

  if (!value) return { success: false, field: "signatureData", error: "Drawn signature is required" };
  if (value.length > 500_000) return { success: false, field: "signatureData", error: "Drawn signature must be 500,000 characters or fewer" };
  if (!isSafeImageDataUrl(value)) {
    return { success: false, field: "signatureData", error: "Drawn signature must be a valid base64 image data URL" };
  }
  return { success: true, method, data: value };
}

export type SignedApplicationHtmlParams = {
  lead: { id: number; firstName: string | null; lastName: string | null };
  body: Record<string, unknown>;
  rep?: ApplicationPdfRep;
  logoUrl?: string | null;
  submittedAt: Date;
  signatureSignedAt: Date | null;
  clientIp: string | null;
};

/** Generates the archived signed application document. */
export function buildSignedApplicationHtml(params: SignedApplicationHtmlParams): string {
  const { body } = params;
  const signatureMethod = body["signatureMethod"] === "typed" || body["signatureMethod"] === "drawn"
    ? body["signatureMethod"]
    : null;
  const rawSig = typeof body["signatureData"] === "string" ? body["signatureData"] : null;
  return buildApplicationFormHtml({
    rep: {
      ...(params.rep ?? {
        name: `${params.lead.firstName ?? ""} ${params.lead.lastName ?? ""}`.trim() || "My Business Solutions",
        email: null,
        role: "rep",
      }),
    },
    logoUrl: params.logoUrl,
    application: body,
    submittedAt: params.submittedAt,
    signatureSignedAt: params.signatureSignedAt,
    signatureMethod,
    signatureData: rawSig,
    clientIp: params.clientIp,
  });
}