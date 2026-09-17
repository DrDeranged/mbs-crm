import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("partner submission UI exposes partner types and broker attribution", async () => {
  const source = await readFile(new URL("../components/lender-submissions-panel.tsx", import.meta.url), "utf8");
  assert.match(source, /Log partner submission/);
  assert.match(source, /partnerType !== "broker_in"/);
  assert.match(source, /via_broker_id/);
  assert.match(source, /end_lender_id/);
  assert.match(source, /replace\("_", " "\)/);
});

test("partner contact UI sends through the business SMS endpoint", async () => {
  const source = await readFile(new URL("../components/partner-contacts-dialog.tsx", import.meta.url), "utf8");
  assert.match(source, /\/partners\/\$\{partnerId\}\/contacts\/\$\{smsContact\.id\}\/sms/);
  assert.match(source, /dealId/);
  assert.match(source, /Text/);
});