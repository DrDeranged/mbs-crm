import assert from "node:assert/strict";
import test from "node:test";
import { notificationTarget } from "./notificationNavigation.ts";

for (const role of ["rep", "admin"]) {
  test(`${role} notification click-through targets the linked lead`, () => {
    assert.equal(notificationTarget(501), "/leads/501");
  });
}

test("notification click-through stays put when no lead is linked", () => {
  assert.equal(notificationTarget(null), null);
});