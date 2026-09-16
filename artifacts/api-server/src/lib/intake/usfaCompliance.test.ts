import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { shouldBlockUsfaMarketing } from "./usfaCompliance";

test("USFA leads are blocked from marketing until explicit consent is confirmed", () => {
  assert.equal(shouldBlockUsfaMarketing("usfundadvisor", false), true);
  assert.equal(shouldBlockUsfaMarketing("usfundadvisor", true), false);
  assert.equal(shouldBlockUsfaMarketing("website", false), false);
});

test("all SMS and drip entry points recheck the shared USFA consent guard", async () => {
  const [communications, drip, dripJob, leads] = await Promise.all([
    readFile(new URL("../../routes/communications.ts", import.meta.url), "utf8"),
    readFile(new URL("../../routes/drip.ts", import.meta.url), "utf8"),
    readFile(new URL("../dripJob.ts", import.meta.url), "utf8"),
    readFile(new URL("../../routes/leads.ts", import.meta.url), "utf8"),
  ]);
  assert.match(communications, /isUsfaMarketingBlocked\(db, lead\.leadSource\)/);
  assert.match(drip, /isUsfaMarketingBlocked\(database, lead\.leadSource\)/);
  assert.match(dripJob, /isUsfaMarketingBlocked\(db, lead\.leadSource\)/);
  assert.match(leads, /isUsfaMarketingBlocked\(db, updated\.leadSource\)/);
});