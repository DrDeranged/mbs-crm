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
  submittedAt: Date;
  signatureSignedAt: Date | null;
  clientIp: string | null;
};

/** Generates the archived signed application document. */
export function buildSignedApplicationHtml(params: SignedApplicationHtmlParams): string {
  const { lead, body, submittedAt, signatureSignedAt, clientIp } = params;
  const field = (v: unknown) => escapeHtml(v != null && v !== "" ? v : "—");
  const bool = (v: unknown) => (v === "true" || v === true) ? "✓ Yes" : "No";
  const rawSig = typeof body["signatureData"] === "string" ? body["signatureData"] : "";
  const signatureMethod = body["signatureMethod"] === "typed" || body["signatureMethod"] === "drawn"
    ? body["signatureMethod"]
    : null;
  const sigData = signatureMethod === "typed"
    ? `<span style="font-size:22px;font-style:italic;color:#1F4E79;">${escapeHtml(rawSig)}</span>`
    : signatureMethod === "drawn" && isSafeImageDataUrl(rawSig)
      ? `<img src="${escapeHtml(rawSig)}" style="max-width:320px;border:1px solid #ccc;border-radius:4px;" />`
      : signatureMethod === null
        ? "<em>Signature unavailable</em>"
        : "<em>Signature image unavailable</em>";
  const submitted = escapeHtml(submittedAt.toUTCString());
  const signed = signatureSignedAt ? escapeHtml(signatureSignedAt.toUTCString()) : "Unavailable";
  const signatureMethodLabel = signatureMethod ?? "Unavailable";
  const ip = escapeHtml(clientIp ?? "unknown");
  const timeInBusiness = body["timeInBusinessMonths"]
    ? `${field(body["timeInBusinessMonths"])} months`
    : "—";
  const monthlyRevenue = body["monthlyRevenueStated"]
    ? `$${field(Number(body["monthlyRevenueStated"]).toLocaleString())}`
    : "—";
  const requestedAmount = body["requestedAmount"]
    ? `$${field(Number(body["requestedAmount"]).toLocaleString())}`
    : "—";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>MBS Application — ${field(lead.firstName)} ${field(lead.lastName)}</title>
<style>
  body{font-family:Arial,sans-serif;color:#222;max-width:860px;margin:40px auto;padding:0 24px;}
  h1{color:#1F4E79;border-bottom:3px solid #1F4E79;padding-bottom:8px;}
  h2{color:#1F4E79;font-size:15px;margin-top:28px;margin-bottom:8px;border-bottom:1px solid #ddd;padding-bottom:4px;}
  table{width:100%;border-collapse:collapse;font-size:13px;}
  td{padding:6px 12px;border:1px solid #e5e7eb;vertical-align:top;}
  td:first-child{font-weight:600;width:38%;background:#f8fafc;color:#374151;}
  .footer{margin-top:40px;font-size:11px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:12px;}
</style>
</head>
<body>
<h1>My Business Solutions — Financing Application</h1>
<p style="color:#6b7280;font-size:13px;">Application ID: <strong>${field(lead.id)}</strong> &nbsp;|&nbsp; Submitted: <strong>${submitted}</strong> &nbsp;|&nbsp; IP: <strong>${ip}</strong></p>

<h2>Business Information</h2>
<table>
  <tr><td>Business Name</td><td>${field(body["businessName"])}</td></tr>
  <tr><td>DBA</td><td>${field(body["dba"])}</td></tr>
  <tr><td>EIN</td><td>${field(body["ein"])}</td></tr>
  <tr><td>Industry</td><td>${field(body["industry"])}</td></tr>
  <tr><td>Address</td><td>${field(body["businessAddress"])}, ${field(body["businessCity"])}, ${field(body["businessState"])} ${field(body["businessZip"])}</td></tr>
  <tr><td>Time in Business</td><td>${timeInBusiness}</td></tr>
  <tr><td>Monthly Revenue (Stated)</td><td>${monthlyRevenue}</td></tr>
  <tr><td>Requested Amount</td><td>${requestedAmount}</td></tr>
  <tr><td>Use of Funds</td><td>${field(body["useOfFunds"])}</td></tr>
  <tr><td>Application Type</td><td>${field(body["type"])}</td></tr>
</table>

<h2>Owner Information</h2>
<table>
  <tr><td>Name</td><td>${field(body["ownerFirstName"])} ${field(body["ownerLastName"])}</td></tr>
  <tr><td>Date of Birth</td><td>${field(body["ownerDob"])}</td></tr>
  <tr><td>SSN</td><td>***-**-**** (encrypted)</td></tr>
  <tr><td>Home Address</td><td>${field(body["ownerHomeAddress"])}, ${field(body["ownerHomeCity"])}, ${field(body["ownerHomeState"])} ${field(body["ownerHomeZip"])}</td></tr>
  <tr><td>Ownership %</td><td>${field(body["ownershipPct"])}</td></tr>
</table>

<h2>Consent &amp; Signature</h2>
<table>
  <tr><td>Credit Pull Consent</td><td>${bool(body["consentCreditPull"])}</td></tr>
  <tr><td>Terms Consent</td><td>${bool(body["consentTerms"])}</td></tr>
  <tr><td>Signature Method</td><td>${field(signatureMethodLabel)}</td></tr>
  <tr><td>Signature Signed At</td><td>${signed}</td></tr>
  <tr><td>Signature IP</td><td>${ip}</td></tr>
</table>
<div style="margin-top:16px;">${sigData}</div>

<div class="footer">
  This document was generated automatically by My Business Solutions CRM on ${submitted}.
  It contains a verbatim record of the applicant's submission and electronic signature.
  SSN is stored separately in encrypted form and is not included here.
</div>
</body>
</html>`;
}