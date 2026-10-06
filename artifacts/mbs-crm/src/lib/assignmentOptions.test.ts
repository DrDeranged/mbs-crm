import assert from "node:assert/strict";
import test from "node:test";
import { assignmentOptions } from "./assignmentOptions.ts";

test("assignment directory includes all staff roles and orders by displayed name, not role", () => {
  const users = [
    { id: 1, role: "admin", isActive: true, name: "Zoe" },
    { id: 2, role: "manager", isActive: true, name: "Bea" },
    { id: 3, role: "rep", isActive: true, name: " ", email: "ada@example.invalid" },
    { id: 4, role: "pending", isActive: true, name: "Pending" },
    { id: 5, role: "rep", isActive: false, name: "Inactive" },
    { id: 6, role: "admin", isActive: true, name: "Merged", mergedInto: 1 },
  ];
  assert.deepEqual(assignmentOptions(users).map(user => user.id), [3, 2, 1]);
  assert.deepEqual(users.map(user => user.id), [1, 2, 3, 4, 5, 6], "never mutate cached directory");
});
