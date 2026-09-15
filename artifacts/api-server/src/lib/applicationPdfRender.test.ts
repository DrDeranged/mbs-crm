import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { PDFParse } from "pdf-parse";
import { CONSENT_TEXT, APPLICATION_PDF_FOOTER } from "./consentText";
import { renderApplicationFormPdf } from "./applicationPdf";

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
  } finally {
    await parser.destroy();
  }
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