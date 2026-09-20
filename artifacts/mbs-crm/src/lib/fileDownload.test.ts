import assert from "node:assert/strict";
import test from "node:test";
import { safeDownloadFilename } from "./fileDownload.ts";

test("sanitizes document filenames before browser download", () => {
  assert.equal(
    safeDownloadFilename("../../Quarterly Report: Q3?.pdf", "document.pdf"),
    "Quarterly-Report--Q3-.pdf",
  );
  assert.equal(safeDownloadFilename("...", "document.pdf"), "document.pdf");
});