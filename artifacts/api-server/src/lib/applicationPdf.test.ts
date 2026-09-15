import assert from "node:assert/strict";
import test from "node:test";
import { buildApplicationFormHtml } from "./applicationPdf";
import { APPLICATION_PDF_FOOTER, CONSENT_TEXT } from "./consentText";

test("blank application uses the rep identity and exact disclosure/footer", () => {
  const html = buildApplicationFormHtml({
    rep: {
      name: "Nate Ford",
      email: "nate@example.com",
      mobileNumber: "602.245.5425",
      slug: "nate",
      role: "rep",
    },
  });
  assert.match(html, /Nate Ford/);
  assert.match(html, /nate@example\.com/);
  assert.match(html, /app\.my-business-solutions\.com\/r\/nate/);
  assert.match(html, /Business Information/);
  assert.match(html, /Owner Information/);
  assert.match(html, /Financing Request/);
  assert.match(html, /class="field-grid business-grid"/);
  assert.match(html, /class="field-grid owner-grid"/);
  assert.match(html, /class="field-grid financing-grid"/);
  assert.doesNotMatch(html, /Signature unavailable/);
  assert.match(html, /signature-value/);
  const escapedConsent = CONSENT_TEXT
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;");
  assert.ok(html.includes(escapedConsent));
  assert.ok(html.includes(APPLICATION_PDF_FOOTER));
});

test("title is profile data and a blank title is not derived from role", () => {
  const titled = buildApplicationFormHtml({ rep: { name: "Rep", title: "CUSTOM TITLE", role: "admin" } });
  assert.match(titled, /CUSTOM TITLE/);
  const blank = buildApplicationFormHtml({ rep: { name: "Rep", title: null, role: "admin" } });
  assert.doesNotMatch(blank, /ADMINISTRATOR/);
});

test("filled application masks both SSNs and never emits encrypted or plaintext SSN fields", () => {
  const html = buildApplicationFormHtml({
    rep: { name: "Rep", email: "rep@example.com", slug: "rep", role: "rep" },
    application: {
      businessName: "Example LLC",
      ownerFirstName: "Owner",
      ownerSsnEncrypted: "ciphertext-principal",
      ownerSsn: "123-45-6789",
      secondaryOwnerName: "Second Owner",
      secondaryOwnerSsnEncrypted: "ciphertext-secondary",
      secondaryOwnerSsn: "987-65-4321",
    },
  });
  assert.equal((html.match(/\*\*\*-\*\*-\*\*\*\*/g) ?? []).length, 2);
  assert.doesNotMatch(html, /ciphertext-principal|ciphertext-secondary|123-45-6789|987-65-4321/);
});