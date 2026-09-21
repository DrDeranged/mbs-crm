import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const applySource = readFileSync(path.resolve(import.meta.dirname, "../pages/apply.tsx"), "utf8");

test("SMS consent opens the canonical legal pages in new tabs", () => {
  assert.match(
    applySource,
    /href="https:\/\/my-business-solutions\.com\/privacy-policy" target="_blank"/,
  );
  assert.match(
    applySource,
    /href="https:\/\/my-business-solutions\.com\/terms-of-service" target="_blank"/,
  );
  assert.doesNotMatch(applySource, /href="\/(?:privacy-policy|terms-of-service)"/);
});