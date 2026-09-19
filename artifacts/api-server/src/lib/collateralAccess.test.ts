import assert from "node:assert/strict";
import test from "node:test";
import {
  canEmailCollateralToLead,
  canManageCollateralTemplates,
  canReadCollateralTemplate,
  canRenderCollateralForRep,
} from "./collateralAccess";

test("reps cannot use admin collateral template policy", () => {
  const rep = { id: 7, role: "rep" };
  for (const status of ["draft", "published"]) {
    assert.equal(canManageCollateralTemplates(rep), false);
    assert.equal(canReadCollateralTemplate(rep, { status }), status === "published");
  }
  assert.equal(canRenderCollateralForRep(rep, 7), true);
  assert.equal(canRenderCollateralForRep(rep, 8), false);
});

test("collateral admin policy permits managers only through the explicit admin role", () => {
  const manager = { id: 3, role: "manager" };
  const admin = { id: 2, role: "admin" };
  assert.equal(canManageCollateralTemplates(manager), false);
  assert.equal(canManageCollateralTemplates(admin), true);
  assert.equal(canReadCollateralTemplate(admin, { status: "draft" }), true);
});

test("rep collateral email policy only permits assigned leads", () => {
  assert.equal(canEmailCollateralToLead({ id: 7, role: "rep" }, { assignedRepId: 7 }), true);
  assert.equal(canEmailCollateralToLead({ id: 7, role: "rep" }, { assignedRepId: 8 }), false);
  assert.equal(canEmailCollateralToLead({ id: 2, role: "admin" }, { assignedRepId: 8 }), true);
});