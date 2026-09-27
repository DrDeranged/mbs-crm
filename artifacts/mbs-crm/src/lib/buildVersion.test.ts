import assert from "node:assert/strict";
import { test } from "node:test";
import { buildIdFromHtml } from "./serviceWorkerUpdate.ts";

test("build ID is read only from the generated HTML marker", () => {
  assert.equal(buildIdFromHtml('<html><head><meta name="mbs-build-id" content="build-123" /></head></html>'), "build-123");
  assert.equal(buildIdFromHtml("<html><head></head></html>"), null);
});