import assert from "node:assert/strict";
import test from "node:test";
import { LenderPackageError, safeLenderPackageReason } from "./lenderPackageErrors";

test("lender package reasons do not expose arbitrary server errors", () => {
  assert.equal(safeLenderPackageReason(new Error("private details")), "package_failed");
  assert.equal(safeLenderPackageReason(new LenderPackageError("renderer_unavailable", "private details")), "renderer_unavailable");
  assert.equal(safeLenderPackageReason(new LenderPackageError("merge_failed:bad\n.pdf", "private details")), "merge_failed:bad_.pdf");
  assert.equal(safeLenderPackageReason(new LenderPackageError("private details", "private details")), "package_failed");
});