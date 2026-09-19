import assert from "node:assert/strict";
import test from "node:test";
import { appendUploadedDocument, defaultBuilderConfig, initializeBuilderConfig } from "../pages/lead-detail/lender-package-config.ts";

test("builder waits for config and documents before filtering saved document IDs", () => {
  const saved = { packageConfig: { documentIds: [11], sections: ["application"] as any } };
  assert.equal(initializeBuilderConfig(undefined, saved, true, false), null);
  assert.equal(initializeBuilderConfig([], undefined, false, false), null, "a config response must be explicitly resolved");
  const initialized = initializeBuilderConfig([{ id: 11 }], saved, false, false)!;
  assert.deepEqual(initialized.documentIds, [11]);
});

test("upload selection, reset defaults, and a reopened saved config preserve the expected state", () => {
  const afterUpload = appendUploadedDocument(defaultBuilderConfig([{ id: 1 }]), 2);
  assert.deepEqual(afterUpload.documentIds, [1, 2]);
  const reset = defaultBuilderConfig([{ id: 1 }, { id: 2 }]);
  assert.deepEqual(reset.documentIds, [1, 2]);
  const reopened = initializeBuilderConfig([{ id: 1 }, { id: 2 }], { packageConfig: reset }, false, false)!;
  assert.deepEqual(reopened, reset);
});