import assert from "node:assert/strict";
import test from "node:test";
import {
  canSubmitUserMerge,
  getEligibleMergeSources,
  getEligibleMergeTargets,
  getMergeSourceState,
} from "./mergeUserOptions.ts";

const users = [
  { id: 1, role: "pending" as const, isActive: true, name: "Pending Pat" },
  { id: 2, role: "pending" as const, isActive: false, name: "Inactive Pending" },
  { id: 3, role: "rep" as const, isActive: true, name: "Active Rep" },
  { id: 4, role: "admin" as const, isActive: true, name: "Active Admin" },
];

test("lists every active pending user as an eligible merge source", () => {
  assert.deepEqual(getEligibleMergeSources(users).map((user) => user.id), [1]);
  assert.deepEqual(getEligibleMergeSources([]), []);
  assert.deepEqual(getEligibleMergeSources(undefined), []);
});

test("lists only active non-pending users as merge targets", () => {
  assert.deepEqual(getEligibleMergeTargets(users).map((user) => user.id), [3, 4]);
});

test("accepts only a selected eligible source and eligible target", () => {
  assert.equal(canSubmitUserMerge("1", "3", users), true);
  assert.equal(canSubmitUserMerge("", "3", users), false);
  assert.equal(canSubmitUserMerge("2", "3", users), false);
  assert.equal(canSubmitUserMerge("3", "4", users), false);
  assert.equal(canSubmitUserMerge("1", "2", users), false);
});

test("distinguishes source loading, request failure, empty, and ready states", () => {
  assert.equal(getMergeSourceState({ isLoading: true, isError: false, sourceCount: 0 }), "loading");
  assert.equal(getMergeSourceState({ isLoading: false, isError: true, sourceCount: 0 }), "error");
  assert.equal(getMergeSourceState({ isLoading: false, isError: false, sourceCount: 0 }), "empty");
  assert.equal(getMergeSourceState({ isLoading: false, isError: false, sourceCount: 1 }), "ready");
});