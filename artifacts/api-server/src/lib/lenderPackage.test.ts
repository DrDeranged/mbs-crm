import assert from "node:assert/strict";
import test, { mock } from "node:test";
import puppeteer from "puppeteer";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { PDFParse } from "pdf-parse";
import type { Request, Response } from "express";
import {
  buildLenderPackagePdf,
  createLenderPackageHandler,
  createSelectedLenderPackageHandler,
  getDocumentExclusionReason,
  getLenderRepEmail,
  isEligibleBankStatement,
  parseLenderPackageConfig,
  parsePersistedLenderPackageConfig,
  renderLenderPackageCoverPdf,
  sanitizeLenderPackageBusinessName,
  selectLenderPackageDocuments,
  renderLenderPackageOmissionReportPdf,
} from "./lenderPackage";

process.env.PUBLIC_APP_URL ??= "http://localhost";

test("lender-package route exposes safe renderer reason and logs the full error", async () => {
  const database = { query: {
    leadsTable: { findFirst: async () => baseLead() },
    applicationsTable: { findFirst: async () => baseApplication() },
    usersTable: { findFirst: async () => null },
    documentsTable: { findMany: async () => [] },
  } } as any;
  const response = fakeResponse();
  const logs: any[] = [];
  await createLenderPackageHandler({
    database,
    authenticate: async () => ({ id: 1, role: "admin" } as any),
    renderPdf: async () => { throw new Error("private renderer diagnostic"); },
    auditPiiAccess: () => {},
  })({ params: { id: "42" }, log: { error: (entry: unknown) => logs.push(entry) } } as unknown as Request, response as unknown as Response);
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, { error: "Lender package generation failed", reason: "renderer_unavailable" });
  assert.equal(logs.length, 1);
  assert.ok(logs[0].stack);
  assert.match(logs[0].err.cause.message, /private renderer diagnostic/);
});

test("lender-package route returns the no_application reason without rendering", async () => {
  const response = fakeResponse();
  await createLenderPackageHandler({
    database: { query: {
      leadsTable: { findFirst: async () => baseLead() },
      applicationsTable: { findFirst: async () => null },
    } } as any,
    authenticate: async () => ({ id: 1, role: "admin" } as any),
  })({ params: { id: "42" }, log: { error: () => {} } } as unknown as Request, response as unknown as Response);
  assert.equal(response.statusCode, 404);
  assert.equal((response.body as { reason: string }).reason, "no_application");
});

test("omission report paginates instead of failing on many excluded documents", async () => {
  const exclusions = Array.from({ length: 40 }, (_, i) => ({ filename: `corrupt-${i}.pdf`, reason: "not a readable PDF" }));
  const result = await renderLenderPackageOmissionReportPdf(exclusions);
  const pages = await extractPages(result);
  assert.ok(pages.length >= 3);
  const text = pages.join("\n");
  for (const exclusion of exclusions) assert.ok(text.includes(exclusion.filename));
});

test("native cover uses branded rep email and polished cover values", async () => {
  const rep = {
    id: 7,
    name: "Assigned Rep",
    title: "Senior Funding Advisor",
    email: "primary@example.com",
    alternateEmail: "assigned@my-business-solutions.com",
    mobileNumber: null,
  } as any;
  assert.equal(getLenderRepEmail(rep), "assigned@my-business-solutions.com");

  const cover = await renderLenderPackageCoverPdf({
    lead: baseLead(),
    application: baseApplication({
      type: "working_capital",
      submittedAt: new Date("2026-09-15T21:12:00.000Z"),
    }),
    assignedRep: rep,
  });
  const [page] = await extractPages(cover);
  assert.match(page!, /Senior Funding Advisor/);
  assert.match(page!, /assigned@my-business-solutions\.com/);
  assert.match(page!, /Working Capital/);
  assert.match(page!, /Sep 15, 2026, 5:12 PM ET/);
  assert.match(page!, /—/);
  assert.ok(!page!.includes("?"), "cover must not contain substituted question-mark glyphs");

  const document = await PDFDocument.load(cover);
  const resources = document.getPage(0).node.Resources();
  assert.ok(resources, "cover must have resources for the embedded MBS logo");
});

function baseLead(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    firstName: "Owner",
    lastName: "Example",
    companyName: "Example Company",
    email: "owner@example.com",
    phone: "602-555-0199",
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
    yearMakeModel: "2024 Caterpillar 299D3 XE",
    trucksInFleet: 14,
    downPaymentAmount: 85000,
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
    fileKey: "leads/42/documents/bankstatement-2025-01-bank-statement-january",
    fileType: "application/pdf",
    category: "bank_statement",
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

test("selection uses persisted document categories and orders underwriting documents", () => {
  assert.equal(sanitizeLenderPackageBusinessName(`Acme, "North" Café LLC`), "Acme-North-Caf-LLC");
  const taggedChase = documentRow({
    filename: "Chase_Checking_Statement_Jan.pdf",
    fileKey: "leads/42/documents/rep-upload-1",
    category: "bank_statement",
  });
  const manualTax = documentRow({
    filename: "Tax_Return_2025.pdf",
    fileKey: "leads/42/documents/manual-tax-return-2025.pdf",
    category: "other",
  });
  const taggedNonPdf = documentRow({
    filename: "Chase_Checking_Statement_Jan.txt",
    fileKey: "leads/42/documents/rep-upload-2",
    fileType: "text/plain",
    category: "bank_statement",
  });
  assert.equal(isEligibleBankStatement(taggedChase), true);
  assert.equal(isEligibleBankStatement(manualTax), false);
  assert.equal(isEligibleBankStatement(taggedNonPdf), false);
  assert.equal(
    getDocumentExclusionReason(taggedChase),
    null,
  );
  assert.equal(
    getDocumentExclusionReason(manualTax),
    "document category is not selected for lender packages",
  );
  assert.equal(
    getDocumentExclusionReason(taggedNonPdf),
    "not a PDF",
  );
  assert.deepEqual(
    selectLenderPackageDocuments([
      documentRow({ id: 4, category: "tax_return" }),
      documentRow({ id: 3, category: "bank_statement" }),
      documentRow({ id: 2, category: "drivers_license" }),
      documentRow({ id: 1, category: "invoice_quote" }),
      documentRow({ id: 5, category: "other" }),
    ]).map((document) => document.category),
    ["invoice_quote", "bank_statement", "drivers_license", "tax_return"],
  );
});

test("selected package honors unchecked cover/application sections and the caller's document order", async () => {
  const first = documentRow({ id: 1, filename: "first.pdf" });
  const second = documentRow({ id: 2, filename: "second.pdf" });
  const output = await buildLenderPackagePdf({
    lead: baseLead(), application: baseApplication(), assignedRep: null, documents: [first, second],
    selection: { sections: ["bank_statement"], documentIds: [2, 1], options: { includeFooter: false } },
    downloadDocument: async (document) => markerPdf(document.filename),
  });
  const pages = await extractPages(output.pdf);
  assert.equal(pages.length, 2);
  assert.match(pages[0]!, /second\.pdf/);
  assert.match(pages[1]!, /first\.pdf/);
  assert.ok(!pages.join(" ").includes("APPLICATION"));
});

test("selected package normalizes scrambled cross-category IDs but retains each category's chosen order", async () => {
  const bankFirst = documentRow({ id: 1, filename: "bank-first.pdf", category: "bank_statement" });
  const invoice = documentRow({ id: 2, filename: "invoice.pdf", category: "invoice_quote" });
  const bankSecond = documentRow({ id: 3, filename: "bank-second.pdf", category: "bank_statement" });
  const tax = documentRow({ id: 4, filename: "tax.pdf", category: "tax_return" });
  const output = await buildLenderPackagePdf({
    lead: baseLead(), application: baseApplication(), assignedRep: null, documents: [bankFirst, invoice, bankSecond, tax],
    selection: { sections: ["invoice_quote", "bank_statement", "tax_return"], documentIds: [4, 3, 2, 1], options: { includeFooter: false } },
    downloadDocument: async (document) => markerPdf(document.filename),
  });
  const text = (await extractPages(output.pdf)).join("\n");
  assert.ok(text.indexOf("invoice.pdf") < text.indexOf("bank-second.pdf"));
  assert.ok(text.indexOf("bank-second.pdf") < text.indexOf("bank-first.pdf"));
  assert.ok(text.indexOf("bank-first.pdf") < text.indexOf("tax.pdf"));
});

test("selected package rejects document IDs belonging to another lead", async () => {
  const response = fakeResponse();
  await createSelectedLenderPackageHandler({
    database: { query: {
      leadsTable: { findFirst: async () => baseLead() },
      applicationsTable: { findFirst: async () => baseApplication() },
      usersTable: { findFirst: async () => null },
      documentsTable: { findMany: async () => [documentRow({ id: 3 })] },
    } } as any,
    authenticate: async () => ({ id: 1, role: "admin" } as any),
  })({ params: { id: "42" }, body: { documentIds: [999] }, log: { error() {} } } as any, response as any);
  assert.equal(response.statusCode, 400);
  assert.match((response.body as any).error, /belong to this lead/);
});

test("lender-package rendering includes supplied primary and secondary owner SSNs", async () => {
  const application = baseApplication({ ownerSsnEncrypted: "ciphertext-not-rendered", secondaryOwnerName: "Second Owner" });
  const result = await buildLenderPackagePdf({
    lead: baseLead(), application, assignedRep: null, documents: [],
    selection: { sections: ["application"], documentIds: [], options: { includeFooter: false } },
    fullSsn: { ownerSsn: "123-45-6789", secondaryOwnerSsn: "987-65-4321" },
  });
  const text = (await extractPages(result.pdf)).join(" ");
  assert.match(text, /123-45-6789/);
  assert.match(text, /987-65-4321/);
});

test("the retired maskSsn input is rejected while legacy saved configs are normalized", () => {
  assert.equal(parseLenderPackageConfig({ options: { maskSsn: true } }), null);
  assert.deepEqual(
    parsePersistedLenderPackageConfig({ sections: ["application"], options: { maskSsn: true, includeFooter: false } }),
    { sections: ["application"], options: { includeFooter: false } },
  );
  assert.deepEqual(
    parsePersistedLenderPackageConfig({
      sections: ["bank_statement"],
      __lenderPackageSensitivity: { version: 1, ssnUnmasked: false },
    }),
    { sections: ["bank_statement"] },
  );
});

test("an assigned rep's selected-package route decrypts full SSNs and audits sensitivity without logging values", async () => {
  const oldKey = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = "a".repeat(64);
  try {
    const { encrypt } = await import("./encryption");
    const response = fakeResponse();
    let audit: any = null;
    await createSelectedLenderPackageHandler({
      database: {
        query: {
          leadsTable: { findFirst: async () => baseLead() },
          applicationsTable: { findFirst: async () => baseApplication({ ownerSsnEncrypted: encrypt("987-65-4321") }) },
          usersTable: { findFirst: async () => null },
          documentsTable: { findMany: async () => [] },
        },
        update: () => ({ set: () => ({ where: async () => undefined }) }),
      } as any,
      authenticate: async () => ({ id: 7, role: "rep" } as any),
      auditPiiAccess: (params) => { audit = params; },
      activityLogger: async () => undefined,
    })({ params: { id: "42" }, body: { sections: ["application"], options: { includeFooter: false } }, ip: "127.0.0.1", log: { error() {} } } as any, response as any);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["Cache-Control"], "private, no-store");
    assert.match((await extractPages(response.body as Buffer)).join(" "), /987-65-4321/);
    assert.deepEqual(audit, {
      userId: 7, leadId: 42, fieldCategory: "application", action: "export", ip: "127.0.0.1",
      metadata: { sections: ["application"], documentIds: [], options: { includeFooter: false }, ssnUnmasked: true },
    });
    assert.ok(!JSON.stringify(audit).includes("987-65-4321"));
  } finally {
    if (oldKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = oldKey;
  }
});

test("the standard lender-package download decrypts both owner SSNs only after lead authorization", async () => {
  const oldKey = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = "b".repeat(64);
  try {
    const { encrypt } = await import("./encryption");
    const response = fakeResponse();
    const audits: any[] = [];
    await createLenderPackageHandler({
      database: { query: {
        leadsTable: { findFirst: async () => baseLead() },
        applicationsTable: { findFirst: async () => baseApplication({
          ownerSsnEncrypted: encrypt("111-22-3333"),
          secondaryOwnerName: "Second Owner",
          secondaryOwnerSsnEncrypted: encrypt("444-55-6666"),
        }) },
        usersTable: { findFirst: async () => null },
        documentsTable: { findMany: async () => [] },
      } } as any,
      authenticate: async () => ({ id: 7, role: "rep" } as any),
      auditPiiAccess: (params) => { audits.push(params); },
    })({ params: { id: "42" }, ip: "127.0.0.1", log: { error() {} } } as any, response as any);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["Cache-Control"], "private, no-store");
    const pdfText = (await extractPages(response.body as Buffer)).join(" ");
    assert.match(pdfText, /111-22-3333/);
    assert.match(pdfText, /444-55-6666/);
    assert.equal(audits[0]?.metadata.ssnUnmasked, true);
    assert.ok(!JSON.stringify(audits).includes("111-22-3333"));
    assert.ok(!JSON.stringify(audits).includes("444-55-6666"));
  } finally {
    if (oldKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = oldKey;
  }
});

test("a selected package without the application section never decrypts SSNs", async () => {
  const response = fakeResponse();
  const audits: any[] = [];
  await createSelectedLenderPackageHandler({
    database: { query: {
      leadsTable: { findFirst: async () => baseLead() },
      applicationsTable: { findFirst: async () => baseApplication({ ownerSsnEncrypted: "not-valid-ciphertext" }) },
      usersTable: { findFirst: async () => null },
      documentsTable: { findMany: async () => [] },
    }, update: () => ({ set: () => ({ where: async () => undefined }) }) } as any,
    authenticate: async () => ({ id: 7, role: "rep" } as any),
    renderPdf: async () => markerPdf("cover-only"),
    auditPiiAccess: (params) => { audits.push(params); },
    activityLogger: async () => undefined,
  })({ params: { id: "42" }, body: { sections: ["cover"] }, ip: "127.0.0.1", log: { error() {} } } as any, response as any);
  assert.equal(response.statusCode, 200);
  assert.equal(audits[0]?.metadata.ssnUnmasked, false);
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
    assert.match(page, new RegExp(`Prepared by MBS.*page ${index + 1} of 4`));
  });
  const signedHtml = renderCalls.find((html) => html.includes("Signature Method"));
  assert.ok(signedHtml);
  assert.match(signedHtml, /Signature Method<\/td><td>typed/);
  assert.match(signedHtml, /Owner Example/);
  assert.match(signedHtml, /owner@example\.com/);
  assert.match(signedHtml, /602-555-0199/);
  assert.match(signedHtml, /2024 Caterpillar 299D3 XE/);
  assert.match(signedHtml, /class="field-value">14<\/div>/);
  assert.match(signedHtml, /\$85,000/);
  assert.match(signedHtml, /Dec 31, 2024, 7:01 PM ET/);
});

test("native package includes three rep-uploaded statements and an invoice with Puppeteer unavailable", async () => {
  const invoice = await markerPdf("INVOICE", 2);
  const statements = await Promise.all(["JAN", "FEB", "MAR"].map((month) => markerPdf(`STATEMENT_${month}`)));
  const launcher = mock.method(puppeteer, "launch", async () => {
    throw new Error("Chromium intentionally unavailable");
  });
  try {
    const result = await buildLenderPackagePdf({
      lead: baseLead(),
      application: baseApplication(),
      assignedRep: { id: 7, name: "Assigned Rep", email: "rep@example.com", mobileNumber: null } as any,
      documents: [
        documentRow({
          id: 1,
          filename: "equipment-invoice.pdf",
          fileKey: "leads/42/documents/rep-upload-invoice",
          category: "invoice_quote",
        }),
        ...["JAN", "FEB", "MAR"].map((month, index) => documentRow({
          id: index + 2,
          filename: `rep-upload-${month.toLowerCase()}.pdf`,
          fileKey: `leads/42/documents/rep-upload-${month.toLowerCase()}`,
          category: "bank_statement",
          createdAt: new Date(`2025-01-0${index + 2}T00:00:00.000Z`),
        })),
      ],
      downloadDocument: async (document) => {
        if (document.category === "invoice_quote") return invoice;
        return statements[document.id - 2]!;
      },
    });
    assert.equal(result.pdf.subarray(0, 5).toString("ascii"), "%PDF-");
    const pages = await extractPages(result.pdf);
    assert.equal(pages.length, 7, "cover + application + two invoice pages + three statements");
    assert.match(pages[2]!, /INVOICE page 1/);
    assert.match(pages[3]!, /INVOICE page 2/);
    assert.match(pages[4]!, /STATEMENT_JAN page 1/);
    assert.match(pages[5]!, /STATEMENT_FEB page 1/);
    assert.match(pages[6]!, /STATEMENT_MAR page 1/);
    pages.forEach((page, index) => {
      assert.match(page, new RegExp(`Prepared by MBS.*page ${index + 1} of 7`));
    });
  } finally {
    launcher.mock.restore();
  }
});

test("malformed and excluded files are skipped and every exclusion is named on the final page", async () => {
  const valid = await markerPdf("STATEMENT_VALID");
  const result = await buildLenderPackagePdf({
    lead: baseLead(),
    application: baseApplication(),
    assignedRep: { id: 7, name: "Assigned Rep", email: "rep@example.com", mobileNumber: null } as any,
    documents: [
      documentRow({ id: 1, filename: "bank-statement-january.pdf" }),
      documentRow({ id: 2, filename: "corrupt-bank-statement.pdf", createdAt: new Date("2025-01-02T00:00:00.000Z") }),
      documentRow({
        id: 3,
        filename: "Tax_Return_2025.txt",
        fileKey: "leads/42/documents/manual-tax-return-2025.txt",
        fileType: "text/plain",
        category: "tax_return",
        createdAt: new Date("2025-01-03T00:00:00.000Z"),
      }),
    ],
    downloadDocument: async (document) =>
      document.filename.startsWith("corrupt") ? Buffer.from("not a PDF") : valid,
  });

  const pages = await extractPages(result.pdf);
  assert.equal(pages.length, 4, "cover, application, valid statement, and exclusion page");
  assert.ok(pages[2].includes("STATEMENT_VALID"));
  assert.ok(pages[3].includes("corrupt-bank-statement.pdf"));
   assert.ok(pages[3].includes("Tax_Return_2025.txt"));
  assert.deepEqual(result.exclusions.map((item) => item.filename), [
    "corrupt-bank-statement.pdf",
     "Tax_Return_2025.txt",
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
    metadata: {
      sections: ["cover", "application", "invoice_quote", "bank_statement", "drivers_license", "tax_return", "other"],
      documentIds: [],
      options: { includeCoverPage: true, includeFooter: true },
      ssnUnmasked: false,
    },
  });
});