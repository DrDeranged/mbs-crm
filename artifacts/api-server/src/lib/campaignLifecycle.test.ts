import assert from "node:assert/strict";
import { test } from "node:test";
import { archivableCampaign, deletableCampaign } from "./campaignLifecycle";

test("only never-approved and never-launched drafts can be deleted", () => {
  assert.equal(deletableCampaign("draft", false, false), true);
  assert.equal(deletableCampaign("draft", true, false), false);
  assert.equal(deletableCampaign("draft", false, true), false);
  for (const state of ["approved", "running", "completed", "cancelled", "failed", "scheduled", "paused"]) {
    assert.equal(deletableCampaign(state, false, false), false);
  }
});

test("archive is independent of status but cannot hide an active campaign", () => {
  for (const state of ["draft", "completed", "cancelled", "failed"]) assert.equal(archivableCampaign(state), true);
  for (const state of ["approved", "running", "paused", "scheduled"]) assert.equal(archivableCampaign(state), false);
});
