import assert from "node:assert/strict";
import test from "node:test";
import { addCampaignLeadIds, assertCampaignLeadResultCap, MAX_CAMPAIGN_PICKED_LEADS } from "./campaignLeadPicker.ts";

test("manual lead selections merge unique IDs and enforce the combined pick limit", () => {
  assert.deepEqual(addCampaignLeadIds([1, 2], [2, 3]), [1, 2, 3]);
  assert.throws(
    () => addCampaignLeadIds(Array.from({ length: MAX_CAMPAIGN_PICKED_LEADS }, (_, index) => index + 1), [1001]),
    /at most 1,000/,
  );
});

test("select-all result cap rejects oversized search results with an explicit refinement message", () => {
  assert.doesNotThrow(() => assertCampaignLeadResultCap(MAX_CAMPAIGN_PICKED_LEADS));
  assert.throws(() => assertCampaignLeadResultCap(MAX_CAMPAIGN_PICKED_LEADS + 1), /Refine the search/);
});