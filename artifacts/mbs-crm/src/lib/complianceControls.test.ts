import assert from "node:assert/strict";
import test from "node:test";
import { campaignPollInterval, exclusionReasonLabel, normalizeLeadIdList, parseTaskFilter, taskDueDateLabel, toggleExcludedLead, validateOptOutReason } from "./complianceControls.ts";

test("date-only deadlines retain their calendar day in every browser timezone", () => {
  assert.equal(taskDueDateLabel("2026-07-15"), "Wed, Jul 15, 2026");
  assert.equal(taskDueDateLabel(null), "No due date");
});

test("opt-out reason validation", () => {
  assert.equal(validateOptOutReason("   "), "A reason is required.");
  assert.match(validateOptOutReason("x".repeat(2001)) ?? "", /2000/);
  assert.equal(validateOptOutReason(" Customer called "), null);
});
test("task filter parsing", () => {
  assert.equal(parseTaskFilter("?filter=overdue"), "overdue");
  assert.equal(parseTaskFilter("?filter=bogus"), "all");
  assert.equal(parseTaskFilter(""), "all");
});
test("excluded lead id helpers", () => {
  assert.deepEqual(normalizeLeadIdList([3, "3", 4, -1, "x"]), [3, 4]);
  assert.deepEqual(normalizeLeadIdList(null), []);
  assert.deepEqual(toggleExcludedLead([1, 2], 2), [1]);
  assert.deepEqual(toggleExcludedLead([1], 5), [1, 5]);
});
test("exclusion labels and polling", () => {
  assert.equal(exclusionReasonLabel("excluded_manually"), "Excluded manually");
  assert.equal(campaignPollInterval("running"), 15000);
  assert.equal(campaignPollInterval("paused"), 15000);
  assert.equal(campaignPollInterval("stopped"), false);
});
