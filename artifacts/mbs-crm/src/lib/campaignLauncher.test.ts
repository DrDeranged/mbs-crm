import assert from "node:assert/strict";
import test from "node:test";
import { isCampaignPreviewFresh, serializeAudienceRules, validateCampaignFlyerFile } from "./campaignLauncher.ts";

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
    minAmount: "10000", maxAmount: "",
  }), {
    statuses: ["new_lead"], programTypes: ["equipment"], assignedRepId: 42,
    leadSources: ["website"], createdFrom: "2026-01-01", createdTo: null,
    minAmount: 10000, maxAmount: null,
  });
});

test("preview freshness requires a matching saved version and token", () => {
  assert.equal(isCampaignPreviewFresh({ dirty: false, previewedVersion: 3, campaignVersion: 3, previewToken: "token" }), true);
  assert.equal(isCampaignPreviewFresh({ dirty: true, previewedVersion: 3, campaignVersion: 3, previewToken: "token" }), false);
  assert.equal(isCampaignPreviewFresh({ dirty: false, previewedVersion: 2, campaignVersion: 3, previewToken: "token" }), false);
  assert.equal(isCampaignPreviewFresh({ dirty: false, previewedVersion: 3, campaignVersion: 3 }), false);
});