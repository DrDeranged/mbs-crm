import { test } from "node:test";
import * as assert from "node:assert";
import { lenderToForm, formToPayload, emptyForm, type LenderFormData } from "./lender-form.ts";

test("emptyForm initializes default partner properties correctly", () => {
  const form = emptyForm();
  assert.strictEqual(form.partnerType, "direct_lender");
  assert.strictEqual(form.requiresFinancialStatements, false);
  assert.strictEqual(form.referralSplitPct, "");
});

test("lenderToForm correctly maps api data to form data", () => {
  const apiData = {
    name: "Acme Funding",
    partnerType: "broker_in",
    referralSplitPct: 45.5,
    requiresFinancialStatements: true,
    minAmount: 10000,
    acceptedIndustries: ["Retail"],
    restrictedIndustries: ["Trucking"],
  };

  const form = lenderToForm(apiData);
  assert.strictEqual(form.name, "Acme Funding");
  assert.strictEqual(form.partnerType, "broker_in");
  assert.strictEqual(form.referralSplitPct, "45.5");
  assert.strictEqual(form.requiresFinancialStatements, true);
  assert.strictEqual(form.minAmount, "10000");
  assert.strictEqual(form.acceptedIndustries, "Retail");
  assert.strictEqual(form.restrictedIndustries, "Trucking");
});

test("formToPayload correctly strips and transforms form data", () => {
  const form: LenderFormData = {
    ...emptyForm(),
    name: "Acme Funding",
    partnerType: "broker_in",
    referralSplitPct: "50",
    requiresFinancialStatements: true,
    minAmount: "50000",
    acceptedIndustries: "Retail, Food",
  };

  const payload = formToPayload(form);
  assert.strictEqual(payload.name, "Acme Funding");
  assert.strictEqual(payload.partnerType, "broker_in");
  assert.strictEqual(payload.referralSplitPct, 50);
  assert.strictEqual(payload.requiresFinancialStatements, true);
  assert.strictEqual(payload.minAmount, 50000);
  assert.deepStrictEqual(payload.acceptedIndustries, ["Retail", "Food"]);
});

test("formToPayload nullifies referralSplitPct for non-broker-in partners", () => {
  const form: LenderFormData = {
    ...emptyForm(),
    partnerType: "direct_lender",
    referralSplitPct: "50", // Should be ignored
  };

  const payload = formToPayload(form);
  assert.strictEqual(payload.partnerType, "direct_lender");
  assert.strictEqual(payload.referralSplitPct, null);
});