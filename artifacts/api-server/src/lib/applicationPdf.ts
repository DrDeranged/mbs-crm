import {
  APPLICATION_PDF_FOOTER,
  CONSENT_CHECKBOX_LABEL,
  CONSENT_TEXT,
  CONSENT_TEXT_VERSION,
  CONSENT_TITLE,
} from "./consentText";
import { rgb, type PDFPage } from "pdf-lib";
import { eq } from "drizzle-orm";
import { companySettingsTable, userIdentitiesTable } from "@workspace/db";
import {
  LETTER_WIDTH,
  MBS_BORDER,
  MBS_GREEN,
  MBS_LIGHT,
  MBS_NAVY,
  MBS_SLATE,
  PREPARED_BY_FOOTER_BASELINE as NATIVE_PREPARED_BY_FOOTER_BASELINE,
  addPreparedByFooters,
  createLetterPdf,
  drawWrappedText,
  pdfText,
  pdfTextForFont,
  wrapPdfText,
  embedMbsLogo,
  type NativePdfFonts,
} from "./nativePdf";

export const APPLICATION_FORM_FOOTER_BASELINE = 30;
export const PREPARED_BY_FOOTER_BASELINE = NATIVE_PREPARED_BY_FOOTER_BASELINE;

function escapeHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function isSafeImageDataUrl(v: string): boolean {
  const match = /^data:image\/(?:png|jpeg|gif|webp|bmp|x-icon);base64,([A-Za-z0-9+/]+={0,2})$/.exec(v);
  return !!match && match[1].length % 4 !== 1;
}

export type ApplicationPdfRep = {
  name?: string | null;
  email?: string | null;
  mobileNumber?: string | null;
  officePhone?: string | null;
  emails?: string[] | null;
  slug?: string | null;
  role?: string | null;
  title?: string | null;
};

export function selectApplicationPdfEmail(rep: Pick<ApplicationPdfRep, "email" | "emails">): string {
  const primary = rep.email?.trim() ?? "";
  const candidates = [primary, ...(rep.emails ?? [])]
    .map((candidate) => candidate?.trim() ?? "")
    .filter(Boolean);
  return candidates.find((candidate) => /@my-business-solutions\.com$/i.test(candidate))
    ?? primary;
}

export async function enrichApplicationPdfRep(
  database: { query?: Record<string, any> },
  userId: number,
  rep: ApplicationPdfRep,
): Promise<ApplicationPdfRep> {
  const identities = database.query?.userIdentitiesTable
    ? await database.query.userIdentitiesTable.findMany({ where: eq(userIdentitiesTable.userId, userId) })
    : [];
  const settings = database.query?.companySettingsTable
    ? await database.query.companySettingsTable.findFirst()
    : null;
  return {
    ...rep,
    officePhone: rep.officePhone ?? settings?.companyPhone ?? null,
    emails: [...new Set([rep.email, ...identities.map((identity: { email?: string | null }) => identity.email)].filter(Boolean) as string[])],
  };
}

export type ApplicationPdfHeaderLayout = {
  title: string;
  contacts: string[];
  contactSize: number;
  contactLeading: number;
  contactBaseline: number;
  ruleY: number;
  ruleHeight: number;
  businessBarTop: number;
};

export function applicationPdfHeaderLayout(rep: ApplicationPdfRep): ApplicationPdfHeaderLayout {
  const title = rep.title?.trim() ? rep.title.trim().toUpperCase() : "";
  const contacts = [rep.mobileNumber, rep.officePhone, selectApplicationPdfEmail(rep), "www.my-business-solutions.com"]
    .map((value) => value?.trim() ?? "")
    .filter(Boolean);
  const contactBaseline = title ? 738.5 : 745.5;
  const contactSize = contacts.length <= 3 ? 5.6 : 5.4;
  const contactLeading = contacts.length <= 3 ? 7 : 6.1;
  const lastBaseline = contacts.length ? contactBaseline - (contacts.length - 1) * contactLeading : contactBaseline;
  const ruleY = 712.4;
  const ruleHeight = 1.6;
  const businessBarTop = 711;
  const textToRuleClearance = lastBaseline - (ruleY + ruleHeight);
  const ruleToBarClearance = ruleY - businessBarTop;
  if (textToRuleClearance < 1 || ruleToBarClearance < 1) {
    throw new Error("Finance Application header clearance invariant failed");
  }
  return { title, contacts, contactSize, contactLeading, contactBaseline, ruleY, ruleHeight, businessBarTop };
}

export type ApplicationPdfApplication = Record<string, unknown>;

export type ApplicationPdfOptions = {
  rep: ApplicationPdfRep;
  application?: ApplicationPdfApplication | null;
  logoUrl?: string | null;
  submittedAt?: Date | null;
  signatureSignedAt?: Date | null;
  signatureMethod?: "typed" | "drawn" | null;
  signatureData?: string | null;
  clientIp?: string | null;
  /** Only set by the authorized lender-package export path after decrypting SSNs. */
  revealSsn?: boolean;
};

export type NativeApplicationPdfOptions = ApplicationPdfOptions & {
  /**
   * Package assembly applies one footer after all source pages are merged, so
   * it can accurately state the final page count.
   */
  includePreparedFooter?: boolean;
};

function displayTitle(rep: ApplicationPdfRep): string {
  return rep.title?.trim() || "";
}

function formatEasternDate(value: Date | null | undefined): string {
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("month")} ${get("day")}, ${get("year")}, ${get("hour")}:${get("minute")} ${get("dayPeriod")} ET`;
}

function value(input: unknown): string {
  if (input === null || input === undefined || String(input).trim() === "") return "";
  return escapeHtml(String(input));
}

function money(input: unknown): string {
  if (input === null || input === undefined || String(input).trim() === "") return "";
  const amount = Number(input);
  return Number.isFinite(amount) ? `$${amount.toLocaleString("en-US")}` : value(input);
}

function group(cells: string[], className: string): string {
  return `<div class="field-grid ${className}">${cells.join("")}</div>`;
}

function cell(
  label: string,
  input: unknown,
  className = "",
  options: { masked?: boolean } = {},
): string {
  const content = options.masked ? "***-**-****" : value(input);
  return `<div class="field ${className}${options.masked ? " masked" : ""}"><div class="field-label">${escapeHtml(label)}</div><div class="field-value">${content}</div></div>`;
}

function address(application: ApplicationPdfApplication, prefix: string): string {
  const parts = [
    application[`${prefix}Address`],
    application[`${prefix}City`],
    application[`${prefix}State`],
    application[`${prefix}Zip`],
  ].filter((part) => part !== null && part !== undefined && String(part).trim() !== "");
  return parts.map(String).join(", ");
}

function signatureLine(label: string, data: ApplicationPdfOptions): string {
  const method = data.signatureMethod;
  const signature = data.application == null
    ? ""
    : method === "typed" && data.signatureData?.trim()
    ? value(data.signatureData)
    : method === "drawn" && data.signatureData && isSafeImageDataUrl(data.signatureData)
      ? "Electronically signed"
      : "<em>Signature unavailable</em>";
  const date = formatEasternDate(data.signatureSignedAt);
  return `<div class="signature"><div class="signature-label">${escapeHtml(label)}</div><div class="signature-value">${signature}</div><div class="signature-date-label">Date:</div><div class="signature-date">${date}</div></div>`;
}

/**
 * The single shared application layout. It intentionally accepts a plain
 * public rep object and a field allow-list rather than a database row so
 * private user/application columns cannot leak into a public PDF.
 */
export function buildApplicationFormHtml(options: ApplicationPdfOptions): string {
  const app = options.application ?? {};
  const logo = options.logoUrl
    ? `<img src="${escapeHtml(options.logoUrl)}" alt="My Business Solutions logo" />`
    : "";
  const slug = options.rep.slug?.trim() || "";
  const repName = options.rep.name?.trim() || "My Business Solutions";
  const applyUrl = slug ? `app.my-business-solutions.com/r/${encodeURIComponent(slug)}` : "app.my-business-solutions.com";
  const ownerAddress = address(app, "ownerHome");
  const secondaryAddress = value(app.secondaryOwnerAddress);
  const hasSecondaryOwner = Object.entries(app).some(([key, field]) =>
    key.startsWith("secondaryOwner") && key !== "secondaryOwnerSsn" && field !== null && field !== undefined && String(field).trim() !== "");
  const signatureMetadata = options.application == null
    ? `<table class="metadata" aria-hidden="true"><tr><td>Signature Method</td><td></td></tr><tr><td>Signature Signed At</td><td></td></tr><tr><td>Signature IP</td><td></td></tr></table>`
    : `<table class="metadata" aria-hidden="true"><tr><td>Signature Method</td><td>${value(options.signatureMethod ?? "Unavailable")}</td></tr><tr><td>Signature Signed At</td><td>${value(formatEasternDate(options.signatureSignedAt) || "Unavailable")}</td></tr><tr><td>Signature IP</td><td>${value(options.clientIp ?? "unknown")}</td></tr></table>`;

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>Finance Application — ${value(repName)}</title>
<style>
  @page{size:Letter;margin:0}
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:#fff}
  body{width:8.5in;min-height:11in;padding:.18in .3in .16in;color:#15283d;font-family:Arial,Helvetica,sans-serif;font-size:7.2pt}
  .rep-header{height:.82in;display:grid;grid-template-columns:1fr 1fr 1fr;column-gap:12px;align-items:start}
  .rep-name{font-size:15pt;font-weight:700;line-height:1.05;color:#0e2a47;margin:0 0 3px}
  .rep-title{font-size:7.6pt;font-weight:700;color:#0e2a47;margin:0 0 5px;text-transform:uppercase}
  .rep-contact{font-size:7.2pt;line-height:1.35;color:#293b4f}
  .application-heading{text-align:center;padding-top:10px}
  .logo{width:1.45in;height:.62in;text-align:right;justify-self:end}
  .logo img{width:78pt;height:auto;max-height:78pt;object-fit:contain}
  .header-title{color:#0e2a47;font-weight:700;font-size:11pt}
  .apply{margin-top:6px;font-size:7pt;color:#0e2a47;white-space:nowrap}
  .green-rule{height:3px;background:#17a567;margin:8px 0 13px}
  .section{break-inside:avoid;margin:0 0 4px}
  .section-header{background:#0e2a47;color:#fff;font-size:7.7pt;font-weight:700;letter-spacing:.08em;padding:4px 6px;text-transform:uppercase}
  .section-note{font-size:6.3pt;font-style:italic;color:#44586d;margin:3px 4px}
  .field-grid{display:grid;border-left:1px solid #9daab5;border-top:1px solid #9daab5}
  .business-grid{grid-template-columns:repeat(6,1fr)}
  .owner-grid{grid-template-columns:repeat(5,1fr)}
  .financing-grid{grid-template-columns:repeat(6,1fr)}
  .field{min-height:27px;border-right:1px solid #9daab5;border-bottom:1px solid #9daab5}
  .field-label{display:block;background:#edf2f4;color:#23384c;font-size:6.2pt;font-weight:700;padding:3px 4px 1px;text-transform:uppercase;line-height:1.1}
  .field-value{display:block;min-height:13px;padding:2px 4px;line-height:1.1;overflow-wrap:anywhere;color:#111}
  .span-2{grid-column:span 2}.span-3{grid-column:span 3}.span-4{grid-column:span 4}.span-5{grid-column:span 5}.span-6{grid-column:span 6}
  .disclosure{border:1px solid #9daab5;padding:5px 6px;font-size:6.25pt;line-height:1.25;color:#1f2e3b}
  .disclosure-title{font-size:7.2pt;font-weight:700;color:#0e2a47;margin:0 0 3px;text-transform:uppercase}
  .consent{margin-top:4px;font-weight:700}
  .signatures{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:8px}
  .signature{display:grid;grid-template-columns:1fr .7in;column-gap:7px;align-items:end}
  .signature-label{grid-column:1 / -1;font-weight:700;color:#23384c;font-size:6.8pt;margin-bottom:9px}
  .signature-value{border-bottom:1px solid #23384c;min-height:16px;font-size:8.5pt;font-style:italic;padding:0 2px}
  .signature-date-label{font-size:6.8pt;font-weight:700;margin-top:5px}
  .signature-date{border-bottom:1px solid #23384c;min-height:16px;font-size:7pt;padding:0 2px}
  .footer{border-top:1px solid #17a567;color:#23384c;text-align:center;font-size:6.5pt;padding-top:4px;margin-top:9px}
  .metadata{display:none}
</style></head>
<body>
  <header class="rep-header">
    <div class="rep-info"><div class="rep-name">${value(repName)}</div>
      <div class="rep-title">${value(displayTitle(options.rep))}</div>
       <div class="rep-contact">${[options.rep.mobileNumber, options.rep.officePhone, selectApplicationPdfEmail(options.rep), "www.my-business-solutions.com"].filter(Boolean).map(value).join("<br />")}</div>
    </div>
    <div class="application-heading">
      <div class="header-title">Finance Application</div>
      <div class="apply">Apply online: ${value(applyUrl)}</div>
    </div>
   <div class="logo">${logo}</div>
  </header>
  <div class="green-rule"></div>
  <section class="section"><div class="section-header">Business Information</div>
    ${group([
      cell("Legal business name", app.businessName, "span-3"),
      cell("Doing business as (DBA)", app.dba, "span-3"),
      cell("Business type (LLC, Corp, Sole Prop)", app.businessType, "span-2"),
      cell("Federal tax ID", app.ein, "span-2"),
      cell("Annual revenue", money(app.annualRevenue), "span-2"),
      cell("Street address", app.businessAddress, "span-4"),
      cell("Suite / unit", app.businessSuite ?? app.businessUnit, "span-2"),
      cell("City, state, ZIP", [app.businessCity, app.businessState, app.businessZip].filter(Boolean).join(", "), "span-4"),
      cell("Business start date (MM/YYYY)", app.businessStartDate, "span-2"),
      cell("Industry", app.industry, "span-3"),
      cell("# of years under current ownership", app.yearsUnderCurrentOwnership, "span-3"),
    ], "business-grid")}
  </section>
  <section class="section"><div class="section-header">Owner Information</div>
    <div class="section-note">Please do not use a P.O. Box — use the business location address if available</div>
    ${group([
      cell("Principal owner", [app.ownerFirstName, app.ownerLastName].filter(Boolean).join(" "), "span-3"),
      cell("Email", app.email, "span-2"),
      cell("Owner full address — street, (unit), city, state, ZIP", ownerAddress, "span-5"),
       cell("SSN", options.revealSsn ? app.ownerSsn : null, "", { masked: options.application != null && !options.revealSsn }),
      cell("Date of birth", app.ownerDob),
      cell("Ownership %", app.ownershipPct),
      cell("Cell", app.phone),
      cell("Est. credit score", app.estCreditScore),
      cell("Secondary owner", app.secondaryOwnerName, "span-3"),
      cell("Email", app.secondaryOwnerEmail, "span-2"),
      cell("Owner full address — street, (unit), city, state, ZIP", secondaryAddress, "span-5"),
       cell("SSN", options.revealSsn ? app.secondaryOwnerSsn : null, "", { masked: options.application != null && hasSecondaryOwner && !options.revealSsn }),
       cell("Date of birth", hasSecondaryOwner ? app.secondaryOwnerDob : null),
       cell("Ownership %", hasSecondaryOwner ? app.secondaryOwnerOwnershipPct : null),
       cell("Cell", hasSecondaryOwner ? app.secondaryOwnerCell : null),
       cell("Est. credit score", hasSecondaryOwner ? app.secondaryOwnerEstCreditScore : null),
    ], "owner-grid")}
  </section>
  <section class="section"><div class="section-header">Financing Request</div>
    ${group([
      cell("Business description", app.businessDescription, "span-3"),
      cell("Timeline funds are needed", app.timelineFundsNeeded, "span-3"),
      cell("Amount requested", money(app.requestedAmount), "span-3"),
      cell("Year, make, model (if applicable)", app.yearMakeModel, "span-3"),
       cell("Equipment financing or working capital?", app.type === "equipment" ? "Equipment Financing" : app.type === "working_capital" ? "Working Capital" : app.type, "span-2"),
      cell("# of trucks in fleet (if applicable)", app.trucksInFleet, "span-2"),
      cell("Down payment amount", money(app.downPaymentAmount), "span-2"),
    ], "financing-grid")}
  </section>
  <section class="section"><div class="section-header">${escapeHtml(CONSENT_TITLE)}</div>
    <div class="disclosure" data-consent-text-version="${escapeHtml(CONSENT_TEXT_VERSION)}" data-consent-checkbox-label="${escapeHtml(CONSENT_CHECKBOX_LABEL)}">${escapeHtml(CONSENT_TEXT)}</div>
    ${signatureMetadata}
    <div class="signatures">${signatureLine("Signature of Applicant One:", options)}${signatureLine("Signature of Applicant Two:", { ...options, signatureData: null })}</div>
  </section>
  <footer class="footer">${escapeHtml(APPLICATION_PDF_FOOTER)}</footer>
</body></html>`;
}

type Field = {
  label: string;
  value: unknown;
  span: number;
  masked?: boolean;
};

function nativeValue(value: unknown): string {
  if (value === null || value === undefined || String(value).trim() === "") return "";
  return pdfText(value);
}

function nativeMoney(value: unknown): string {
  if (value === null || value === undefined || String(value).trim() === "") return "";
  const amount = Number(value);
  return Number.isFinite(amount) ? `$${amount.toLocaleString("en-US")}` : nativeValue(value);
}

function nativeAddress(application: ApplicationPdfApplication, prefix: string): string {
  return [
    application[`${prefix}Address`],
    application[`${prefix}City`],
    application[`${prefix}State`],
    application[`${prefix}Zip`],
  ].filter((part) => part !== null && part !== undefined && String(part).trim() !== "").map(String).join(", ");
}

function drawTrackedText(
  page: PDFPage,
  text: string,
  options: { x: number; y: number; size: number; font: NativePdfFonts["bold"]; color: ReturnType<typeof rgb>; tracking: number; maxWidth?: number },
): void {
  let x = options.x;
  for (const character of text) {
    if (options.maxWidth !== undefined && x - options.x > options.maxWidth) break;
    page.drawText(character, { x, y: options.y, size: options.size, font: options.font, color: options.color });
    x += options.font.widthOfTextAtSize(character, options.size) + options.tracking;
  }
}

function drawSectionBar(page: PDFPage, y: number, title: string, fonts: NativePdfFonts): number {
  page.drawRectangle({ x: 22, y: y - 13, width: 568, height: 13, color: MBS_NAVY });
  page.drawText(pdfTextForFont(title, fonts.bold).toUpperCase(), {
    x: 28,
    y: y - 9.3,
    size: 6.6,
    font: fonts.bold,
    color: rgb(1, 1, 1),
  });
  return y - 15;
}

function drawFieldGrid(params: {
  page: PDFPage;
  y: number;
  columns: number;
  fields: Field[];
  fonts: NativePdfFonts;
}): number {
  const { page, columns, fonts } = params;
  const cellWidth = 568 / columns;
  const rowHeight = 20;
  let y = params.y;
  let column = 0;
  for (const field of params.fields) {
    const span = Math.min(Math.max(field.span, 1), columns);
    if (column + span > columns) {
      y -= rowHeight;
      column = 0;
    }
    const x = 22 + column * cellWidth;
    const width = cellWidth * span;
    page.drawRectangle({
      x,
      y: y - rowHeight,
      width,
      height: rowHeight,
      borderColor: MBS_BORDER,
      borderWidth: 0.45,
    });
    page.drawRectangle({ x: x + 0.25, y: y - 6.1, width: width - 0.5, height: 5.85, color: MBS_LIGHT });
    page.drawText(pdfTextForFont(field.label, fonts.bold).toUpperCase(), {
      x: x + 3,
      y: y - 4.45,
      size: 4.15,
      font: fonts.bold,
      color: MBS_SLATE,
      maxWidth: width - 6,
    });
    const fieldValue = field.masked ? "***-**-****" : nativeValue(field.value);
    const lines = wrapPdfText(fieldValue, fonts.regular, 5.15, width - 6).slice(0, 2);
    lines.forEach((line, index) => {
      page.drawText(line, {
        x: x + 3,
        y: y - 12.25 - index * 5.45,
        size: 5.15,
        font: fonts.regular,
        color: rgb(0.07, 0.07, 0.07),
      });
    });
    column += span;
    if (column === columns) {
      y -= rowHeight;
      column = 0;
    }
  }
  return column === 0 ? y : y - rowHeight;
}

function drawnSignaturePng(value: string): Buffer {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[1].length % 4 === 1) {
    throw new Error("Drawn application signatures must be a valid PNG data URL");
  }
  return Buffer.from(match[1], "base64");
}

/**
 * Native equivalent of the client Finance Application in 00ff546. This
 * renderer deliberately has no browser dependency and keeps SSNs masked unless
 * the authorized lender-package export path explicitly enables revealSsn.
 */
export async function renderApplicationFormPdf(options: NativeApplicationPdfOptions): Promise<Buffer> {
  const { pdf, page, fonts } = await createLetterPdf();
  const logo = await embedMbsLogo(pdf);
  const app = options.application ?? {};
  const hasSecondaryOwner = Object.entries(app).some(([key, field]) =>
    key.startsWith("secondaryOwner") && key !== "secondaryOwnerSsn" && field !== null && field !== undefined && String(field).trim() !== "");
  const rep = options.rep;
  const repName = nativeValue(rep.name) || "My Business Solutions";
  const applyUrl = rep.slug?.trim()
    ? `app.my-business-solutions.com/r/${encodeURIComponent(rep.slug.trim())}`
    : "app.my-business-solutions.com";

  const header = applicationPdfHeaderLayout(rep);
  page.drawText(pdfTextForFont(repName, fonts.bold), { x: 22, y: 757, size: 12.5, font: fonts.bold, color: MBS_NAVY, maxWidth: 190 });
  if (header.title) {
    drawTrackedText(page, pdfTextForFont(header.title, fonts.bold), {
      x: 22, y: 745.5, size: 5.4, font: fonts.bold, color: MBS_GREEN, tracking: 0.5, maxWidth: 190,
    });
  }
  header.contacts.forEach((line, index) => page.drawText(pdfTextForFont(line, fonts.regular), {
    x: 22, y: header.contactBaseline - index * header.contactLeading, size: header.contactSize,
    font: fonts.regular, color: MBS_SLATE, maxWidth: 190,
  }));
  page.drawText("Finance Application", { x: 242, y: 755, size: 10.5, font: fonts.bold, color: MBS_NAVY });
  page.drawText(pdfTextForFont(`Apply online: ${applyUrl}`, fonts.regular), { x: 221, y: 743, size: 5.5, font: fonts.regular, color: MBS_SLATE });
  if (logo) {
    const ratio = Math.min(78 / logo.width, 78 / logo.height, 1);
    page.drawImage(logo, { x: 490, y: 732, width: logo.width * ratio, height: logo.height * ratio });
  }
  page.drawRectangle({ x: 22, y: header.ruleY, width: 568, height: header.ruleHeight, color: MBS_GREEN });

  let y = 711;
  y = drawSectionBar(page, y, "Business Information", fonts);
  y = drawFieldGrid({
    page, y, columns: 6, fonts,
    fields: [
      { label: "Legal business name", value: app.businessName, span: 3 },
      { label: "Doing business as (DBA)", value: app.dba, span: 3 },
      { label: "Business type (LLC, Corp, Sole Prop)", value: app.businessType, span: 2 },
      { label: "Federal tax ID", value: app.ein, span: 2 },
      { label: "Annual revenue", value: nativeMoney(app.annualRevenue), span: 2 },
      { label: "Street address", value: app.businessAddress, span: 4 },
      { label: "Suite / unit", value: app.businessSuite ?? app.businessUnit, span: 2 },
      { label: "City, state, ZIP", value: [app.businessCity, app.businessState, app.businessZip].filter(Boolean).join(", "), span: 4 },
      { label: "Business start date (MM/YYYY)", value: app.businessStartDate, span: 2 },
      { label: "Industry", value: app.industry, span: 3 },
      { label: "# of years under current ownership", value: app.yearsUnderCurrentOwnership, span: 3 },
    ],
  });
  y = drawSectionBar(page, y - 2, "Owner Information", fonts);
  page.drawText(pdfTextForFont("Please do not use a P.O. Box — use the business location address if available", fonts.regular), {
    x: 26, y: y - 5, size: 4.6, font: fonts.regular, color: MBS_SLATE,
  });
  y -= 9;
  y = drawFieldGrid({
    page, y, columns: 5, fonts,
    fields: [
      { label: "Principal owner", value: [app.ownerFirstName, app.ownerLastName].filter(Boolean).join(" "), span: 3 },
      { label: "Email", value: app.email, span: 2 },
      { label: "Owner full address — street, (unit), city, state, ZIP", value: nativeAddress(app, "ownerHome"), span: 5 },
       { label: "SSN", value: options.revealSsn ? app.ownerSsn : null, span: 1, masked: options.application != null && !options.revealSsn },
      { label: "Date of birth", value: app.ownerDob, span: 1 },
      { label: "Ownership %", value: app.ownershipPct, span: 1 },
      { label: "Cell", value: app.phone, span: 1 },
      { label: "Est. credit score", value: app.estCreditScore, span: 1 },
      { label: "Secondary owner", value: hasSecondaryOwner ? app.secondaryOwnerName : null, span: 3 },
      { label: "Email", value: hasSecondaryOwner ? app.secondaryOwnerEmail : null, span: 2 },
      { label: "Owner full address — street, (unit), city, state, ZIP", value: hasSecondaryOwner ? app.secondaryOwnerAddress : null, span: 5 },
       { label: "SSN", value: options.revealSsn ? app.secondaryOwnerSsn : null, span: 1, masked: options.application != null && hasSecondaryOwner && !options.revealSsn },
      { label: "Date of birth", value: hasSecondaryOwner ? app.secondaryOwnerDob : null, span: 1 },
      { label: "Ownership %", value: hasSecondaryOwner ? app.secondaryOwnerOwnershipPct : null, span: 1 },
      { label: "Cell", value: hasSecondaryOwner ? app.secondaryOwnerCell : null, span: 1 },
      { label: "Est. credit score", value: hasSecondaryOwner ? app.secondaryOwnerEstCreditScore : null, span: 1 },
    ],
  });
  y = drawSectionBar(page, y - 2, "Financing Request", fonts);
  y = drawFieldGrid({
    page, y, columns: 6, fonts,
    fields: [
      { label: "Business description", value: app.businessDescription, span: 3 },
      { label: "Timeline funds are needed", value: app.timelineFundsNeeded, span: 3 },
      { label: "Amount requested", value: nativeMoney(app.requestedAmount), span: 3 },
      { label: "Year, make, model (if applicable)", value: app.yearMakeModel, span: 3 },
      { label: "Equipment financing or working capital?", value: app.type === "equipment" ? "Equipment Financing" : app.type === "working_capital" ? "Working Capital" : app.type, span: 2 },
      { label: "# of trucks in fleet (if applicable)", value: app.trucksInFleet, span: 2 },
      { label: "Down payment amount", value: nativeMoney(app.downPaymentAmount), span: 2 },
    ],
  });
  y = drawSectionBar(page, y - 2, CONSENT_TITLE, fonts);
  y = drawWrappedText({
    page, text: CONSENT_TEXT, x: 27, y: y - 5, maxWidth: 558, font: fonts.regular, size: 4.65, lineHeight: 5.5, color: MBS_SLATE,
  });

  const hasHistoricalSignature = options.application != null &&
    (options.signatureMethod === "typed" || options.signatureMethod === "drawn") &&
    Boolean(options.signatureData?.trim());
  if (hasHistoricalSignature) {
    y -= 4;
    page.drawText("Signature of Applicant One:", { x: 27, y, size: 5.4, font: fonts.bold, color: MBS_SLATE });
    const signatureY = y - 17;
    page.drawLine({ start: { x: 27, y: signatureY }, end: { x: 292, y: signatureY }, thickness: 0.5, color: MBS_SLATE });
    if (options.signatureMethod === "typed") {
      page.drawText(pdfTextForFont(options.signatureData, fonts.regular), {
        x: 31, y: signatureY + 3, size: 8, font: fonts.regular, color: MBS_SLATE, maxWidth: 256,
      });
    } else {
      try {
        const image = await pdf.embedPng(drawnSignaturePng(options.signatureData!));
        const ratio = Math.min(120 / image.width, 18 / image.height, 1);
        page.drawImage(image, { x: 31, y: signatureY + 1, width: image.width * ratio, height: image.height * ratio });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Could not embed the application signature PNG: ${detail}`, { cause: error });
      }
    }
    const evidence = [
      options.signatureSignedAt && !Number.isNaN(options.signatureSignedAt.valueOf())
        ? `Timestamp: ${formatEasternDate(options.signatureSignedAt)}`
        : null,
      options.clientIp?.trim() ? `IP: ${pdfTextForFont(options.clientIp, fonts.regular)}` : null,
    ].filter(Boolean).join("  ·  ");
    if (evidence) page.drawText(evidence, { x: 307, y: signatureY + 5, size: 4.7, font: fonts.regular, color: MBS_SLATE, maxWidth: 278 });
  }

  if (!hasHistoricalSignature) {
    const signatureY = y - 30;
    page.drawText("Signature of Applicant One:", { x: 27, y: y - 8, size: 5.4, font: fonts.bold, color: MBS_SLATE });
    page.drawLine({ start: { x: 27, y: signatureY }, end: { x: 292, y: signatureY }, thickness: 0.5, color: MBS_SLATE });
    page.drawText("Date:", { x: 307, y: y - 8, size: 5.4, font: fonts.bold, color: MBS_SLATE });
    page.drawLine({ start: { x: 307, y: signatureY }, end: { x: 585, y: signatureY }, thickness: 0.5, color: MBS_SLATE });
    if (options.application != null) {
      page.drawText("Historical signature evidence unavailable", { x: 31, y: signatureY + 3, size: 5, font: fonts.regular, color: MBS_SLATE });
    }
  }
  page.drawLine({ start: { x: 22, y: 42 }, end: { x: 590, y: 42 }, thickness: 0.6, color: MBS_GREEN });
  page.drawText(APPLICATION_PDF_FOOTER, {
    x: 50, y: APPLICATION_FORM_FOOTER_BASELINE, size: 4.9, font: fonts.regular, color: MBS_SLATE, maxWidth: 512,
  });
  if (options.includePreparedFooter !== false) await addPreparedByFooters(pdf, selectApplicationPdfEmail(rep));
  return Buffer.from(await pdf.save());
}