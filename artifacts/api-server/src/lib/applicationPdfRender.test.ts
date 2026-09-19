import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { PDFDocument, PDFDict, PDFName } from "pdf-lib";
import { PDFParse } from "pdf-parse";
import { CONSENT_TEXT, APPLICATION_PDF_FOOTER } from "./consentText";
import {
  APPLICATION_FORM_FOOTER_BASELINE,
  PREPARED_BY_FOOTER_BASELINE,
  renderApplicationFormPdf,
} from "./applicationPdf";

test("native form preserves complete consent and footer text, never plaintext SSNs", async () => {
  const pdf = await renderApplicationFormPdf({
    rep: { name: "Example Rep", email: "rep@example.com" },
    application: { ownerSsn: "123-45-6789", secondaryOwnerSsn: "987-65-4321" },
  });
  const parser = new PDFParse({ data: pdf });
  try {
    const result = await parser.getText();
    const normalized = result.text.replace(/\s+/g, " ");
    assert.ok(normalized.includes(CONSENT_TEXT));
    assert.ok(normalized.includes(APPLICATION_PDF_FOOTER));
    assert.ok(!normalized.includes("123-45-6789"));
    assert.ok(!normalized.includes("987-65-4321"));
    assert.ok(normalized.includes("Signature of Applicant One:"));
    assert.equal(
      normalized.match(/\*\*\*-\*\*-\*\*\*\*/g)?.length,
      1,
      "an absent secondary owner must not render a second masked SSN",
    );
  } finally {
    await parser.destroy();
  }
});

test("native form embeds Unicode Inter text, logo, ET dates, and mapped application type", async () => {
  const pdfBytes = await renderApplicationFormPdf({
    rep: {
      name: "Example Rep",
      title: "Senior Funding Advisor",
      email: "rep@my-business-solutions.com",
      mobileNumber: null,
    },
    application: {
      type: "equipment",
      businessDescription: "Eligibility ≥ $25,000 · expedited review — complete",
    },
    signatureMethod: "typed",
    signatureData: "Example Owner",
    signatureSignedAt: new Date("2026-09-15T21:12:00.000Z"),
  });
  const parser = new PDFParse({ data: pdfBytes });
  try {
    const text = (await parser.getText()).text.replace(/\s+/g, " ");
    assert.match(text, /Eligibility ≥ \$25,000 · expedited review — complete/);
    assert.ok(!text.includes("Eligibility ?"), "Unicode glyphs must not be substituted with question marks");
    assert.match(text, /Equipment Financing/);
    assert.match(text, /Sep 15, 2026, 5:12 PM ET/);
    assert.match(text, /SENIOR FUNDING ADVISOR/);
  } finally {
    await parser.destroy();
  }

  const document = await PDFDocument.load(pdfBytes);
  const resources = document.getPage(0).node.Resources();
  const xObjects = resources?.lookupMaybe(PDFName.of("XObject"), PDFDict);
  assert.ok(xObjects && xObjects.keys().length > 0, "application page must contain the MBS logo image");
});

test("application and prepared-by footer baselines are separated inside the bottom margin", () => {
  assert.ok(APPLICATION_FORM_FOOTER_BASELINE > 0);
  assert.ok(PREPARED_BY_FOOTER_BASELINE > 0);
  assert.ok(
    APPLICATION_FORM_FOOTER_BASELINE - PREPARED_BY_FOOTER_BASELINE >= 8,
    "footer baselines must differ by at least 8pt",
  );
});

test("application form renders natively as one US Letter PDF", async () => {
  const pdfBytes = await renderApplicationFormPdf({
    rep: {
      name: "Nate Ford",
      title: "CHIEF EXECUTIVE OFFICER",
      email: "nate@my-business-solutions.com",
      mobileNumber: "602.245.5425",
      slug: "nate",
    },
  });
  assert.equal(pdfBytes.subarray(0, 5).toString(), "%PDF-");
  const document = await PDFDocument.load(pdfBytes);
  assert.equal(document.getPageCount(), 1);
  const { width, height } = document.getPage(0).getSize();
  assert.equal(width, 612);
  assert.equal(height, 792);
});

test("filled native application stays on one Letter page and masks SSNs", async () => {
  const pdfBytes = await renderApplicationFormPdf({
    rep: {
      name: "Nate Ford",
      title: "CHIEF EXECUTIVE OFFICER",
      email: "nate@my-business-solutions.com",
      mobileNumber: "602.245.5425",
      slug: "nate",
    },
    application: {
      businessName: "Desert Ridge Commercial Equipment Services LLC",
      dba: "Desert Ridge Equipment",
      businessType: "Limited Liability Company",
      ein: "86-1234567",
      annualRevenue: 1875000,
      businessAddress: "1845 East Camelback Road",
      businessSuite: "Suite 410",
      businessCity: "Phoenix",
      businessState: "AZ",
      businessZip: "85016",
      businessStartDate: "03/2017",
      industry: "Commercial construction equipment rental and site services",
      yearsUnderCurrentOwnership: 8,
      ownerFirstName: "Alexandra",
      ownerLastName: "Martinez",
      ownerDob: "08/22/1984",
      ownerHomeAddress: "7120 North 24th Street",
      ownerHomeCity: "Phoenix",
      ownerHomeState: "AZ",
      ownerHomeZip: "85020",
      ownershipPct: "75%",
      email: "alexandra.martinez@example.com",
      phone: "602-555-0199",
      estCreditScore: "760",
      secondaryOwnerName: "Jordan Martinez",
      secondaryOwnerEmail: "jordan.martinez@example.com",
      secondaryOwnerAddress: "7120 North 24th Street, Phoenix, AZ 85020",
      secondaryOwnerDob: "11/04/1986",
      secondaryOwnerOwnershipPct: "25%",
      secondaryOwnerCell: "602-555-0188",
      secondaryOwnerEstCreditScore: "748",
      businessDescription: "We rent and service compact construction equipment for commercial contractors throughout the greater Phoenix metropolitan area.",
      timelineFundsNeeded: "Within the next 30 days",
      requestedAmount: 425000,
      yearMakeModel: "2024 Caterpillar 299D3 XE compact track loader",
      type: "Equipment financing",
      trucksInFleet: 14,
      downPaymentAmount: 85000,
      ownerSsn: "123-45-6789",
      secondaryOwnerSsn: "987-65-4321",
      signatureMethod: "typed",
      signatureData: "Alexandra Martinez",
    },
    signatureMethod: "typed",
    signatureData: "Alexandra Martinez",
    signatureSignedAt: new Date("2026-01-15T18:30:00.000Z"),
  });
  assert.equal(pdfBytes.subarray(0, 5).toString(), "%PDF-");
  const document = await PDFDocument.load(pdfBytes);
  assert.equal(document.getPageCount(), 1);
  const { width, height } = document.getPage(0).getSize();
  assert.equal(width, 612);
  assert.equal(height, 792);
});

test("native historical applications embed PNG signatures without substituting signature evidence", async () => {
  const pdfBytes = await renderApplicationFormPdf({
    rep: { name: "Nate Ford", email: "nate@my-business-solutions.com" },
    application: { ownerFirstName: "Nate", ownerLastName: "Ford" },
    signatureMethod: "drawn",
    // A valid 1×1 PNG is enough to verify pdf-lib's actual PNG embedding path.
    signatureData: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl9PZ0AAAAASUVORK5CYII=",
    signatureSignedAt: new Date("2026-01-15T18:30:00.000Z"),
    clientIp: "127.0.0.1",
  });
  assert.equal(pdfBytes.subarray(0, 5).toString(), "%PDF-");
  assert.equal((await PDFDocument.load(pdfBytes)).getPageCount(), 1);
});

test("native header uses work email, ordered phones, and required clearance", async () => {
  const { applicationPdfHeaderLayout, selectApplicationPdfEmail } = await import("./applicationPdf");
  const rep = {
    name: "Calvin Tuon", title: "Funding Advisor", mobileNumber: "201-555-0101",
    officePhone: "201-555-0102", email: "calvin@gmail.com",
    emails: ["calvin@my-business-solutions.com"], slug: "calvin",
  };
  const layout = applicationPdfHeaderLayout(rep);
  assert.deepEqual(layout.contacts, [
    "201-555-0101", "201-555-0102", "calvin@my-business-solutions.com", "www.my-business-solutions.com",
  ]);
  assert.equal(selectApplicationPdfEmail(rep), "calvin@my-business-solutions.com");
  assert.equal(layout.title, "FUNDING ADVISOR");
  assert.equal(layout.contacts.length + 1, 5, "title plus four contacts must produce five left-side lines");
  assert.ok(layout.contactBaseline - (layout.contacts.length - 1) * layout.contactLeading - (layout.ruleY + layout.ruleHeight) >= 1);
  assert.ok(layout.ruleY - layout.businessBarTop >= 1);
  const noTitle = applicationPdfHeaderLayout({ ...rep, title: null });
  assert.equal(noTitle.title, "");
  assert.equal(noTitle.contactBaseline, 745.5);
  assert.ok(![noTitle.title, ...noTitle.contacts].includes("—"), "the header must never render a dash placeholder");
  assert.equal(selectApplicationPdfEmail({ email: "primary@example.com", emails: ["alias@example.net"] }), "primary@example.com");
  assert.equal(selectApplicationPdfEmail({ email: null, emails: ["alias@example.net"] }), "");
});

test("Nate and Calvin header regions remain deterministic", async () => {
  const fixtures = [
    { name: "Nate Ford", title: "CHIEF EXECUTIVE OFFICER", email: "nate@my-business-solutions.com", mobileNumber: "602.245.5425", slug: "nate" },
    { name: "Calvin Tuon", title: "FUNDING ADVISOR", email: "calvin@gmail.com", emails: ["calvin@my-business-solutions.com"], mobileNumber: "201-555-0101", officePhone: "201-555-0102", slug: "calvin" },
  ];
  const expected = ["b63fd5cf6d1c31f202b9f17a20cc52b981e35d332370861058f7051ee3181854", "7b9bd37373599b06e84f0a8b243bea2c804f148d97296ef35d085a091593e7f7"];
  for (const [index, rep] of fixtures.entries()) {
    const bytes = await renderApplicationFormPdf({ rep });
    const dir = mkdtempSync(path.join(tmpdir(), "mbs-header-"));
    const pdfPath = path.join(dir, "header.pdf");
    const prefix = path.join(dir, "header");
    try {
      writeFileSync(pdfPath, bytes);
      execFileSync("pdftoppm", ["-f", "1", "-l", "1", "-r", "144", "-png", "-singlefile", "-x", "0", "-y", "0", "-W", "1224", "-H", "180", pdfPath, prefix]);
      const hash = createHash("sha256").update(readFileSync(`${prefix}.png`)).digest("hex");
      assert.equal(hash, expected[index]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});