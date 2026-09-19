import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types test runner resolves explicit .ts imports.
import { firstValidationError, parseApplicationSubmission } from "./applicationValidation.ts";

function validSubmission(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "equipment",
    businessName: "Example Business",
    ownerFirstName: "Alex",
    ownerLastName: "Example",
    equipmentDescription: "Forklift",
    consentCreditPull: "true",
    consentTerms: "true",
    signatureMethod: "typed",
    signatureData: "Alex Example",
    ...overrides,
  };
}

test("production parser accepts and normalizes a nine-digit EIN", () => {
  const result = parseApplicationSubmission(validSubmission({
    ein: "123456789",
    phone: "  (603) 803-1010  ",
  }));
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.ein, "12-3456789");
    assert.equal(result.data.phone, "(603) 803-1010");
  }
});

test("production parser accepts the optional collateral boolean and defaults it when omitted", () => {
  const omitted = parseApplicationSubmission(validSubmission());
  assert.equal(omitted.success, true);
  if (omitted.success) assert.equal(omitted.data.hasCollateral, undefined);
  const supplied = parseApplicationSubmission(validSubmission({ hasCollateral: "true" }));
  assert.equal(supplied.success, true);
  if (supplied.success) assert.equal(supplied.data.hasCollateral, "true");
});

test("production parser reports malformed EIN with its field and format message", () => {
  const result = parseApplicationSubmission(validSubmission({ ein: "12-345" }));
  assert.equal(result.success, false);
  if (!result.success) {
    const error = firstValidationError(result.error.issues);
    assert.equal(error.field, "ein");
    assert.match(error.message, /EIN must be/);
  }
});

test("production parser turns a malformed non-object body into a named validation error", () => {
  const result = parseApplicationSubmission(null);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(firstValidationError(result.error.issues).field, "type");
  }
});

test("production parser accepts a punctuated phone after trimming only", () => {
  const result = parseApplicationSubmission(validSubmission({
    phone: "  (603) 803-1010  ",
  }));
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.phone, "(603) 803-1010");
});

test("validation response never returns the literal Invalid input", () => {
  assert.notEqual(
    firstValidationError([{ path: ["ein"], message: "Invalid input" }]).message,
    "Invalid input",
  );
});

test("optional Section 1 fields remain optional and SSNs normalize to digits", () => {
  const result = parseApplicationSubmission(validSubmission({
    ownerSsn: "123-45-6789",
    secondaryOwnerSsn: "987-65-4321",
    businessType: "LLC",
    businessStartDate: "02/2020",
    estCreditScore: "650_699",
    yearMakeModel: "2024 Ford F-250",
  }));
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.ownerSsn, "123456789");
    assert.equal(result.data.secondaryOwnerSsn, "987654321");
  }
});

test("invalid optional business start date is rejected without making other optional fields required", () => {
  const result = parseApplicationSubmission(validSubmission({ businessStartDate: "2020-02" }));
  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(firstValidationError(result.error.issues).field, "businessStartDate");
  }
});