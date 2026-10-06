import assert from "node:assert/strict";
import test from "node:test";
import { canReadDealSubmissions } from "./dealSubmissionAccess";

test("manager and admin deal readers can inspect submission metadata", () => {
  for (const role of ["admin", "manager"])
    assert.equal(canReadDealSubmissions({ id: 2, role }, { assignedTo: 3 }), true);
});

test("rep submission reads remain assignment-bound and pending users are denied", () => {
  assert.equal(canReadDealSubmissions({ id: 3, role: "rep" }, { assignedTo: 3 }), true);
  assert.equal(canReadDealSubmissions({ id: 3, role: "rep" }, { assignedTo: 4 }), false);
  assert.equal(canReadDealSubmissions({ id: 3, role: "rep" }, { assignedTo: null }), false);
  assert.equal(canReadDealSubmissions({ id: 3, role: "pending" }, { assignedTo: 3 }), false);
});
