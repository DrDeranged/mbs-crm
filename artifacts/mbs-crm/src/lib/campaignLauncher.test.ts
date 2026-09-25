import assert from "node:assert/strict";
import test from "node:test";
import { campaignValuesChanged, canConfirmCampaignLaunch, explainEmptyAudience, getCampaignReadiness, isCampaignPreviewFresh, serializeAudienceRules, validateCampaignFlyerFile } from "./campaignLauncher.ts";

test("campaign flyer validation accepts supported files and rejects invalid type, size, and empty files", () => {
  assert.equal(validateCampaignFlyerFile({ type: "image/webp", size: 1024 } as File), null);
  assert.match(validateCampaignFlyerFile({ type: "image/svg+xml", size: 1024 } as File) || "", /PNG/);
  assert.match(validateCampaignFlyerFile({ type: "application/pdf", size: 16 * 1024 * 1024 } as File) || "", /15 MB/);
  assert.match(validateCampaignFlyerFile({ type: "image/png", size: 0 } as File) || "", /15 MB/);
});

test("audience rules serialize guided control values into the API contract", () => {
  assert.deepEqual(serializeAudienceRules({
    statuses: ["new_lead"], programTypes: ["equipment"], assignedRepId: "42",
    leadSources: ["website"], createdFrom: "2026-01-01", createdTo: "",
    minAmount: "10000", maxAmount: "", pickedLeadIds: [18, 24, 18],
  }), {
    statuses: ["new_lead"], programTypes: ["equipment"], assignedRepId: 42,
    leadSources: ["website"], createdFrom: "2026-01-01", createdTo: null,
    minAmount: 10000, maxAmount: null, pickedLeadIds: [18, 24],
  });
});

test("preview freshness requires a matching saved version and token", () => {
  assert.equal(isCampaignPreviewFresh({ dirty: false, previewedVersion: 3, campaignVersion: 3, previewToken: "token" }), true);
  assert.equal(isCampaignPreviewFresh({ dirty: true, previewedVersion: 3, campaignVersion: 3, previewToken: "token" }), false);
  assert.equal(isCampaignPreviewFresh({ dirty: false, previewedVersion: 2, campaignVersion: 3, previewToken: "token" }), false);
  assert.equal(isCampaignPreviewFresh({ dirty: false, previewedVersion: 3, campaignVersion: 3 }), false);
});

test("readiness reports every exact blocker instead of only disabling approval", () => {
  const readiness = getCampaignReadiness({
    status: "draft", dirty: true, previewFresh: false, eligibleCount: undefined,
    requiresEmailTemplate: true, hasTemplate: true, templateActive: false, claimsAffirmed: false,
  });
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.blockers.map((item) => item.code), [
    "unsaved_changes", "missing_preview", "inactive_template", "claims_affirmation",
  ]);
});

test("a fresh zero-recipient preview blocks approval and explains filters versus eligibility", () => {
  const readiness = getCampaignReadiness({
    status: "draft", dirty: false, previewFresh: true, eligibleCount: 0,
    requiresEmailTemplate: true, hasTemplate: true, templateActive: true, claimsAffirmed: true,
  });
  assert.deepEqual(readiness.blockers.map((item) => item.code), ["empty_audience"]);
  assert.match(explainEmptyAudience(0, 0), /filters/);
  assert.match(explainEmptyAudience(3, 3), /contact, consent, suppression/);
});

test("complete saved content, active template, fresh non-empty preview, and affirmation are ready", () => {
  assert.deepEqual(getCampaignReadiness({
    status: "draft", dirty: false, previewFresh: true, eligibleCount: 12,
    requiresEmailTemplate: true, hasTemplate: true, templateActive: true, claimsAffirmed: true,
  }), { ready: true, blockers: [] });
});

test("campaign dirty state ignores object key order but detects a real edit", () => {
  const saved = { name: "Campaign", audienceRules: { statuses: ["new_lead"], assignedRepId: "__none__" } };
  assert.equal(campaignValuesChanged(
    { audienceRules: { assignedRepId: "__none__", statuses: ["new_lead"] }, name: "Campaign" },
    saved,
  ), false);
  assert.equal(campaignValuesChanged({ ...saved, name: "Edited" }, saved), true);
});

test("launch confirmation uses the approved snapshot after reload, never a newer preview", () => {
  const approvedAudience = { eligible: 5 };
  assert.equal(canConfirmCampaignLaunch({ status: "approved", dirty: false, approvedAudience }), true);
  assert.equal(canConfirmCampaignLaunch({ status: "approved", dirty: true, approvedAudience }), false);
  assert.equal(canConfirmCampaignLaunch({ status: "approved", dirty: false, approvedAudience: { eligible: 0 } }), false);
  assert.equal(canConfirmCampaignLaunch({ status: "approved", dirty: false, approvedAudience: null }), false);
});