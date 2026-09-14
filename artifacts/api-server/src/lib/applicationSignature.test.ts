import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node's strip-types test runner resolves explicit .ts imports.
import { buildSignedApplicationHtml, normalizeSignature, validateApplicationRules } from "./applicationSignature.ts";

test("typed signature accepts two trimmed characters", () => {
  assert.deepEqual(normalizeSignature("typed", " AB "), {
    success: true,
    method: "typed",
    data: "AB",
  });
});

test("typed signature rejects one character and names over 200 characters", () => {
  assert.equal(normalizeSignature("typed", "A").success, false);
  assert.equal(normalizeSignature("typed", "x".repeat(201)).success, false);
});

test("drawn signature accepts safe PNG data URLs and rejects malformed/non-image values", () => {
  assert.equal(normalizeSignature("drawn", "data:image/png;base64,AAAA").success, true);
  assert.equal(normalizeSignature("drawn", "").success, false);
  assert.equal(normalizeSignature("drawn", "data:image/png;base64,not valid!").success, false);
  assert.equal(normalizeSignature("drawn", "data:text/html;base64,PGh0bWw+").success, false);
});

test("application rules enforce consents and equipment description without requiring vendor", () => {
  assert.deepEqual(validateApplicationRules({
    type: "equipment",
    equipmentDescription: "Forklift",
    consentCreditPull: true,
    consentTerms: true,
  }), []);
  assert.equal(validateApplicationRules({
    type: "equipment",
    consentCreditPull: true,
    consentTerms: true,
  })[0]?.field, "equipmentDescription");
  assert.deepEqual(
    validateApplicationRules({ type: "working_capital", equipmentDescription: "", vendorName: "" }),
    [
      { field: "consentCreditPull", error: "Credit pull consent is required" },
      { field: "consentTerms", error: "Terms consent is required" },
    ],
  );
});

test("signed application HTML escapes injection strings and signature metadata", () => {
  const html = buildSignedApplicationHtml({
    lead: { id: 1, firstName: "<lead>", lastName: "Name" },
    body: {
      businessName: "<script>alert(1)</script>",
      timeInBusinessMonths: "<img src=x>",
      signatureMethod: "typed",
      signatureData: "<svg onload=alert(1)>",
      consentCreditPull: true,
      consentTerms: true,
    },
    submittedAt: new Date("2025-01-01T00:00:00.000Z"),
    signatureSignedAt: new Date("2025-01-02T00:00:00.000Z"),
    clientIp: "<script>alert(2)</script>",
  });
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x&gt; months/);
  assert.match(html, /&lt;svg onload=alert\(1\)&gt;/);
  assert.match(html, /&lt;script&gt;alert\(2\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
});

test("legacy applications do not invent a signature method or signed timestamp", () => {
  const html = buildSignedApplicationHtml({
    lead: { id: 2, firstName: "Legacy", lastName: "Applicant" },
    body: {
      businessName: "Legacy Company",
      signatureMethod: null,
      signatureData: null,
      consentCreditPull: true,
      consentTerms: true,
    },
    submittedAt: new Date("2025-01-01T00:00:00.000Z"),
    signatureSignedAt: null,
    clientIp: null,
  });
  assert.match(html, /Signature Method<\/td><td>Unavailable/);
  assert.match(html, /Signature Signed At<\/td><td>Unavailable/);
  assert.match(html, /Signature unavailable/);
  assert.doesNotMatch(html, /Signature Method<\/td><td>drawn/);
  assert.doesNotMatch(html, /Signature Signed At<\/td><td>Wed, 01 Jan 2025/);
});