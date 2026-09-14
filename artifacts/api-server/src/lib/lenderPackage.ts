import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db, documentsTable, applicationsTable, leadsTable, usersTable } from "@workspace/db";
import { ensureFlyerBranding, getPublicBaseUrl } from "./brand";
import { escapeHtml, buildSignedApplicationHtml } from "./applicationSignature";
import { renderPdf as defaultRenderPdf } from "./renderPdf";
import { requireUser } from "./authHelpers";
import { logPiiAccess } from "./piiAccess";

export const LENDER_PACKAGE_MAX_BYTES = 40 * 1024 * 1024;
export const LENDER_PACKAGE_MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const LENDER_PACKAGE_MAX_SOURCE_BYTES = 100 * 1024 * 1024;
export const LENDER_PACKAGE_MAX_STATEMENT_PAGES = 100;

const SELECTION_NOTE =
  "No document category field is available; bank statements were selected using the conservative filename/stored-type filter.";
const EXCLUSION_PATTERN = /tax|return|license|ssn|id|check/i;

type Database = typeof db;
type Lead = typeof leadsTable.$inferSelect;
type Application = typeof applicationsTable.$inferSelect;
type Document = typeof documentsTable.$inferSelect;
type User = typeof usersTable.$inferSelect;

export type LenderPackageDocumentExclusion = {
  filename: string;
  reason: string;
};

export type LenderPackageDependencies = {
  database?: Database;
  authenticate?: (req: Request, res: Response) => Promise<User | null>;
  renderPdf?: (html: string) => Promise<Buffer>;
  downloadDocument?: (document: Document, maxBytes: number) => Promise<Buffer>;
  auditPiiAccess?: typeof logPiiAccess;
};

type IncludedStatement = {
  document: Document;
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
  return value instanceof Date && !Number.isNaN(value.valueOf()) ? value.toUTCString() : null;
}

function displayMoney(value: number | null | undefined): string | null {
  return value === null || value === undefined || !Number.isFinite(value)
    ? null
    : `$${value.toLocaleString("en-US")}`;
}

function displayMonths(value: number | null | undefined): string | null {
  return value === null || value === undefined || !Number.isFinite(value) ? null : `${value} months`;
}

function displayDocumentName(document: Document): string {
  return document.filename?.trim() || document.fileKey;
}

function documentSearchText(document: Pick<Document, "filename" | "fileKey" | "fileType">): string {
  // fileKey is an opaque storage path, not a user-controlled document type.
  // The safety decision is intentionally limited to filename and stored type.
  return [document.filename, document.fileType].filter(Boolean).join(" ");
}

/**
 * The database intentionally has no document category column. Do not broaden
 * this predicate to ordinary "bank" matches: only explicit statement wording
 * is safe to append to a lender package.
 */
export function isEligibleBankStatement(document: Pick<Document, "filename" | "fileKey" | "fileType">): boolean {
  const name = documentSearchText(document);
  const isPdf =
    document.fileType.toLowerCase().includes("pdf") ||
    document.filename.toLowerCase().endsWith(".pdf") ||
    document.fileKey.toLowerCase().endsWith(".pdf");
  const hasBankAndStatement = /bank/i.test(name) && /statement/i.test(name);
  return isPdf && !EXCLUSION_PATTERN.test(name) && hasBankAndStatement;
}

export function getDocumentExclusionReason(
  document: Pick<Document, "filename" | "fileKey" | "fileType">,
): string | null {
  const name = documentSearchText(document);
  const isPdf =
    document.fileType.toLowerCase().includes("pdf") ||
    document.filename.toLowerCase().endsWith(".pdf") ||
    document.fileKey.toLowerCase().endsWith(".pdf");
  if (!isPdf) return "not a PDF";
  if (EXCLUSION_PATTERN.test(name)) {
    return "excluded by safety pattern (tax, return, license, ssn, id, or check)";
  }
  if (!/bank/i.test(name) || !/statement/i.test(name)) {
    return "filename/stored-type does not identify a bank statement";
  }
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

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  @page { size: A4; margin: 0; }
  body { margin: 0; padding: 42px 48px; color: #1f2937; font-family: Arial, sans-serif; }
  .header { border-bottom: 3px solid #1f4e79; padding-bottom: 20px; }
  .logo { min-height: 56px; margin-bottom: 24px; }
  h1 { color: #1f4e79; font-size: 29px; margin: 0 0 8px; }
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
    <div class="logo"></div>
    <h1>Financing Application Package</h1>
    ${row("Business", businessName)}
    ${row("Owner", ownerName)}
  </div>
  <div class="section">
    <h2>Application</h2>
    ${row("Application type", application.type)}
    ${row("Requested amount", requestedAmount)}
    ${row("Monthly revenue stated", displayMoney(application.monthlyRevenueStated))}
    ${row("Time in business", displayMonths(application.timeInBusinessMonths))}
    ${row("Submitted", submitted)}
  </div>
  ${assignedRep ? `
  <div class="section">
    <h2>Assigned representative</h2>
    ${row("Name", repName)}
    ${row("Email", assignedRep.email)}
    ${row("Phone", assignedRep.mobileNumber)}
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

function applicationBody(application: Application): Record<string, unknown> {
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
    timeInBusinessMonths: application.timeInBusinessMonths,
    monthlyRevenueStated: application.monthlyRevenueStated,
    requestedAmount: application.requestedAmount,
    useOfFunds: application.useOfFunds,
    equipmentDescription: application.equipmentDescription,
    vendorName: application.vendorName,
    vendorQuoteAmount: application.vendorQuoteAmount,
    equipmentCondition: application.equipmentCondition,
    ownerFirstName: application.ownerFirstName,
    ownerLastName: application.ownerLastName,
    ownerDob: application.ownerDob,
    ownerHomeAddress: application.ownerHomeAddress,
    ownerHomeCity: application.ownerHomeCity,
    ownerHomeState: application.ownerHomeState,
    ownerHomeZip: application.ownerHomeZip,
    ownershipPct: application.ownershipPct,
    consentCreditPull: application.consentCreditPull,
    consentTerms: application.consentTerms,
    signatureMethod: application.signatureMethod,
    signatureData: application.signatureData,
  };
}

function sortDocumentsForUploadOrder(documents: Document[]): Document[] {
  return [...documents].sort((a, b) => {
    const createdDelta = a.createdAt.valueOf() - b.createdAt.valueOf();
    return createdDelta || a.id - b.id;
  });
}

async function downloadStoredDocument(
  document: Document,
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

async function appendPages(target: PDFDocument, source: PDFDocument): Promise<void> {
  const pages = await target.copyPages(source, source.getPageIndices());
  for (const page of pages) target.addPage(page);
}

function safeFooterEmail(value: string | null): string {
  // StandardFonts.Helvetica uses WinAnsi; do not let a user-controlled
  // Unicode address make the entire package fail during footer generation.
  return (value ?? "").replace(/[^\x20-\x7E]/g, "");
}

async function addFooters(pdf: PDFDocument, repEmail: string | null): Promise<void> {
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pageCount = pdf.getPageCount();
  const safeEmail = safeFooterEmail(repEmail);
  const emailSuffix = safeEmail ? ` · ${safeEmail}` : "";
  for (let index = 0; index < pageCount; index++) {
    const page = pdf.getPage(index);
    const { width } = page.getSize();
    const footer = `Prepared by My Business Solutions${emailSuffix} · page ${index + 1} of ${pageCount}`;
    page.drawText(footer, {
      x: 30,
      y: 16,
      size: 7.5,
      font,
      color: rgb(0.39, 0.45, 0.52),
      maxWidth: Math.max(100, width - 60),
    });
  }
}

async function composePackage(
  cover: PDFDocument,
  signedApplication: PDFDocument,
  included: IncludedStatement[],
  exclusions: LenderPackageDocumentExclusion[],
  repEmail: string | null,
  render: (html: string) => Promise<Buffer>,
): Promise<Buffer> {
  const packagePdf = await PDFDocument.create();
  await appendPages(packagePdf, cover);
  await appendPages(packagePdf, signedApplication);
  for (const statement of included) {
    // Copy pages only. This intentionally does not copy attachments, forms, or
    // hidden document-level data from uploaded PDFs.
    try {
      await appendPages(packagePdf, statement.pdf);
    } catch (error) {
      // The caller discards this in-progress PDF and retries without the
      // statement. This prevents a copyPages/addPage failure from leaving
      // partially appended pages in the delivered package.
      throw new StatementCopyError(statement, error);
    }
  }
  if (exclusions.length > 0) {
    const notIncluded = await render(buildNotIncludedHtml(exclusions));
    const notIncludedPdf = await PDFDocument.load(notIncluded, {
      throwOnInvalidObject: false,
      updateMetadata: false,
    });
    await appendPages(packagePdf, notIncludedPdf);
  }
  await addFooters(packagePdf, repEmail);
  return Buffer.from(await packagePdf.save());
}

export async function buildLenderPackagePdf(params: {
  lead: Lead;
  application: Application;
  assignedRep: User | null;
  documents: Document[];
  renderPdf?: (html: string) => Promise<Buffer>;
  downloadDocument?: (document: Document, maxBytes: number) => Promise<Buffer>;
  /** Test-only output limit override; production uses the 40 MB constant. */
  maxPackageBytes?: number;
}): Promise<{ pdf: Buffer; exclusions: LenderPackageDocumentExclusion[] }> {
  const render = params.renderPdf ?? defaultRenderPdf;
  const download = params.downloadDocument ?? downloadStoredDocument;
  const baseUrl = getPublicBaseUrl();
  const coverHtml = ensureFlyerBranding(buildCoverHtml(params.lead, params.application, params.assignedRep), baseUrl);
  const signedHtml = buildSignedApplicationHtml({
    lead: {
      id: params.lead.id,
      firstName: params.application.ownerFirstName,
      lastName: params.application.ownerLastName,
    },
    body: applicationBody(params.application),
    submittedAt: params.application.submittedAt,
    signatureSignedAt: params.application.signatureSignedAt,
    clientIp: params.application.signatureIp,
  });
  const [coverBytes, signedBytes] = await Promise.all([render(coverHtml), render(signedHtml)]);
  const [cover, signedApplication] = await Promise.all([
    PDFDocument.load(coverBytes, { throwOnInvalidObject: false, updateMetadata: false }),
    PDFDocument.load(signedBytes, { throwOnInvalidObject: false, updateMetadata: false }),
  ]);

  const exclusions: LenderPackageDocumentExclusion[] = [];
  const included: IncludedStatement[] = [];
  let downloadedBytes = 0;

  for (const document of sortDocumentsForUploadOrder(params.documents)) {
    const name = displayDocumentName(document);
    const selectionReason = getDocumentExclusionReason(document);
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
        params.assignedRep?.email ?? null,
        render,
      );
    } catch (error) {
      if (!(error instanceof StatementCopyError)) throw error;
      const failedIndex = included.indexOf(error.statement);
      if (failedIndex >= 0) included.splice(failedIndex, 1);
      exclusions.push({
        filename: displayDocumentName(error.statement.document),
        reason: "could not be copied into the package",
      });
      continue;
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
  const render = overrides.renderPdf ?? defaultRenderPdf;
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
    });
    if (!application) {
      res.status(404).json({ error: "No application on file" });
      return;
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

    try {
      const { pdf } = await buildLenderPackagePdf({
        lead,
        application,
        assignedRep: assignedRep ?? null,
        documents,
        renderPdf: render,
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
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", String(pdf.length));
      res.send(pdf);
    } catch (error) {
      req.log?.error?.({ err: error }, "Failed to build lender package");
      if (error instanceof PackageSizeError) {
        res.status(413).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: "Lender package generation failed" });
    }
  };
}