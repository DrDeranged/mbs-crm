import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLeadVertical, parseCsvRows, resolveLeadImportValue } from "./leadImport";

test("CSV lead import parser keeps vertical column values", () => {
  const [row] = parseCsvRows("First Name,Vertical,Email\nAda,Trucking,ada@example.com");
  assert.deepEqual(row, {
    "First Name": "Ada",
    Vertical: "Trucking",
    Email: "ada@example.com",
  });
});

test("lead import resolves an explicitly mapped vertical source column", () => {
  const row = { business_type: "Yellow Iron" };
  const value = resolveLeadImportValue(row, { vertical: "business_type" }, "vertical");
  assert.equal(normalizeLeadVertical(value), "yellow_iron");
});

test("known verticals normalize to canonical values and unknown values remain intact", () => {
  assert.equal(normalizeLeadVertical("Trucking"), "trucking");
  assert.equal(normalizeLeadVertical("Restaurants"), "restaurants");
  assert.equal(normalizeLeadVertical("amusement park"), "amusement");
  assert.equal(normalizeLeadVertical("General"), "general");
  assert.equal(normalizeLeadVertical("Specialty manufacturing"), "Specialty manufacturing");
  assert.equal(normalizeLeadVertical("  "), null);
});