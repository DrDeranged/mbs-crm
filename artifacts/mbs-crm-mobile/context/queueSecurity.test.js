const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildReplayAuthorization,
  bindQueueMutationToOwner,
  getQueueBlockReason,
} = require("./queueSecurity");

test("new offline mutations are bound to the signed-in Clerk user", () => {
  const mutation = { endpoint: "/api/leads", method: "POST", body: { firstName: "A" } };
  assert.deepEqual(bindQueueMutationToOwner(mutation, "user-current"), {
    ...mutation,
    ownerUserId: "user-current",
  });
  assert.throws(() => bindQueueMutationToOwner(mutation, undefined), /Sign in/);
});

test("queue ownership blocks legacy and different-account entries", () => {
  assert.equal(getQueueBlockReason(undefined, "user-current"), "legacy_unowned");
  assert.equal(getQueueBlockReason("user-other", "user-current"), "different_user");
  assert.equal(getQueueBlockReason("user-current", "user-current"), null);
});

test("replay authorization never formats a missing token as Bearer null", () => {
  assert.equal(buildReplayAuthorization(null), null);
  assert.equal(buildReplayAuthorization(undefined), null);
  assert.equal(buildReplayAuthorization("  "), null);
  assert.equal(buildReplayAuthorization("valid-token"), "Bearer valid-token");
});