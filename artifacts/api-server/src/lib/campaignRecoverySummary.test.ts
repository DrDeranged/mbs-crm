import assert from "node:assert/strict";
import { test } from "node:test";
import { campaignRecoverySummary } from "./campaignRecoverySummary";

test("423 not sent here reconcile to 357 actually sent via recovery and 66 excluded", async () => {
  const source = Array.from({ length: 423 }, (_, i) => ({ leadId: i + 1, campaignId: 11, channel: "email", status: "deferred", mode: "live" }));
  const child = source.slice(0, 357).map(r => ({ ...r, campaignId: 14, status: "sent" }));
  const leads = source.map(r => ({ id: r.leadId, email: `lead${r.leadId}@example.test`, isUnsubscribed: r.leadId > 357 }));
  const result = await campaignRecoverySummary({
    sourceId: 11, recipients: [...source, ...child, source[0]], leads,
    attempts: child.map(r => ({ leadId: r.leadId, toEmail: `lead${r.leadId}@example.test` })),
    recoveries: [{ id: 14, name: "Remaining", status: "running" }],
    bouncedEmails: new Set(leads.slice(357, 418).map(l => l.email)), suppressed: async () => false,
  });
  assert.equal(result.notSentHere, 423);
  assert.equal(result.sentViaRecovery, 357);
  assert.equal(result.eligibleRemaining, 0);
  assert.deepEqual(result.exclusions, [
    { reason: "Suppressed — bounce/block", count: 61 }, { reason: "Opted out / suppressed", count: 5 },
  ]);
});

test("draft recovery does not falsely claim sent and live pending recovery is separate", async () => {
  const result = await campaignRecoverySummary({
    sourceId: 1, recipients: [
      { campaignId: 1, leadId: 3, channel: "email", status: "queued", mode: "live" },
      { campaignId: 2, leadId: 3, channel: "email", status: "queued", mode: "live" },
      { campaignId: 1, leadId: 4, channel: "email", status: "sent", mode: "dry_run" },
    ], leads: [{ id: 3, email: "next@example.test", isUnsubscribed: false }],
    attempts: [], recoveries: [{ id: 2, name: "Recovery", status: "draft" }],
    bouncedEmails: new Set(), suppressed: async () => false,
  });
  assert.equal(result.notSentHere, 1);
  assert.equal(result.sentViaRecovery, 0);
  assert.equal(result.pendingViaRecovery, 1);
});

test("suppression, invalid addresses, duplicate addresses and uncertain provider attempts stay excluded", async () => {
  const rows = [1, 2, 3, 4, 5].map(leadId => ({ campaignId: 1, leadId, channel: "email", status: "queued" }));
  const result = await campaignRecoverySummary({
    sourceId: 1, recipients: rows,
    leads: [1, 2, 3, 4, 5].map(id => ({ id, email: id === 5 ? "bad" : id < 3 ? "same@example.test" : `${id}@example.test`, isUnsubscribed: false })),
    attempts: [{ leadId: 3, toEmail: "3@example.test" }], recoveries: [], bouncedEmails: new Set(),
    suppressed: async email => email === "4@example.test",
  });
  assert.equal(result.eligibleRemaining, 1);
  assert.equal(result.exclusions.reduce((n, e) => n + e.count, 0), 4);
});
