import assert from "node:assert/strict";
import test from "node:test";
import { documentContentDisposition } from "./documentDownload";

test("document download headers support Unicode names with an ASCII fallback", () => {
  assert.equal(
    documentContentDisposition("贷款申请 📄.pdf", 42),
    "attachment; filename=\"document-42.pdf\"; filename*=UTF-8''%E8%B4%B7%E6%AC%BE%E7%94%B3%E8%AF%B7%20%F0%9F%93%84.pdf",
  );
});

test("document download headers encode control and quote characters", () => {
  const value = documentContentDisposition("report\"\r\nmalicious.pdf", 7);
  assert.equal(value.includes("\r"), false);
  assert.equal(value.includes("\n"), false);
  assert.equal(value, "attachment; filename=\"document-7.pdf\"; filename*=UTF-8''report%22%0D%0Amalicious.pdf");
});