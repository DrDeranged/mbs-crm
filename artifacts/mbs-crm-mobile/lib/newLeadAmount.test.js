const assert = require("node:assert/strict");
const test = require("node:test");
const { parseRequestedAmount } = require("./newLeadAmount.ts");

test("normalizes an optional whole-dollar amount for online and queued lead creation", () => {
  assert.equal(parseRequestedAmount(""), undefined);
  assert.equal(parseRequestedAmount(" 50,000 "), 50000);
  assert.equal(parseRequestedAmount("2147483647"), 2147483647);
});

test("rejects malformed, fractional, negative, zero, and out-of-range amounts", () => {
  for (const value of ["1,,000", "12,34", "1.5", "-5", "0", "2147483648", "abc"]) {
    assert.throws(() => parseRequestedAmount(value), /Invalid requested amount/);
  }
});