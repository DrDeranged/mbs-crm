import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CONSENT_CHECKBOX_LABEL,
  CONSENT_TEXT,
  CONSENT_TEXT_VERSION,
  CONSENT_TITLE,
} from "./consentText";
// @ts-expect-error Node's strip-types test runner resolves explicit .ts imports.
import { getPublicApplicationConsentText } from "./applicationConsent.ts";

test("commercial financing disclosure remains sourced from the immutable consent text artifact", () => {
  assert.equal(CONSENT_TITLE, "Commercial Financing Authorization & Disclosure");
  assert.ok(CONSENT_TEXT.length > 500);
  assert.match(CONSENT_TEXT, /I certify that my answers are true and complete/);
  assert.match(CONSENT_TEXT, /commercial or business purposes only/);
  assert.equal(CONSENT_TEXT_VERSION, "2026-09-14");
});

test("consentText.ts matches the canonical full-file SHA-256 fixture", () => {
  const source = readFileSync(new URL("./consentText.ts", import.meta.url), "utf8");
  const canonicalSource = source.replace(/\r\n/g, "\n").replace(/\n*$/, "\n");

  assert.equal(source, canonicalSource, "consentText.ts must use LF line endings and one final LF");
  assert.equal(
    createHash("sha256").update(canonicalSource, "utf8").digest("hex"),
    "1b8aa069342118eef213efe977fe97cda629119338d9fbd487f620e1d1e13e94",
  );
});

test("the disclosure acceptance checkbox has a required, artifact-owned label and version", () => {
  assert.equal(
    CONSENT_CHECKBOX_LABEL,
    "I have read and agree to the Commercial Financing Authorization & Disclosure.",
  );
  assert.ok(CONSENT_TEXT_VERSION.length > 0);
});

test("public disclosure payload exactly exposes the immutable artifact constants", () => {
  assert.deepEqual(getPublicApplicationConsentText(), {
    title: CONSENT_TITLE,
    text: CONSENT_TEXT,
    version: CONSENT_TEXT_VERSION,
    checkboxLabel: CONSENT_CHECKBOX_LABEL,
  });
});