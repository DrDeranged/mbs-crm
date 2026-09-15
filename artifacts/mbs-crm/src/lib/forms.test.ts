import { test } from "node:test";
import * as assert from "node:assert";
import { parseNullableCurrency } from "./forms.ts";

test("parseNullableCurrency returns null for empty/whitespace", () => {
  assert.strictEqual(parseNullableCurrency(""), null);
  assert.strictEqual(parseNullableCurrency("   "), null);
  assert.strictEqual(parseNullableCurrency(undefined), null);
  assert.strictEqual(parseNullableCurrency(null), null);
});

test("parseNullableCurrency returns numeric value for valid inputs", () => {
  assert.strictEqual(parseNullableCurrency("100"), 100);
  assert.strictEqual(parseNullableCurrency("100.50"), 100.50);
  assert.strictEqual(parseNullableCurrency("0"), 0);
});

test("parseNullableCurrency returns null for non-numeric strings", () => {
  assert.strictEqual(parseNullableCurrency("abc"), null);
});