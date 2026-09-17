import assert from "node:assert/strict";
import test from "node:test";
import {
  MERGE_USER_REFERENCE_COLUMNS,
  mergeRequiresConfirmation,
  mergeUserReferences,
  reservedIdentityOwnerId,
  resolveIdentityUserId,
  retireMergedSlug,
  validateMergeUsers,
} from "./userIdentityMerge";

test("identity resolution prefers a linked identity and falls back to the legacy clerk id", () => {
  const users = [
    { id: 7, clerkId: "legacy-clerk" },
    { id: 9, clerkId: "other-clerk" },
  ];
  const identities = [{ userId: 7, clerkId: "linked-clerk" }];
  assert.equal(resolveIdentityUserId("linked-clerk", identities, users), 7);
  assert.equal(resolveIdentityUserId("legacy-clerk", identities, users), 7);
  assert.equal(resolveIdentityUserId("missing-clerk", identities, users), null);
});

test("merge reference policy moves every requested source reference to the target", () => {
  const sourceId = 11;
  const targetId = 22;
  for (const [table, column] of MERGE_USER_REFERENCE_COLUMNS) {
    const rows = [{ id: 1, [column]: sourceId }, { id: 2, [column]: 99 }];
    const moved = mergeUserReferences(rows, table, column, sourceId, targetId);
    assert.equal(moved[0][column], targetId, `${table}.${column}`);
    assert.equal(moved[1][column], 99, `${table}.${column} untouched`);
  }
  assert.equal(MERGE_USER_REFERENCE_COLUMNS.length, 13);
});

test("merge refuses inactive targets and only requires confirmation for reassignment", () => {
  const source = { id: 11, role: "pending" as const, isActive: true, slug: "stray" };
  assert.throws(
    () => validateMergeUsers(source, { id: 22, role: "rep", isActive: false, slug: "real" }),
    /Target user must be active/,
  );
  assert.equal(mergeRequiresConfirmation({}), false);
  assert.equal(mergeRequiresConfirmation({ "leads.assigned_rep_id": 0 }), false);
  assert.equal(mergeRequiresConfirmation({ "leads.assigned_rep_id": 1 }), true);
});

test("reserved email attaches to the active reserved-slug owner, not a new user", () => {
  const owner = reservedIdentityOwnerId(
    "  RAY@MY-BUSINESS-SOLUTIONS.COM ",
    { "ray@my-business-solutions.com": "ray" },
    [
      { id: 7, slug: "ray", isActive: true },
      { id: 8, slug: "ray", isActive: false },
    ],
  );
  assert.equal(owner, 7);
  assert.equal(
    reservedIdentityOwnerId(
      "new-user@example.com",
      { "ray@my-business-solutions.com": "ray" },
      [{ id: 7, slug: "ray", isActive: true }],
    ),
    null,
  );
});

test("merge keeps target slug and retires and clears the source slug", () => {
  assert.deepEqual(retireMergedSlug("stray", "real"), {
    sourceSlug: null,
    retiredSlug: "stray",
    replacementSlug: "real",
  });
  assert.throws(() => retireMergedSlug("stray", null), /Target must have a slug/);
  validateMergeUsers(
    { id: 11, role: "pending", isActive: true, slug: "stray" },
    { id: 22, role: "rep", isActive: true, slug: "real" },
  );
});