import test from "node:test";
import assert from "node:assert/strict";
import { historicalSignal, rankDimensions, resolveRevenueFact } from "./underwritingIntelligence";

test("historical outcomes are a bounded explainable signal", () => {
  const history = historicalSignal(["approved", "funded", "declined"]);
  const ranked = rankDimensions({ matchScore: 80, history, requiredDocuments: ["Application", "Statements"] });
  assert.deepEqual(history, { submitted: 3, approved: 2, declined: 1, funded: 1, approvalRate: 67, fundingRate: 33 });
  assert.ok(ranked.approvalProbability <= 80);
  assert.ok(ranked.approvalProbability > 67);
  assert.equal(ranked.documentationBurden, 76);
});

test("unsupported economics stay null instead of being invented", () => {
  const ranked = rankDimensions({ matchScore: 90, history: historicalSignal([]) });
  assert.equal(ranked.customerPricing, null);
  assert.equal(ranked.fundingSpeed, null);
  assert.equal(ranked.mbsPayout, null);
});

test("bank-derived revenue keeps bank-statement provenance and source IDs", () => {
  const fact = resolveRevenueFact({
    averageMonthlyDeposits: 82_500,
    bankSources: [{ id: 11, documentId: 101 }, { id: 12, documentId: 102 }],
    applicationRevenue: 70_000,
    applicationId: 7,
  });
  assert.equal(fact.value, 82_500);
  assert.equal(fact.provenance.source, "bank_statement");
  assert.deepEqual(fact.provenance.sourceIds, [101, 102]);
  assert.match(fact.provenance.label, /2 extracted bank statements/);
});