import assert from "node:assert/strict";
import { mock } from "node:test";
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import { db, pool } from "../../lib/db/src/index.ts";
import { replyCaptureConfigured } from "../../artifacts/api-server/src/lib/campaignAttribution.ts";
import { doSendEmail } from "../../artifacts/api-server/src/routes/email.ts";

// Process-local fixture configuration only. Never enable live delivery.
const require = createRequire(new URL("../../artifacts/api-server/package.json", import.meta.url));
const provider = require("@sendgrid/mail");
const sendSpy = mock.method(provider, "send", () => { throw new Error("External delivery forbidden"); });
const insertSpy = mock.method(db, "insert", () => { throw new Error("Database writes forbidden"); });
mock.method(db, "select", () => ({ from: () => ({ limit: async () => [{ emailSendingEnabled: true }] }) }));
const cases = [];
try {
  for (const [secret, enabled, expected] of [
    [false, false, false], [false, true, false], [true, false, false], [true, true, true],
  ]) {
    if (secret) process.env.SENDGRID_INBOUND_PARSE_SECRET = "non-live-fixture-secret";
    else delete process.env.SENDGRID_INBOUND_PARSE_SECRET;
    process.env.SENDGRID_INBOUND_PARSE_ENABLED = enabled ? "true" : "false";
    assert.equal(replyCaptureConfigured(), expected);
    cases.push({ secretPresent: secret, enabled, captureConfigured: expected });
  }
  delete process.env.SENDGRID_INBOUND_PARSE_SECRET;
  delete process.env.SENDGRID_INBOUND_PARSE_ENABLED;
  const result = await doSendEmail({
    leadId: null, userId: null, templateId: null, campaignId: 5,
    subject: "Certification fixture only", bodyHtml: "<p>Certification fixture only.</p>",
    toEmail: "recipient@example.invalid", replyToEmail: "configured@example.invalid",
    baseUrl: "https://app.my-business-solutions.com",
  });
  assert.equal(result.configurationReason, "missing:campaign_reply_capture");
  assert.equal(result.deliveryOutcome, "definite_failure");
  assert.equal(result.send, null);
  assert.equal(sendSpy.mock.callCount(), 0);
  assert.equal(insertSpy.mock.callCount(), 0);
  const proof = {
    captureFlagCases: cases,
    requiredBehavior: "Campaign sends retain the configured Reply-To while capture is disabled",
    observed: result,
    requirementPass: false,
    verdict: "FAIL: this revision rejects campaign sends instead of retaining configured Reply-To",
    providerCalls: 0, databaseWrites: 0,
    isolation: "Real source function; mocked settings read, provider and database writes prohibited",
  };
  await writeFile(new URL("./reply-policy-runtime.json", import.meta.url), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof, null, 2));
} finally {
  mock.restoreAll();
  await pool.end();
}
