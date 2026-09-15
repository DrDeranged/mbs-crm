import assert from "node:assert/strict";
import test from "node:test";
import { lenderPackageFailureTitle } from "./lenderPackageError.ts";

test("only admins see the safe lender-package failure reason", () => {
  assert.equal(lenderPackageFailureTitle("admin", "renderer_unavailable"), "Lender package failed — renderer unavailable");
  assert.equal(lenderPackageFailureTitle("rep", "renderer_unavailable"), "Lender package failed");
  assert.equal(lenderPackageFailureTitle("manager", "merge_failed:bank.pdf"), "Lender package failed");
  assert.equal(lenderPackageFailureTitle("admin", "merge_failed:bank.pdf"), "Lender package failed — could not merge bank.pdf");
  assert.equal(lenderPackageFailureTitle("admin", "secret stack trace"), "Lender package failed");
});