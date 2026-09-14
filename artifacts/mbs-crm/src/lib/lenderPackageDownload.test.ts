import assert from "node:assert/strict";
import test from "node:test";
import { getLenderPackageFilename } from "./lenderPackageDownload.ts";

test("uses and sanitizes the RFC 5987 filename from the response header", () => {
  assert.equal(
    getLenderPackageFilename("attachment; filename*=UTF-8''MBS-Application-Acme%20Co-42.pdf"),
    "MBS-Application-Acme-Co-42.pdf",
  );
});

test("removes path traversal and enforces a PDF filename", () => {
  assert.equal(
    getLenderPackageFilename('attachment; filename="../../private-report.txt"'),
    "private-report.txt.pdf",
  );
});

test("uses a safe fallback when the response has no filename", () => {
  assert.equal(
    getLenderPackageFilename(null, "MBS Application / 42"),
    "42.pdf",
  );
});