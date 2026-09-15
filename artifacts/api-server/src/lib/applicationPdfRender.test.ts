import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { buildApplicationFormHtml } from "./applicationPdf";
import { closeBrowser, renderPdf } from "./renderPdf";

test("application form renders as one US Letter PDF", async (t) => {
  const html = buildApplicationFormHtml({
    rep: {
      name: "Nate Ford",
      title: "CHIEF EXECUTIVE OFFICER",
      email: "nate@my-business-solutions.com",
      mobileNumber: "602.245.5425",
      slug: "nate",
    },
  });
  process.env["PUPPETEER_EXECUTABLE_PATH"] ??= "/repl/tools/bin/chromium";
  let pdfBytes: Buffer;
  try {
    pdfBytes = await renderPdf(html, { format: "Letter" });
  } catch (error) {
    if (error instanceof Error && /Could not find Chrome/.test(error.message)) {
      t.skip("Puppeteer Chrome is not installed in this environment");
      return;
    }
    throw error;
  }
  assert.equal(pdfBytes.subarray(0, 5).toString(), "%PDF-");
  const document = await PDFDocument.load(pdfBytes);
  assert.equal(document.getPageCount(), 1);
  const { width, height } = document.getPage(0).getSize();
  assert.equal(width, 612);
  assert.equal(height, 792);
  assert.match(html, /Nate Ford/);
  assert.match(html, /CHIEF EXECUTIVE OFFICER/);
  assert.match(html, /nate@my-business-solutions\.com/);
  assert.match(html, /app\.my-business-solutions\.com\/r\/nate/);
  await closeBrowser();
});

test("filled application with realistic values stays on one Letter page", async () => {
  const html = buildApplicationFormHtml({
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
  assert.equal((html.match(/\*\*\*-\*\*-\*\*\*\*/g) ?? []).length, 2);
  assert.match(html, /alexandra\.martinez@example\.com/);
  assert.match(html, /602-555-0199/);
  process.env["PUPPETEER_EXECUTABLE_PATH"] ??= "/repl/tools/bin/chromium";
  const pdfBytes = await renderPdf(html, { format: "Letter" });
  try {
    assert.equal(pdfBytes.subarray(0, 5).toString(), "%PDF-");
    const document = await PDFDocument.load(pdfBytes);
    assert.equal(document.getPageCount(), 1);
    const { width, height } = document.getPage(0).getSize();
    assert.equal(width, 612);
    assert.equal(height, 792);
  } finally {
    await closeBrowser();
  }
});