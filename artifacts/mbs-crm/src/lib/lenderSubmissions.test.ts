import test from "node:test";
import assert from "node:assert/strict";
import { submissionSummary, filterDeclinedMatches, shouldPromptForStage } from "./lenderSubmissions.ts";

test("summary reports approved and declined submissions exactly", () => {
  assert.equal(submissionSummary([{ status: "approved" }, { status: "declined" }]).text, "Submitted to 2 · 1 approved · 1 declined · 0 pending");
});
test("declined matches are hidden unless requested", () => {
  const matches = [{ lenderId: 1 }, { lenderId: 2 }];
  const submissions = [{ lenderId: 1, status: "declined" }];
  assert.deepEqual(filterDeclinedMatches(matches, submissions), [{ lenderId: 2 }]);
  assert.deepEqual(filterDeclinedMatches(matches, submissions, true), matches);
});
test("stage prompts are optional and never automatic", () => {
  assert.deepEqual(shouldPromptForStage([{ status: "approved" }], "approved"), { stage: "approved", prompt: true });
  assert.deepEqual(shouldPromptForStage([{ status: "declined" }, { status: "declined" }], "declined"), { stage: "declined", prompt: true });
  assert.equal(shouldPromptForStage([{ status: "declined" }, { status: "submitted" }], "declined").prompt, false);
});