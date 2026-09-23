import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLenderAiContext,
  buildLenderAiPrompt,
  filterLenderAiRecommendations,
  validateLenderRecommendationText,
  buildLenderAiCandidatesFromMatches,
} from "./lenderAiContext";

test("context carries criteria, provenance, stipulations, and points", () => {
  const context = buildLenderAiContext([{
    lenderId: 1,
    lenderName: "Maxim",
    criteriaBreakdown: [
      { criterion: "Industry", passed: true, value: "trucking", detail: "Accepted" },
      { criterion: "Unknown score", passed: false, value: null, detail: "unknown" },
    ],
    provenance: ["LENDER_SEED_SPEC_MAXIM.md line 12"],
    stipulations: ["Business-account statements"],
    points: 3,
    dimensions: { turnaroundBusinessDays: null, approvalTier: "C1" },
  }]);

  assert.deepEqual(context.candidates[0], {
    lenderId: 1,
    lenderName: "Maxim",
    criteriaBreakdown: [{ criterion: "Industry", passed: true, value: "trucking", detail: "Accepted" }],
    provenance: ["LENDER_SEED_SPEC_MAXIM.md line 12"],
    stipulations: ["Business-account statements"],
    points: 3,
    documentGaps: [],
    dimensions: { approvalTier: "C1" },
  });
});

test("prompt forbids ranking unknown dimensions and requires citations", () => {
  const prompt = buildLenderAiPrompt([{
    lenderId: "a",
    lenderName: "Lender A",
    criteriaBreakdown: [{ criterion: "Credit", passed: true, value: 600 }],
    stipulations: [],
    dimensions: { points: null },
  }]);
  assert.match(prompt, /Null or omitted dimensions are unknown/);
  assert.match(prompt, /criterion citation/);
  assert.doesNotMatch(prompt, /"points":null/);
});

test("recommendations without a criterion or exact document gap are rejected", () => {
  const context = buildLenderAiContext([{
    lenderId: 1,
    lenderName: "Maxim",
    criteriaBreakdown: [{ criterion: "Industry", passed: true, value: "trucking" }],
    documentGaps: ["Business-account statements"],
  }]);
  const accepted = filterLenderAiRecommendations([
    { lenderId: 1, recommendation: "Review this option.", criterion: "Industry", documentGap: "Business-account statements" },
  ], context);
  assert.equal(accepted.length, 1);
  assert.equal(filterLenderAiRecommendations([
    { lenderId: 1, recommendation: "Looks good.", criterion: "Missing criterion" },
    { lenderId: 1, recommendation: "Review.", criterion: "Industry", documentGap: "Invoice" },
  ], context).length, 0);
});

test("free-text context is redacted before it reaches the prompt", () => {
  const context = buildLenderAiContext([{
    lenderId: 1,
    lenderName: "Rep 555-123-4567",
    criteriaBreakdown: [{ criterion: "Note", passed: true, value: "safe", detail: "Call 555-123-4567" }],
    provenance: ["email rep@example.com"],
    stipulations: ["Send to 123 Main Street 90210"],
  }]);
  const serialized = JSON.stringify(context);
  assert.doesNotMatch(serialized, /555-123-4567|rep@example\.com|123 Main Street|90210/);
});

test("text recommendations must cite criteria and available document gaps", () => {
  const context = buildLenderAiContext([{
    lenderId: 1,
    lenderName: "Maxim",
    criteriaBreakdown: [{ criterion: "Credit score", passed: true, value: 600 }],
    documentGaps: ["Business bank statements"],
  }]);
  assert.ok(validateLenderRecommendationText([
    "Review the lender. [Criterion: Credit score] [Document gap: Business bank statements]",
    "Confirm details. [Criterion: Credit score] [Document gap: Business bank statements]",
  ], context));
  assert.equal(validateLenderRecommendationText([
    "Review the lender. [Criterion: Credit score]",
    "Confirm details. [Criterion: Credit score]",
  ], context), null);
});

test("document readiness uses categories and preserves personal/joint document gaps", () => {
  const [candidate] = buildLenderAiCandidatesFromMatches([{
    lenderId: 1,
    lender: {
      name: "Maxim",
      requiredDocuments: ["3 months business bank statements", "vendor invoice"],
    },
    criteriaBreakdown: [],
  }], [
    { category: "bank_statement", label: "January personal statement", accountType: "personal" },
    { category: "invoice_quote", label: "Quote upload" },
  ]);
  assert.deepEqual(candidate?.documentGaps, [
    "Document Gap: business bank statements are flagged personal/joint",
  ]);
});

test("unknown required document remains a gap unless its exact label is present", () => {
  const [candidate] = buildLenderAiCandidatesFromMatches([{
    lenderId: 1,
    lender: { name: "Lender", requiredDocuments: ["CDL copy"] },
    criteriaBreakdown: [],
  }], [{ category: "other", label: "business license" }]);
  assert.deepEqual(candidate?.documentGaps, ["CDL copy"]);
});