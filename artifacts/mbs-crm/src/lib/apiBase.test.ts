import assert from "node:assert/strict";
import test from "node:test";
import { resolveApiUrl } from "./apiBase.ts";

test("resolves server API paths without duplicating the API prefix", () => {
  assert.equal(
    resolveApiUrl("/api/collateral/renders/12/pdf", "/mbs-crm/api"),
    "/mbs-crm/api/collateral/renders/12/pdf",
  );
});

test("resolves relative paths and preserves absolute URLs", () => {
  assert.equal(
    resolveApiUrl("collateral/renders/12/link", "/mbs-crm/api/"),
    "/mbs-crm/api/collateral/renders/12/link",
  );
  assert.equal(
    resolveApiUrl("https://storage.example/file.pdf", "/mbs-crm/api"),
    "https://storage.example/file.pdf",
  );
});

const renderPaths = [
  "/api/collateral/renders/3/pdf",
  "/api/collateral/renders/3/png",
  "/api/collateral/renders/3/link",
];

test("keeps one API prefix for every collateral action", () => {
  for (const path of renderPaths) {
    const resolved = resolveApiUrl(path, "/mbs-crm/api");
    assert.equal(resolved, `/mbs-crm${path}`);
    assert.equal(resolved.includes("/api/api/"), false);
  }
});
