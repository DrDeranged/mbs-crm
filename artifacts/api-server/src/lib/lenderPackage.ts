import { PDFDocument, rgb, type PDFPage } from "pdf-lib";
import type { Request, Response } from "express";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, documentsTable, applicationsTable, leadsTable, usersTable } from "@workspace/db";
import { ensureFlyerBranding, getBrandLogoReverseUrl, getBrandLogoUrl, getPublicBaseUrl } from "./brand";
import { escapeHtml, buildSignedApplicationHtml } from "./applicationSignature";
import { enrichApplicationPdfRep, renderApplicationFormPdf, selectApplicationPdfEmail } from "./applicationPdf";
import { requireUser } from "./authHelpers";
import { logPiiAccess } from "./piiAccess";
import { decrypt } from "./encryption";
import { logActivity } from "./activityHelper";
import { LenderPackageError, safeLenderPackageReason } from "./lenderPackageErrors";
import {
  MBS_BORDER,
  MBS_GREEN,
  MBS_LIGHT,
  MBS_NAVY,
  MBS_SLATE,
  addPreparedByFooters,
  createLetterPdf,
  drawWrappedText,
  embedMbsReverseLogo,
  pdfText,
  pdfTextForFont,
} from "./nativePdf";

export const LENDER_PACKAGE_MAX_BYTES = 40 * 1024 * 1024;
export const LENDER_PACKAGE_MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const LENDER_PACKAGE_MAX_SOURCE_BYTES = 100 * 1024 * 1024;
export const LENDER_PACKAGE_MAX_STATEMENT_PAGES = 100;

const SELECTION_NOTE =
  "Only PDF documents assigned to an underwriting package category are included. Documents that cannot be read are listed below.";

type Database = typeof db;
type Lead = typeof leadsTable.$inferSelect;
type Application = typeof applicationsTable.$inferSelect;
type Document = typeof documentsTable.$inferSelect;
type User = typeof usersTable.$inferSelect;
type PackageDocumentCategory = "bank_statement" | "invoice_quote" | "drivers_license" | "tax_return";
// `category` remains optional at this boundary so callers compiled before the
// category migration receive a safe "not selected" result rather than a type
// or runtime failure.
type PackageDocument = Omit<Document, "category"> & {
  category?: PackageDocumentCategory | "signed_application" | "other" | null;
};

export const LENDER_PACKAGE_DOCUMENT_CATEGORY_ORDER = [
  "invoice_quote",
  "bank_statement",
  "drivers_license",
  "tax_return",
] as const satisfies readonly PackageDocumentCategory[];

export const LENDER_PACKAGE_SECTION_ORDER = [
  "cover",
  "application",
  "invoice_quote",
  "bank_statement",
  "drivers_license",
  "tax_return",
  "other",
] as const;

const packageConfigSchema = z.object({
  sections: z.array(z.enum(LENDER_PACKAGE_SECTION_ORDER)).max(LENDER_PACKAGE_SECTION_ORDER.length).optional(),
  documentIds: z.array(z.number().int().positive()).max(200).optional(),
  options: z.object({
    maskSsn: z.boolean().optional(),
    includeCoverPage: z.boolean().optional(),
    includeFooter: z.boolean().optional(),
  }).strict().optional(),
}).strict();

export type LenderPackageConfig = z.infer<typeof packageConfigSchema>;

export function parseLenderPackageConfig(value: unknown): LenderPackageConfig | null {
  const result = packageConfigSchema.safeParse(value);
  return result.success ? result.data : null;
}

export type LenderPackageDocumentExclusion = {
  filename: string;
  reason: string;
};

export type LenderPackageDependencies = {
  database?: Database;
  authenticate?: (req: Request, res: Response) => Promise<User | null>;
  renderPdf?: (html: string, options?: { format?: "A4" | "Letter" }) => Promise<Buffer>;
  downloadDocument?: (document: PackageDocument, maxBytes: number) => Promise<Buffer>;
  auditPiiAccess?: typeof logPiiAccess;
  activityLogger?: typeof logActivity;
};

type IncludedStatement = {
  document: PackageDocument;
  pdf: PDFDocument;
  bytes: number;
};

class DocumentDownloadGuardError extends Error {
  readonly bytesTransferred: number;

  constructor(message: string, bytesTransferred = 0, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.bytesTransferred = bytesTransferred;
  }
}

class PackageSizeError extends Error {}

class StatementCopyError extends Error {
  readonly statement: IncludedStatement;

  constructor(
    statement: IncludedStatement,
    cause: unknown,
  ) {
    super("Could not copy statement pages into package", { cause });
    this.statement = statement;
  }
}

function isPresent(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function text(value: unknown): string {
  return escapeHtml(String(value ?? ""));
}

function displayDate(value: Date | null | undefined): string | null {
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("month")} ${get("day")}, ${get("year")}, ${get("hour")}:${get("minute")} ${get("dayPeriod")} ET`;
}

function applicationType(value: unknown): string {
  return value === "equipment" ? "Equipment Financing"
    : value === "working_capital" ? "Working Capital"
      : String(value ?? "");
}

/** Prefer a branded address without assuming extra database columns exist. */
export function getLenderRepEmail(user: User | null | undefined): string | null {
  if (!user) return null;
  const candidates: string[] = [];
  for (const [key, value] of Object.entries(user as unknown as Record<string, unknown>)) {
    if (!/email/i.test(key)) continue;
    if (typeof value === "string") candidates.push(value);
    if (Array.isArray(value)) candidates.push(...value.filter((item): item is string => typeof item === "string"));
  }
  return selectApplicationPdfEmail({ email: candidates[0], emails: candidates.slice(1) }) || null;
}

function displayMoney(value: number | null | undefined): string | null {
  return value === null || value === undefined || !Number.isFinite(value)
    ? null
    : `$${value.toLocaleString("en-US")}`;
}

function displayMonths(value: number | null | undefined): string | null {
  return value === null || value === undefined || !Number.isFinite(value) ? null : `${value} months`;
}

function displayDocumentName(document: Pick<PackageDocument, "filename" | "fileKey">): string {
  return document.filename?.trim() || document.fileKey;
}

/**
 * Underwriting documents are selected exclusively from the persisted category.
 * Filename and object key are display/storage metadata, never classification.
 */
export function getLenderPackageDocumentCategory(
  document: Pick<PackageDocument, "category">,
): PackageDocumentCategory | null {
  return LENDER_PACKAGE_DOCUMENT_CATEGORY_ORDER.includes(document.category as PackageDocumentCategory)
    ? document.category as PackageDocumentCategory
    : null;
}

function isPdfDocument(document: Pick<PackageDocument, "filename" | "fileKey" | "fileType">): boolean {
  return (
    document.fileType.toLowerCase().includes("pdf") ||
    document.filename.toLowerCase().endsWith(".pdf") ||
    document.fileKey.toLowerCase().endsWith(".pdf")
  );
}

export function isEligibleBankStatement(
  document: Pick<PackageDocument, "filename" | "fileKey" | "fileType" | "category">,
): boolean {
  return getLenderPackageDocumentCategory(document) === "bank_statement" && isPdfDocument(document);
}

/** Returns package documents in the lender-required category order. */
export function selectLenderPackageDocuments(documents: PackageDocument[]): PackageDocument[] {
  const categoryRank = new Map(LENDER_PACKAGE_DOCUMENT_CATEGORY_ORDER.map((category, index) => [category, index]));
  return documents
    .filter((document) => getLenderPackageDocumentCategory(document) !== null)
    .sort((a, b) => {
      const rankDelta = categoryRank.get(getLenderPackageDocumentCategory(a)!)! -
        categoryRank.get(getLenderPackageDocumentCategory(b)!)!;
      if (rankDelta) return rankDelta;
      const createdDelta = a.createdAt.valueOf() - b.createdAt.valueOf();
      return createdDelta || a.id - b.id;
    });
}

/** Never honor a cross-category drag/order: sections always remain in the lender order. */
function orderSelectedPackageDocuments(documents: PackageDocument[], documentIds: number[] | undefined): PackageDocument[] {
  if (!documentIds) return selectLenderPackageDocuments(documents);
  const byId = new Map(documents.map((document) => [document.id, document]));
  const requested = documentIds.map((id) => byId.get(id)).filter((document): document is PackageDocument => !!document);
  const rank = new Map<string, number>([...LENDER_PACKAGE_DOCUMENT_CATEGORY_ORDER, "other"].map((category, index) => [category, index]));
  return requested
    .map((document, callerIndex) => ({ document, callerIndex }))
    .sort((a, b) => (rank.get(a.document.category ?? "") ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.document.category ?? "") ?? Number.MAX_SAFE_INTEGER) || a.callerIndex - b.callerIndex)
    .map(({ document }) => document);
}

export function getDocumentExclusionReason(
  document: Pick<PackageDocument, "filename" | "fileKey" | "fileType" | "category">,
): string | null {
  if (getLenderPackageDocumentCategory(document) === null) {
    return "document category is not selected for lender packages";
  }
  const isPdf =
    isPdfDocument(document);
  if (!isPdf) return "not a PDF";
  return null;
}

export function sanitizeLenderPackageBusinessName(value: string | null | undefined): string {
  const sanitized = String(value ?? "")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/["',]/g, "")
    .replace(/[\/\\:*?<>|]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  return sanitized || "Business";
}

function row(label: string, value: unknown): string {
  if (!isPresent(value)) return "";
  return `<div class="field"><div class="label">${text(label)}</div><div class="value">${text(value)}</div></div>`;
}

function buildCoverHtml(lead: Lead, application: Application, assignedRep: User | null): string {
  const submitted = displayDate(application.submittedAt);
  const requestedAmount = displayMoney(application.requestedAmount ?? lead.requestedAmount);
  const ownerName = [application.ownerFirstName, application.ownerLastName].filter(isPresent).join(" ");
  const businessName = application.businessName || lead.companyName;
  const repName = assignedRep?.name ?? null;
  const repEmail = getLenderRepEmail(assignedRep);
  const logoUrl = getBrandLogoReverseUrl(getPublicBaseUrl());

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  @page { size: A4; margin: 0; }
  body { margin: 0; padding: 42px 48px; color: #1f2937; font-family: Arial, sans-serif; }
  .header { background:#0b2948; color:#fff; border-bottom: 3px solid #17b26a; padding:24px; }
   .logo { min-height: 56px; margin-bottom: 24px; text-align: right; }
   .logo img { width: 96pt; height:auto; max-height:96pt; object-fit: contain; }
  h1 { color: #fff; font-size: 29px; margin: 0 0 8px; }
  .subtitle { color: #64748b; font-size: 13px; margin: 0; }
  .section { margin-top: 25px; }
  .section h2 { color: #1f4e79; font-size: 13px; text-transform: uppercase; letter-spacing: .06em; border-bottom: 1px solid #dbe4ee; padding-bottom: 7px; margin: 0 0 3px; }
  .field { display: flex; border-bottom: 1px solid #eef2f7; padding: 7px 0; font-size: 12px; }
  .label { color: #64748b; font-weight: 700; width: 42%; }
  .value { color: #111827; width: 58%; overflow-wrap: anywhere; }
  .note { color: #64748b; font-size: 10px; line-height: 1.4; margin-top: 24px; }
</style>
</head>
<body>
  <div class="header">
      <div class="logo" data-mbs-flyer-logo="true"><img src="${text(logoUrl)}" alt="My Business Solutions logo" /></div>
    <h1>Financing Application Package</h1>
    ${row("Business", businessName)}
    ${row("Owner", ownerName)}
  </div>
  <div class="section">
    <h2>Application</h2>
     ${row("Application type", applicationType(application.type))}
    ${row("Requested amount", requestedAmount)}
    ${row("Monthly revenue stated", displayMoney(application.monthlyRevenueStated))}
    ${row("Time in business", displayMonths(application.timeInBusinessMonths))}
    ${row("Submitted", submitted)}
  </div>
  ${assignedRep ? `
  <div class="section">
    <h2>Assigned representative</h2>
    ${row("Name", repName)}
    ${row("Title", assignedRep.title)}
     ${row("Email", repEmail)}
     ${row("Phone", assignedRep.mobileNumber ?? "—")}
  </div>` : ""}
  <p class="note">${text(SELECTION_NOTE)}</p>
</body>
</html>`;
}

function buildNotIncludedHtml(exclusions: LenderPackageDocumentExclusion[]): string {
  const items = exclusions
    .map((item) => `<li><strong>${text(item.filename)}</strong><span>${text(item.reason)}</span></li>`)
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  @page { size: A4; margin: 0; }
  body { margin: 0; padding: 48px; color: #1f2937; font-family: Arial, sans-serif; }
  h1 { color: #1f4e79; font-size: 24px; border-bottom: 3px solid #1f4e79; padding-bottom: 10px; }
  p { color: #64748b; font-size: 12px; line-height: 1.5; }
  ul { list-style: none; padding: 0; margin: 22px 0; }
  li { border-bottom: 1px solid #e5e7eb; padding: 9px 0; font-size: 11px; overflow-wrap: anywhere; }
  li strong { display: block; color: #111827; margin-bottom: 3px; }
  li span { color: #64748b; }
</style>
</head>
<body>
  <h1>Documents not included</h1>
  <p>${text(SELECTION_NOTE)}</p>
  <ul>${items}</ul>
</body>
</html>`;
}

function nativeCoverValue(value: unknown): string {
  return value === null || value === undefined || String(value).trim() === "" ? "—" : pdfText(value);
}

function nativeCoverMoney(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : `$${value.toLocaleString("en-US")}`;
}

function drawCoverField(
  page: PDFPage,
  fonts: Awaited<ReturnType<typeof createLetterPdf>>["fonts"],
  y: number,
  label: string,
  value: string,
): number {
  page.drawRectangle({ x: 42, y: y - 28, width: 528, height: 28, borderColor: MBS_BORDER, borderWidth: 0.5 });
  page.drawRectangle({ x: 42.25, y: y - 12, width: 181, height: 11.75, color: MBS_LIGHT });
  page.drawText(pdfTextForFont(label, fonts.bold).toUpperCase(), { x: 48, y: y - 8.2, size: 5.5, font: fonts.bold, color: MBS_SLATE });
  page.drawText(pdfTextForFont(value, fonts.regular), { x: 229, y: y - 18.8, size: 8, font: fonts.regular, color: MBS_SLATE, maxWidth: 333 });
  return y - 28;
}

/** Native lender-package cover; this has no Chromium/Puppeteer dependency. */
export async function renderLenderPackageCoverPdf(params: {
  lead: Lead;
  application: Application;
  assignedRep: User | null;
}): Promise<Buffer> {
  const { pdf, page, fonts } = await createLetterPdf();
  const logo = await embedMbsReverseLogo(pdf);
  const application = params.application;
  const owner = [application.ownerFirstName, application.ownerLastName].filter(isPresent).join(" ");
  page.drawRectangle({ x: 0, y: 640, width: 612, height: 152, color: MBS_NAVY });
  if (logo) {
    const ratio = Math.min(96 / logo.width, 96 / logo.height, 1);
    page.drawImage(logo, { x: 470, y: 730, width: logo.width * ratio, height: logo.height * ratio });
  }
  page.drawText("FINANCING APPLICATION PACKAGE", { x: 42, y: 702, size: 19, font: fonts.bold, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: 42, y: 689, width: 528, height: 3, color: MBS_GREEN });
  page.drawText("APPLICATION SUMMARY", { x: 42, y: 662, size: 8, font: fonts.bold, color: rgb(1, 1, 1) });

  let y = 645;
  y = drawCoverField(page, fonts, y, "Business", nativeCoverValue(application.businessName || params.lead.companyName));
  y = drawCoverField(page, fonts, y, "Owner", nativeCoverValue(owner));
  y = drawCoverField(page, fonts, y, "Application type", nativeCoverValue(applicationType(application.type)));
  y = drawCoverField(page, fonts, y, "Requested amount", nativeCoverMoney(application.requestedAmount ?? params.lead.requestedAmount));
  y = drawCoverField(page, fonts, y, "Monthly revenue stated", nativeCoverMoney(application.monthlyRevenueStated));
  y = drawCoverField(page, fonts, y, "Time in business", displayMonths(application.timeInBusinessMonths) ?? "—");
  y = drawCoverField(page, fonts, y, "Submitted", displayDate(application.submittedAt) ?? "—");
  if (params.assignedRep) {
    y -= 20;
    page.drawText("ASSIGNED REPRESENTATIVE", { x: 42, y, size: 8, font: fonts.bold, color: MBS_NAVY });
    y -= 17;
    y = drawCoverField(page, fonts, y, "Name", nativeCoverValue(params.assignedRep.name));
    y = drawCoverField(page, fonts, y, "Title", nativeCoverValue(params.assignedRep.title));
    y = drawCoverField(page, fonts, y, "Email", nativeCoverValue(getLenderRepEmail(params.assignedRep)));
    y = drawCoverField(page, fonts, y, "Phone", nativeCoverValue(params.assignedRep.mobileNumber));
  }
  page.drawLine({ start: { x: 42, y: 42 }, end: { x: 570, y: 42 }, thickness: 0.6, color: MBS_GREEN });
  page.drawText(pdfTextForFont("My Business Solutions LLC · Lending package prepared for review", fonts.regular), {
    x: 42, y: 31, size: 6.5, font: fonts.regular, color: MBS_SLATE,
  });
  return Buffer.from(await pdf.save());
}

/** Native final report for documents that were selected but could not be merged. */
export async function renderLenderPackageOmissionReportPdf(
  exclusions: LenderPackageDocumentExclusion[],
): Promise<Buffer> {
  const { pdf, page: firstPage, fonts } = await createLetterPdf();
  let page = firstPage;
  page.drawText("DOCUMENTS NOT INCLUDED", { x: 42, y: 742, size: 19, font: fonts.bold, color: MBS_NAVY });
  page.drawRectangle({ x: 42, y: 729, width: 528, height: 3, color: MBS_GREEN });
  let y = drawWrappedText({
    page, text: SELECTION_NOTE, x: 42, y: 705, maxWidth: 528, font: fonts.regular, size: 8, lineHeight: 10, color: MBS_SLATE,
  }) - 16;
  for (const exclusion of exclusions) {
    if (y < 100) {
      page = pdf.addPage([612, 792]);
      page.drawText("DOCUMENTS NOT INCLUDED (CONTINUED)", { x: 42, y: 742, size: 16, font: fonts.bold, color: MBS_NAVY });
      page.drawRectangle({ x: 42, y: 729, width: 528, height: 3, color: MBS_GREEN });
      y = 705;
    }
    page.drawRectangle({ x: 42, y: y - 34, width: 528, height: 34, borderColor: MBS_BORDER, borderWidth: 0.5 });
     page.drawText(pdfTextForFont(exclusion.filename, fonts.bold), { x: 48, y: y - 12, size: 8, font: fonts.bold, color: MBS_SLATE, maxWidth: 516 });
     page.drawText(pdfTextForFont(exclusion.reason, fonts.regular), { x: 48, y: y - 25, size: 7, font: fonts.regular, color: MBS_SLATE, maxWidth: 516 });
    y -= 40;
  }
  return Buffer.from(await pdf.save());
}

function applicationBody(application: Application, lead: Pick<Lead, "email" | "phone">): Record<string, unknown> {
  // Deliberately omit ownerSsnEncrypted. The signed application helper writes
  // its fixed masked SSN label and never needs the encrypted value.
  return {
    type: application.type,
    businessName: application.businessName,
    dba: application.dba,
    ein: application.ein,
    businessAddress: application.businessAddress,
    businessCity: application.businessCity,
    businessState: application.businessState,
    businessZip: application.businessZip,
    industry: application.industry,
    businessType: application.businessType,
    annualRevenue: application.annualRevenue,
    businessStartDate: application.businessStartDate,
    yearsUnderCurrentOwnership: application.yearsUnderCurrentOwnership,
    businessDescription: application.businessDescription,
    estCreditScore: application.estCreditScore,
    timelineFundsNeeded: application.timelineFundsNeeded,
    timeInBusinessMonths: application.timeInBusinessMonths,
    monthlyRevenueStated: application.monthlyRevenueStated,
    requestedAmount: application.requestedAmount,
    yearMakeModel: application.yearMakeModel,
    trucksInFleet: application.trucksInFleet,
    downPaymentAmount: application.downPaymentAmount,
    useOfFunds: application.useOfFunds,
    equipmentDescription: application.equipmentDescription,
    vendorName: application.vendorName,
    vendorQuoteAmount: application.vendorQuoteAmount,
    equipmentCondition: application.equipmentCondition,
    ownerFirstName: application.ownerFirstName,
    ownerLastName: application.ownerLastName,
    email: lead.email,
    phone: lead.phone,
    ownerDob: application.ownerDob,
    ownerHomeAddress: application.ownerHomeAddress,
    ownerHomeCity: application.ownerHomeCity,
    ownerHomeState: application.ownerHomeState,
    ownerHomeZip: application.ownerHomeZip,
    ownershipPct: application.ownershipPct,
    secondaryOwnerName: application.secondaryOwnerName,
    secondaryOwnerEmail: application.secondaryOwnerEmail,
    secondaryOwnerAddress: application.secondaryOwnerAddress,
    secondaryOwnerDob: application.secondaryOwnerDob,
    secondaryOwnerOwnershipPct: application.secondaryOwnerOwnershipPct,
    secondaryOwnerCell: application.secondaryOwnerCell,
    secondaryOwnerEstCreditScore: application.secondaryOwnerEstCreditScore,
    consentCreditPull: application.consentCreditPull,
    consentTerms: application.consentTerms,
    signatureMethod: application.signatureMethod,
    signatureData: application.signatureData,
  };
}

async function downloadStoredDocument(
  document: Pick<PackageDocument, "fileKey">,
  maxBytes = LENDER_PACKAGE_MAX_DOCUMENT_BYTES,
): Promise<Buffer> {
  // Keep object-storage's runtime-only ACL dependencies out of unit-test
  // imports; production still uses the same storage client for every fetch.
  const { objectStorageClient } = await import("./objectStorage");
  const bucketId = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"] ?? "";
  const file = objectStorageClient.bucket(bucketId).file(document.fileKey);
  const [metadata] = await file.getMetadata();
  const metadataSize = Number(metadata.size);
  if (maxBytes <= 0) {
    throw new DocumentDownloadGuardError("skipped because the package source download budget was reached");
  }
  const transferLimit = Math.min(maxBytes, LENDER_PACKAGE_MAX_DOCUMENT_BYTES);
  if (Number.isFinite(metadataSize) && metadataSize > transferLimit) {
    throw new DocumentDownloadGuardError(
      maxBytes < LENDER_PACKAGE_MAX_DOCUMENT_BYTES
        ? "exceeds the remaining package source download budget"
        : "exceeds per-document download limit",
    );
  }
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    const stream = file.createReadStream();
    for await (const chunk of stream) {
      const part = Buffer.from(chunk as Uint8Array);
      total += part.length;
      if (total > transferLimit) {
        stream.destroy();
        throw new DocumentDownloadGuardError(
          maxBytes < LENDER_PACKAGE_MAX_DOCUMENT_BYTES
            ? "exceeds the remaining package source download budget"
            : "exceeds per-document download limit",
          total,
        );
      }
      chunks.push(part);
    }
  } catch (error) {
    if (error instanceof DocumentDownloadGuardError) throw error;
    throw new DocumentDownloadGuardError("could not be downloaded", total, error);
  }
  return Buffer.concat(chunks, total);
}

function transferredBytes(error: unknown): number {
  if (!error || typeof error !== "object") return 0;
  const value = (error as { bytesTransferred?: unknown }).bytesTransferred;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

async function composePackage(
  cover: PDFDocument | null,
  signedApplication: PDFDocument | null,
  included: IncludedStatement[],
  exclusions: LenderPackageDocumentExclusion[],
  repEmail: string | null,
  renderNotIncluded?: (html: string, options?: { format?: "A4" | "Letter" }) => Promise<Buffer>,
  includeFooter = true,
): Promise<Buffer> {
  const packagePdf = await PDFDocument.create();
  const appendPages = async (source: PDFDocument): Promise<void> => {
    const pages = await packagePdf.copyPages(source, source.getPageIndices());
    for (const page of pages) packagePdf.addPage(page);
  };
  if (cover) await appendPages(cover);
  if (signedApplication) await appendPages(signedApplication);
  for (const statement of included) {
    // Copy pages only. This intentionally does not copy attachments, forms, or
    // hidden document-level data from uploaded PDFs.
    try {
      await appendPages(statement.pdf);
    } catch (error) {
      // The caller discards this in-progress PDF and retries without the
      // statement. This prevents a copyPages/addPage failure from leaving
      // partially appended pages in the delivered package.
      throw new StatementCopyError(statement, error);
    }
  }
  if (exclusions.length > 0) {
    try {
      const notIncluded = renderNotIncluded
        ? await renderNotIncluded(buildNotIncludedHtml(exclusions), { format: "Letter" })
        : await renderLenderPackageOmissionReportPdf(exclusions);
      const notIncludedPdf = await PDFDocument.load(notIncluded, {
        throwOnInvalidObject: false,
        updateMetadata: false,
      });
      await appendPages(notIncludedPdf);
    } catch (error) {
      const filename = exclusions[0]?.filename || "omission-report";
      throw new LenderPackageError(
        `merge_failed:${filename}`,
        `Could not produce the final documents-not-included report for ${filename}`,
        { cause: error },
      );
    }
  }
  try {
    if (includeFooter) await addPreparedByFooters(packagePdf, repEmail);
    return Buffer.from(await packagePdf.save());
  } catch (error) {
    throw new LenderPackageError("merge_failed:package", "Could not finalize lender package pages", { cause: error });
  }
}

export async function buildLenderPackagePdf(params: {
  lead: Lead;
  application: Application;
  assignedRep: User | null;
  documents: PackageDocument[];
  renderPdf?: (html: string, options?: { format?: "A4" | "Letter" }) => Promise<Buffer>;
  downloadDocument?: (document: PackageDocument, maxBytes: number) => Promise<Buffer>;
  /** Test-only output limit override; production uses the 40 MB constant. */
  maxPackageBytes?: number;
  selection?: LenderPackageConfig;
  /** Plaintext is intentionally accepted only after the authorized route decrypts it. */
  unmaskedSsn?: { ownerSsn: string | null; secondaryOwnerSsn: string | null };
}): Promise<{ pdf: Buffer; exclusions: LenderPackageDocumentExclusion[] }> {
  const download = params.downloadDocument ?? downloadStoredDocument;
  const selectedSections = new Set(params.selection?.sections ?? LENDER_PACKAGE_SECTION_ORDER);
  const selectedIds = params.selection?.documentIds;
  const selectedDocuments = orderSelectedPackageDocuments(params.documents, selectedIds);
  const applicationOptions = {
    rep: params.assignedRep
      ? {
        name: params.assignedRep.name,
        title: params.assignedRep.title,
         email: getLenderRepEmail(params.assignedRep),
        mobileNumber: params.assignedRep.mobileNumber,
         officePhone: (params.assignedRep as User & { officePhone?: string | null }).officePhone,
         emails: (params.assignedRep as User & { emails?: string[] | null }).emails,
        slug: params.assignedRep.slug,
        role: params.assignedRep.role,
      }
      : { name: "My Business Solutions", email: null, role: "rep" },
    application: {
      ...applicationBody(params.application, params.lead),
      ...(params.unmaskedSsn?.ownerSsn ? { ownerSsn: params.unmaskedSsn.ownerSsn } : {}),
      ...(params.unmaskedSsn?.secondaryOwnerSsn ? { secondaryOwnerSsn: params.unmaskedSsn.secondaryOwnerSsn } : {}),
    },
    submittedAt: params.application.submittedAt,
    signatureSignedAt: params.application.signatureSignedAt,
    signatureMethod: params.application.signatureMethod === "typed" || params.application.signatureMethod === "drawn"
      ? params.application.signatureMethod
      : null,
    signatureData: params.application.signatureData,
    clientIp: params.application.signatureIp,
    includePreparedFooter: false,
    revealSsn: params.selection?.options?.maskSsn === false && !!params.unmaskedSsn,
  } as const;
  let cover: PDFDocument | null = null;
  let signedApplication: PDFDocument | null = null;
  try {
    const [coverBytes, signedBytes] = await Promise.all([
      selectedSections.has("cover") && params.selection?.options?.includeCoverPage !== false
        ? (params.renderPdf
          ? params.renderPdf(
              ensureFlyerBranding(buildCoverHtml(params.lead, params.application, params.assignedRep), getPublicBaseUrl()),
              { format: "Letter" },
          ) : renderLenderPackageCoverPdf(params))
        : Promise.resolve(null),
      selectedSections.has("application")
        ? (params.renderPdf
          ? params.renderPdf(buildSignedApplicationHtml({
              lead: { id: params.lead.id, firstName: params.application.ownerFirstName, lastName: params.application.ownerLastName },
              rep: applicationOptions.rep,
              logoUrl: getBrandLogoUrl(getPublicBaseUrl()),
              body: applicationOptions.application,
              submittedAt: params.application.submittedAt,
              signatureSignedAt: params.application.signatureSignedAt,
              clientIp: params.application.signatureIp,
              revealSsn: applicationOptions.revealSsn,
            }), { format: "Letter" })
          : renderApplicationFormPdf(applicationOptions))
        : Promise.resolve(null),
    ]);
    [cover, signedApplication] = await Promise.all([
      coverBytes ? PDFDocument.load(coverBytes, { throwOnInvalidObject: false, updateMetadata: false }) : Promise.resolve(null),
      signedBytes ? PDFDocument.load(signedBytes, { throwOnInvalidObject: false, updateMetadata: false }) : Promise.resolve(null),
    ]);
  } catch (error) {
    throw new LenderPackageError(
      "renderer_unavailable",
      "Could not render the lender package cover or finance application",
      { cause: error },
    );
  }

  const exclusions: LenderPackageDocumentExclusion[] = [];
  const included: IncludedStatement[] = [];
  let downloadedBytes = 0;

  for (const document of selectedDocuments) {
    const name = displayDocumentName(document);
    if (!selectedSections.has(document.category === "other" ? "other" : document.category as any)) continue;
    const selectionReason = document.category === "other" && selectedSections.has("other")
      ? (isPdfDocument(document) ? null : "not a PDF")
      : getDocumentExclusionReason(document);
    if (selectionReason) {
      exclusions.push({ filename: name, reason: selectionReason });
      continue;
    }

    if (document.fileSize > LENDER_PACKAGE_MAX_DOCUMENT_BYTES) {
      exclusions.push({ filename: name, reason: "exceeds the per-document download limit" });
      continue;
    }
    if (downloadedBytes >= LENDER_PACKAGE_MAX_SOURCE_BYTES) {
      exclusions.push({ filename: name, reason: "skipped because the package source download budget was reached" });
      continue;
    }
    const remainingSourceBytes = LENDER_PACKAGE_MAX_SOURCE_BYTES - downloadedBytes;
    if (document.fileSize > 0 && document.fileSize > remainingSourceBytes) {
      exclusions.push({ filename: name, reason: "skipped because the package source download budget was reached" });
      continue;
    }

    let bytes: Buffer;
    try {
      bytes = await download(document, remainingSourceBytes);
    } catch (error) {
      downloadedBytes += transferredBytes(error);
      const reason = error instanceof DocumentDownloadGuardError
        ? error.message
        : "could not be downloaded";
      exclusions.push({ filename: name, reason });
      continue;
    }
    // Debit the actual bytes transferred before validating the remainder.
    // A lying/underreported fileSize or a rejected payload still consumes
    // source budget and cannot trigger unbounded subsequent downloads.
    downloadedBytes += bytes.length;
    if (bytes.length > LENDER_PACKAGE_MAX_DOCUMENT_BYTES) {
      exclusions.push({ filename: name, reason: "exceeds the per-document download limit" });
      continue;
    }
    if (downloadedBytes > LENDER_PACKAGE_MAX_SOURCE_BYTES) {
      exclusions.push({ filename: name, reason: "skipped because the package source download budget was reached" });
      continue;
    }

    if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
      exclusions.push({ filename: name, reason: "corrupt or invalid PDF" });
      continue;
    }

    try {
      const statementPdf = await PDFDocument.load(bytes, {
        throwOnInvalidObject: false,
        updateMetadata: false,
      });
      if (statementPdf.getPageCount() === 0) {
        exclusions.push({ filename: name, reason: "corrupt or invalid PDF" });
        continue;
      }
      if (statementPdf.getPageCount() > LENDER_PACKAGE_MAX_STATEMENT_PAGES) {
        exclusions.push({ filename: name, reason: "exceeds the per-document page limit" });
        continue;
      }
      included.push({ document, pdf: statementPdf, bytes: bytes.length });
    } catch {
      exclusions.push({ filename: name, reason: "corrupt or invalid PDF" });
    }
  }

  const maxPackageBytes = params.maxPackageBytes ?? LENDER_PACKAGE_MAX_BYTES;
  while (true) {
    let output: Buffer;
    try {
      output = await composePackage(
        cover,
        signedApplication,
        included,
        exclusions,
        getLenderRepEmail(params.assignedRep),
        params.renderPdf,
        params.selection?.options?.includeFooter !== false,
      );
    } catch (error) {
      if (error instanceof StatementCopyError) {
        const failedIndex = included.indexOf(error.statement);
        if (failedIndex >= 0) included.splice(failedIndex, 1);
        exclusions.push({
          filename: displayDocumentName(error.statement.document),
          reason: "could not be copied into the package",
        });
        continue;
      }
      if (error instanceof LenderPackageError) throw error;
      throw new LenderPackageError("merge_failed:package", "Could not merge lender package PDF pages", { cause: error });
    }
    if (output.length <= maxPackageBytes) return { pdf: output, exclusions };
    if (included.length === 0) {
      throw new PackageSizeError("The application package exceeds the maximum PDF size");
    }

    const largest = [...included].sort((a, b) => b.bytes - a.bytes)[0];
    exclusions.push({
      filename: displayDocumentName(largest.document),
      reason: "omitted as the largest statement to keep the package within the 40 MB limit",
    });
    included.splice(included.indexOf(largest), 1);
  }
}

export function createLenderPackageHandler(overrides: LenderPackageDependencies = {}) {
  const database = overrides.database ?? db;
  const authenticate = overrides.authenticate ?? requireUser;
  const download = overrides.downloadDocument ?? downloadStoredDocument;
  const audit = overrides.auditPiiAccess ?? logPiiAccess;

  return async (req: Request, res: Response): Promise<void> => {
    const user = await authenticate(req, res);
    if (!user) return;

    const id = Number(req.params["id"]);
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }

    try {
      const lead = await database.query.leadsTable.findFirst({ where: eq(leadsTable.id, id) });
      if (!lead) {
        res.status(404).json({ error: "Lead not found" });
        return;
      }
      // Match GET /documents/:docId/download exactly: out-of-scope reps are
      // denied with 403, while administrators/managers may access any lead.
      if (user.role === "rep" && lead.assignedRepId !== user.id) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      const application = await database.query.applicationsTable.findFirst({
        where: eq(applicationsTable.leadId, id),
        orderBy: [desc(applicationsTable.submittedAt), desc(applicationsTable.id)],
      });
      if (!application) {
        throw new LenderPackageError("no_application", "No application on file");
      }

      const [assignedRep, documents] = await Promise.all([
        lead.assignedRepId
          ? database.query.usersTable.findFirst({ where: eq(usersTable.id, lead.assignedRepId) })
          : Promise.resolve(null),
        database.query.documentsTable.findMany({
          where: eq(documentsTable.leadId, id),
          orderBy: (table, { asc: orderAsc }) => [orderAsc(table.createdAt), orderAsc(table.id)],
        }),
      ]);

      const enrichedAssignedRep = overrides.renderPdf || !assignedRep
        ? assignedRep
        : await enrichApplicationPdfRep(database, assignedRep.id, {
          name: assignedRep.name, title: assignedRep.title, email: assignedRep.email,
          mobileNumber: assignedRep.mobileNumber, slug: assignedRep.slug,
        }).then((rep) => ({ ...assignedRep, officePhone: rep.officePhone, emails: rep.emails }));
      const { pdf } = await buildLenderPackagePdf({
        lead,
        application,
        assignedRep: enrichedAssignedRep ?? null,
        documents,
        renderPdf: overrides.renderPdf,
        downloadDocument: download,
      });
      const filename = `MBS-Application-${sanitizeLenderPackageBusinessName(application.businessName || lead.companyName)}-${lead.id}.pdf`;

      // The package contains the masked application, so audit before handing
      // the successful binary response to the caller.
      audit({
        userId: user.id,
        leadId: lead.id,
        fieldCategory: "application",
        action: "export",
        ip: req.ip,
        metadata: {
          sections: LENDER_PACKAGE_SECTION_ORDER,
          documentIds: documents.map((document) => document.id),
          options: { maskSsn: true, includeCoverPage: true, includeFooter: true },
          ssnUnmasked: false,
        },
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", String(pdf.length));
      res.send(pdf);
    } catch (error) {
      const errorDetails = error instanceof Error
        ? { err: error, message: error.message, stack: error.stack }
        : { err: error, message: String(error), stack: undefined };
      if (req.log?.error) {
        req.log.error(errorDetails, "Failed to build lender package");
      } else {
        // Test requests and non-pino Express adapters do not always provide
        // req.log. Keep the full causal error available at error level.
        console.error("Failed to build lender package", errorDetails);
      }
      const reason = safeLenderPackageReason(error);
      if (reason === "no_application") {
        res.status(404).json({ error: "No application on file", reason });
        return;
      }
      if (error instanceof PackageSizeError) {
        res.status(413).json({ error: error.message, reason });
        return;
      }
      res.status(500).json({ error: "Lender package generation failed", reason });
    }
  };
}

export function createLenderPackageConfigHandler(overrides: LenderPackageDependencies = {}) {
  const database = overrides.database ?? db;
  const authenticate = overrides.authenticate ?? requireUser;

  return async (req: Request, res: Response): Promise<void> => {
    const user = await authenticate(req, res);
    if (!user) return;
    const id = Number(req.params["id"]);
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }
    const lead = await database.query.leadsTable.findFirst({ where: eq(leadsTable.id, id) });
    if (!lead) {
      res.status(404).json({ error: "Lead not found" });
      return;
    }
    if (user.role === "rep" && lead.assignedRepId !== user.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    if (req.method === "GET") {
      res.json({ packageConfig: parseLenderPackageConfig(lead.packageConfig) });
      return;
    }
    if (req.method === "DELETE") {
      await database.update(leadsTable).set({ packageConfig: null, updatedAt: new Date() }).where(eq(leadsTable.id, id));
      res.status(204).end();
      return;
    }
    const parsed = packageConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid package configuration" });
      return;
    }
    await database.update(leadsTable).set({ packageConfig: parsed.data, updatedAt: new Date() }).where(eq(leadsTable.id, id));
    res.json({ packageConfig: parsed.data });
  };
}

/** Builds only the caller-selected package contents and remembers that choice. */
export function createSelectedLenderPackageHandler(overrides: LenderPackageDependencies = {}) {
  const database = overrides.database ?? db;
  const authenticate = overrides.authenticate ?? requireUser;
  const download = overrides.downloadDocument ?? downloadStoredDocument;
  const audit = overrides.auditPiiAccess ?? logPiiAccess;

  return async (req: Request, res: Response): Promise<void> => {
    const user = await authenticate(req, res);
    if (!user) return;
    const id = Number(req.params["id"]);
    if (!Number.isSafeInteger(id) || id <= 0) return void res.status(400).json({ error: "Invalid ID" });
    const selection = parseLenderPackageConfig(req.body);
    if (!selection) return void res.status(400).json({ error: "Invalid package selection" });
    if (selection.options?.maskSsn === false && user.role !== "admin") {
      return void res.status(403).json({ error: "Only administrators may disable SSN masking" });
    }
    const lead = await database.query.leadsTable.findFirst({ where: eq(leadsTable.id, id) });
    if (!lead) return void res.status(404).json({ error: "Lead not found" });
    if (user.role === "rep" && lead.assignedRepId !== user.id) return void res.status(403).json({ error: "Forbidden" });
    const [application, assignedRep, documents] = await Promise.all([
      database.query.applicationsTable.findFirst({
        where: eq(applicationsTable.leadId, id),
        orderBy: [desc(applicationsTable.submittedAt), desc(applicationsTable.id)],
      }),
      lead.assignedRepId ? database.query.usersTable.findFirst({ where: eq(usersTable.id, lead.assignedRepId) }) : Promise.resolve(null),
      database.query.documentsTable.findMany({ where: eq(documentsTable.leadId, id) }),
    ]);
    if (!application) return void res.status(404).json({ error: "No application on file", reason: "no_application" });
    const ownedIds = new Set(documents.map((document) => document.id));
    if ((selection.documentIds ?? []).some((documentId) => !ownedIds.has(documentId))) {
      return void res.status(400).json({ error: "Every selected document must belong to this lead" });
    }
    try {
      const unmaskedSsn = selection.options?.maskSsn === false
        ? {
          ownerSsn: application.ownerSsnEncrypted ? decrypt(application.ownerSsnEncrypted) : null,
          secondaryOwnerSsn: application.secondaryOwnerSsnEncrypted ? decrypt(application.secondaryOwnerSsnEncrypted) : null,
        }
        : undefined;
      const enrichedAssignedRep = overrides.renderPdf || !assignedRep
        ? assignedRep
        : await enrichApplicationPdfRep(database, assignedRep.id, {
          name: assignedRep.name, title: assignedRep.title, email: assignedRep.email,
          mobileNumber: assignedRep.mobileNumber, slug: assignedRep.slug,
        }).then((rep) => ({ ...assignedRep, officePhone: rep.officePhone, emails: rep.emails }));
      const { pdf } = await buildLenderPackagePdf({
        lead, application, assignedRep: enrichedAssignedRep ?? null, documents,
        renderPdf: overrides.renderPdf, downloadDocument: download, selection, unmaskedSsn,
      });
      await database.update(leadsTable).set({ packageConfig: selection, updatedAt: new Date() }).where(eq(leadsTable.id, id));
      await (overrides.activityLogger ?? logActivity)({
        userId: user.id, leadId: id, action: "lender_package_built", entityType: "lead", entityId: id,
        details: {
          sections: selection.sections ?? LENDER_PACKAGE_SECTION_ORDER,
          documentIds: selection.documentIds ?? [],
          ssnUnmasked: selection.options?.maskSsn === false,
        },
      });
      audit({ userId: user.id, leadId: id, fieldCategory: "application", action: "export", ip: req.ip, metadata: { sections: selection.sections ?? LENDER_PACKAGE_SECTION_ORDER, documentIds: selection.documentIds ?? [], options: selection.options ?? null, ssnUnmasked: selection.options?.maskSsn === false } });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="MBS-Application-${sanitizeLenderPackageBusinessName(application.businessName || lead.companyName)}-${lead.id}.pdf"`);
      res.setHeader("Content-Length", String(pdf.length));
      res.send(pdf);
    } catch (error) {
      req.log?.error({ err: error }, "Failed to build selected lender package");
      res.status(500).json({ error: "Lender package generation failed", reason: safeLenderPackageReason(error) });
    }
  };
}