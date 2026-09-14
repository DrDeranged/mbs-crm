import assert from "node:assert/strict";
import test from "node:test";
import {
  applicationFieldStep,
  formatApplicationValidationError,
  formatEinTyping,
  humanizeApplicationField,
  parseApplicationResponse,
} from "./applicationValidation.ts";

test("formats EIN input as digits with a dash and a nine-digit limit", () => {
  assert.equal(formatEinTyping("1a234567890"), "12-3456789");
  assert.equal(formatEinTyping("12-345"), "12-345");
});

test("maps validation fields to steps and human labels", () => {
  assert.equal(applicationFieldStep("ein"), 2);
  assert.equal(applicationFieldStep("unknownField"), undefined);
  assert.equal(humanizeApplicationField("ownerSsn"), "Social Security number");
  assert.equal(
    formatApplicationValidationError("ein", "EIN must be in XX-XXXXXXX format").message,
    "Please fix: EIN — EIN must be in XX-XXXXXXX format",
  );
});

test("invalid response shapes become a normal submission error", () => {
  assert.equal(parseApplicationResponse(null), null);
  assert.equal(parseApplicationResponse("not an object"), null);
  assert.equal(parseApplicationResponse([]), null);
});

test("unknown response fields show only the sanitized server error", () => {
  const result = formatApplicationValidationError("futureField", "Server validation failed");
  assert.deepEqual(result, { message: "Server validation failed" });
  assert.equal(formatApplicationValidationError("futureField", "Invalid input").message, "Submission failed. Please try again.");
});

test("sanitizes the generic Invalid input message", () => {
  const result = formatApplicationValidationError("ownerSsn", "Invalid input");
  assert.notEqual(result.message, "Invalid input");
  assert.match(result.message, /Please fix: Social Security number/);
});