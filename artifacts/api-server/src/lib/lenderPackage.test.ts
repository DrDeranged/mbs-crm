import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { PDFParse } from "pdf-parse";
import type { Request, Response } from "express";
import {
  buildLenderPackagePdf,
  createLenderPackageHandler,
  getDocumentExclusionReason,
  sanitizeLenderPackageBusinessName,
} from "./lenderPackage";

process.env.PUBLIC_APP_URL ??= "http://localhost";

function baseLead(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    firstName: "Owner",
    lastName: "Example",
    companyName: "Example Company",
    requestedAmount: null,
    assignedRepId: 7,
    ...overrides,
  } as any;
}

function baseApplication(overrides: Record<string, unknown> = {}) {
  return {
    id: 99,
    leadId: 42,
    type: "working_capital",
    businessName: "Example Company",
    ownerFirstName: "Owner",
    ownerLastName: "Example",
    submittedAt: new Date("2025-01-01T00:00:00.000Z"),
    signatureMethod: "typed",
    signatureData: "Owner Example",
    signatureSignedAt: new Date("2025-01-01T00:01:00.000Z"),
    signatureIp: "127.0.0.1",
    requestedAmount: 100000,
    monthlyRevenueStated: 25000,
    timeInBusinessMonths: 24,
    consentCreditPull: true,
    consentTerms: true,
    ...overrides,
  } as any;
}

function documentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    leadId: 42,
    userId: null,
    filename: "bank-statement-january.pdf",
    fileKey: "leads/42/documents/bank-statement-january.pdf",
    fileType: "application/pdf",
    fileSize: 100,
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    ...overrides,
  } as any;
}

async function markerPdf(marker: string, pageCount = 1): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < pageCount; index++) {
    const page = pdf.addPage();
    page.drawText(`${marker} page ${index + 1}`, { x: 40, y: 700, size: 16, font });
  }
  return Buffer.from(await pdf.save());
}

async function extractPages(bytes: Buffer): Promise<string[]> {
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getText();
    return result.pages.map((page) => page.text);
  } finally {
    await parser.destroy();
  }
}

function markerRenderer(calls: string[]) {
  return async (html: string): Promise<Buffer> => {
    calls.push(html);
    if (html.includes("Documents not included")) {
      const names = [...html.matchAll(/<strong>([^<]*)<\/strong>/g)].map((match) => match[1]).join(" ");
      return markerPdf(`NOT_INCLUDED ${names}`);
    }
    return markerPdf(html.includes("Signature Method") ? "APPLICATION" : "COVER");
  };
}

function fakeResponse() {
  const response = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: null as unknown,
    status(code: number) {
      response.statusCode = code;
      return response;
    },
    json(body: unknown) {
      response.body = body;
      return response;
    },
    setHeader(name: string, value: string) {
      response.headers[name] = value;
      return response;
    },
    send(body: unknown) {
      response.body = body;
      return response;
    },
  };
  return response;
}

test("selection requires explicit bank and statement terms, and exclusions are substring based", () => {
  assert.equal(sanitizeLenderPackageBusinessName(`Acme, "North" Café LLC`), "Acme-North-Caf-LLC");
  assert.equal(
    getDocumentExclusionReason(documentRow({ filename: "2024-taxreturn.pdf" })),
    "excluded by safety pattern (tax, return, license, ssn, id, or check)",
  );
  assert.equal(
    getDocumentExclusionReason(documentRow({ filename: "voidedcheck-photoID.pdf" })),
    "excluded by safety pattern (tax, return, license, ssn, id, or check)",
  );
  assert.equal(
    getDocumentExclusionReason(documentRow({ filename: "monthly-statement.pdf" })),
    "filename/stored-type does not identify a bank statement",
  );
  assert.equal(getDocumentExclusionReason(documentRow({ filename: "BANKSTATEMENT-JANUARY.PDF" })), null);
  assert.equal(
    getDocumentExclusionReason(documentRow({ filename: "bank-account-overview.pdf" })),
    "filename/stored-type does not identify a bank statement",
  );
});

test("baseline application has two pages; exactly two statements append in upload order with safe footers", async () => {
  const renderCalls: string[] = [];
  const render = markerRenderer(renderCalls);
  const baseline = await buildLenderPackagePdf({
    lead: baseLead(),
    application: baseApplication(),
    assignedRep: { id: 7, name: "Assigned Rep", email: "rep@example.com", mobileNumber: "555-0100" } as any,
    documents: [],
    renderPdf: render,
    downloadDocument: async () => {
      throw new Error("no documents should be downloaded");
    },
  });
  const statementJanuary = await markerPdf("STATEMENT_JANUARY");
  const statementFebruary = await markerPdf("STATEMENT_FEBRUARY");
  const withTwoStatements = await buildLenderPackagePdf({
    lead: baseLead(),
    application: baseApplication(),
    assignedRep: { id: 7, name: "Assigned Rep", email: "rep@example.com", mobileNumber: "555-0100" } as any,
    documents: [
      documentRow({ id: 1, filename: "bank-statement-january.pdf" }),
      documentRow({
        id: 2,
        filename: "bank-statement-february.pdf",
        createdAt: new Date("2025-01-02T00:00:00.000Z"),
      }),
    ],
    renderPdf: render,
    downloadDocument: async (document) =>
      document.filename.includes("february") ? statementFebruary : statementJanuary,
  });

  const baselinePages = await extractPages(baseline.pdf);
  const packagePages = await extractPages(withTwoStatements.pdf);
  assert.equal(baselinePages.length, 2, "cover and signed application are the baseline");
  assert.equal(packagePages.length, baselinePages.length + 2, "exactly two eligible statements add exactly two pages");
  assert.deepEqual(
    packagePages.map((page) => page.split("\n")[0]),
    ["COVER page 1", "APPLICATION page 1", "STATEMENT_JANUARY page 1", "STATEMENT_FEBRUARY page 1"],
  );
  packagePages.forEach((page, index) => {
    assert.match(page, new RegExp(`Prepared by My Business Solutions.*page ${index + 1} of 4`));
  });
  const signedHtml = renderCalls.find((html) => html.includes("Signature Method"));
  assert.ok(signedHtml);
  assert.match(signedHtml, /Signature Method<\/td><td>typed/);
  assert.match(signedHtml, /Owner Example/);
  assert.match(signedHtml, /Wed, 01 Jan 2025 00:01:00 GMT/);
});

test("malformed and excluded files are skipped and every exclusion is named on the final page", async () => {
  const renderCalls: string[] = [];
  const valid = await markerPdf("STATEMENT_VALID");
  const result = await buildLenderPackagePdf({
    lead: baseLead(),
    application: baseApplication(),
    assignedRep: { id: 7, name: "Assigned Rep", email: "rep@example.com", mobileNumber: null } as any,
    documents: [
      documentRow({ id: 1, filename: "bank-statement-january.pdf" }),
      documentRow({ id: 2, filename: "corrupt-bank-statement.pdf", createdAt: new Date("2025-01-02T00:00:00.000Z") }),
      documentRow({ id: 3, filename: "taxreturn.pdf", createdAt: new Date("2025-01-03T00:00:00.000Z") }),
    ],
    renderPdf: markerRenderer(renderCalls),
    downloadDocument: async (document) =>
      document.filename.startsWith("corrupt") ? Buffer.from("not a PDF") : valid,
  });

  const pages = await extractPages(result.pdf);
  assert.equal(pages.length, 4, "cover, application, valid statement, and exclusion page");
  assert.ok(pages[2].includes("STATEMENT_VALID"));
  assert.ok(pages[3].includes("corrupt-bank-statement.pdf"));
  assert.ok(pages[3].includes("taxreturn.pdf"));
  assert.deepEqual(result.exclusions.map((item) => item.filename), [
    "corrupt-bank-statement.pdf",
    "taxreturn.pdf",
  ]);
  pages.forEach((page, index) => assert.match(page, new RegExp(`page ${index + 1} of 4`)));
});

test("statement copy failures become exclusions without partially appended pages", async () => {
  const originalCopyPages = (PDFDocument.prototype as any).copyPages;
  let copyCalls = 0;
  (PDFDocument.prototype as any).copyPages = async function (...args: unknown[]) {
    copyCalls += 1;
    if (copyCalls === 3) throw new Error("simulated statement copy failure");
    return originalCopyPages.apply(this, args);
  };
  try {
    const result = await buildLenderPackagePdf({
      lead: baseLead(),
      application: baseApplication(),
      assignedRep: null,
      documents: [documentRow()],
      renderPdf: markerRenderer([]),
      downloadDocument: async () => markerPdf("STATEMENT"),
    });
    const pages = await extractPages(result.pdf);
    assert.equal(pages.length, 3, "cover, application, and the exclusion page");
    assert.ok(pages[2].includes("bank-statement-january.pdf"));
    assert.deepEqual(result.exclusions.map((item) => item.reason), ["could not be copied into the package"]);
  } finally {
    (PDFDocument.prototype as any).copyPages = originalCopyPages;
  }
});

test("a configurable small package cap prunes the largest statement", async () => {
  const small = await markerPdf("SMALL_STATEMENT");
  const large = await markerPdf("LARGE_STATEMENT", 40);
  const documents = [
    documentRow({ id: 1, filename: "bank-statement-small.pdf" }),
    documentRow({
      id: 2,
      filename: "bank-statement-large.pdf",
      createdAt: new Date("2025-01-02T00:00:00.000Z"),
    }),
  ];
  const build = (maxPackageBytes?: number) =>
    buildLenderPackagePdf({
      lead: baseLead(),
      application: baseApplication(),
      assignedRep: null,
      documents,
      renderPdf: markerRenderer([]),
      downloadDocument: async (document) =>
        document.filename.includes("large") ? large : small,
      maxPackageBytes,
    });
  const full = await build(Number.MAX_SAFE_INTEGER);
  const pruned = await build(full.pdf.length - 1);
  const pages = await extractPages(pruned.pdf);
  assert.ok(pruned.exclusions.some((item) => item.filename === "bank-statement-large.pdf"));
  assert.ok(pages.some((page) => page.includes("SMALL_STATEMENT")));
  assert.ok(!pages.some((page) => page.includes("LARGE_STATEMENT")));
});

test("failed oversized transfers debit actual bytes and stop later downloads", async () => {
  const documents = [
    documentRow({ id: 1, filename: "bank-statement-overflow.pdf" }),
    documentRow({
      id: 2,
      filename: "bank-statement-never-downloaded.pdf",
      createdAt: new Date("2025-01-02T00:00:00.000Z"),
    }),
  ];
  const attempts: number[] = [];
  const result = await buildLenderPackagePdf({
    lead: baseLead(),
    application: baseApplication(),
    assignedRep: null,
    documents,
    renderPdf: markerRenderer([]),
    downloadDocument: async (_document, maxBytes) => {
      attempts.push(maxBytes);
      const error = new Error("stream exceeded hard budget") as Error & { bytesTransferred: number };
      error.bytesTransferred = maxBytes + 1;
      throw error;
    },
  });

  assert.deepEqual(attempts, [100 * 1024 * 1024]);
  assert.deepEqual(result.exclusions.map((item) => item.filename), [
    "bank-statement-overflow.pdf",
    "bank-statement-never-downloaded.pdf",
  ]);
  assert.equal(result.exclusions[1]?.reason, "skipped because the package source download budget was reached");
});

test("rep access uses the documents route's 403 denial semantics", async () => {
  const database = {
    query: {
      leadsTable: { findFirst: async () => baseLead({ assignedRepId: 8 }) },
      applicationsTable: { findFirst: async () => baseApplication() },
      documentsTable: { findMany: async () => [] },
      usersTable: { findFirst: async () => null },
    },
  } as any;
  const response = fakeResponse();
  const handler = createLenderPackageHandler({
    database,
    authenticate: async () => ({ id: 7, role: "rep" } as any),
  });
  await handler({ params: { id: "42" } } as unknown as Request, response as unknown as Response);
  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.body, { error: "Forbidden" });
});

test("admin can download any lead, audits the successful export, and sanitizes Unicode footer email", async () => {
  const database = {
    query: {
      leadsTable: { findFirst: async () => baseLead({ assignedRepId: 8 }) },
      applicationsTable: { findFirst: async () => baseApplication() },
      documentsTable: { findMany: async () => [] },
      usersTable: { findFirst: async () => ({ id: 8, name: "Assigned Rep", email: "rèp😀@example.com", mobileNumber: null }) },
    },
  } as any;
  const response = fakeResponse();
  const auditCalls: unknown[] = [];
  const handler = createLenderPackageHandler({
    database,
    authenticate: async () => ({ id: 1, role: "admin" } as any),
    renderPdf: async () => markerPdf("APPLICATION"),
    auditPiiAccess: (event) => auditCalls.push(event),
  });
  await handler(
    { params: { id: "42" }, ip: "127.0.0.1" } as unknown as Request,
    response as unknown as Response,
  );
  assert.equal(response.statusCode, 200);
  assert.ok(Buffer.isBuffer(response.body));
  assert.equal((response.body as Buffer).subarray(0, 5).toString("ascii"), "%PDF-");
  assert.match(response.headers["Content-Disposition"], /MBS-Application-Example-Company-42\.pdf/);
  assert.equal(auditCalls.length, 1);
  assert.deepEqual(auditCalls[0], {
    userId: 1,
    leadId: 42,
    fieldCategory: "application",
    action: "export",
    ip: "127.0.0.1",
  });
});