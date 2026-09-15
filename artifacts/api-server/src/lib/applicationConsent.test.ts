import assert from "node:assert/strict";
import test from "node:test";
import { getServerOwnedApplicationConsent } from "./applicationConsent";
import { CONSENT_TEXT_VERSION } from "./consentText";

test("application consent version is server-owned and persists the current disclosure version", () => {
  const fields = getServerOwnedApplicationConsent();
  assert.deepEqual(fields, { consentTextVersion: CONSENT_TEXT_VERSION });
  assert.equal(fields.consentTextVersion, "2026-09-14");
});