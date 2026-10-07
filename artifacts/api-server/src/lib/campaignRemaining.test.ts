import assert from "node:assert/strict";
import { test } from "node:test";
import { eligibleRemainingLeadIds, remainingCampaignLeadIds } from "./campaignRemaining";

test("remaining audience excludes the original sent set, including repeated launch rows", () => {
  const recipients = [
    ...Array.from({ length: 98 }, (_, i) => ({ leadId: i + 1, channel: "email", status: "sent" })),
    ...Array.from({ length: 423 }, (_, i) => ({ leadId: i + 99, channel: "email", status: "queued" })),
    { leadId: 1, channel: "email", status: "deferred" },
    { leadId: 522, channel: "email", status: "failed" },
    { leadId: 523, channel: "email", status: "excluded" },
  ];
  const remaining = remainingCampaignLeadIds(recipients, []);
  assert.equal(remaining.length, 423);
  assert.ok(remaining.every(id => id > 98 && id < 522));
});

test("deferred, cancelled and internal unclaimed eligible rows are pending; SMS is not silently relaunched", () => {
  assert.deepEqual(remainingCampaignLeadIds([
    { leadId: 1, channel: "email", status: "deferred" },
    { leadId: 2, channel: "email", status: "cancelled" },
    { leadId: 3, channel: "email", status: "eligible" },
    { leadId: 4, channel: "sms", status: "queued" },
  ], []), [1, 2, 3]);
});

test("a sent or unresolved provider attempt blocks a stale queued recipient", () => {
  assert.deepEqual(remainingCampaignLeadIds([
    { leadId: 1, channel: "email", status: "queued" },
    { leadId: 2, channel: "email", status: "queued" },
  ], [{ leadId: 1, toEmail: "already@example.test" }]), [2]);
});

test("validation-only launch recipients cannot broaden a live campaign recovery", () => {
  assert.deepEqual(remainingCampaignLeadIds([
    { leadId: 1, channel: "email", status: "eligible", mode: "dry_run" },
    { leadId: 2, channel: "email", status: "queued", mode: "live" },
  ], []), [2]);
});

test("suppression and unsubscribe are rechecked; sent addresses cannot reenter through another lead", async () => {
  const leads = [
    { id: 1, email: "sent@example.test", isUnsubscribed: false },
    { id: 2, email: "suppressed@example.test", isUnsubscribed: false },
    { id: 3, email: "unsubscribed@example.test", isUnsubscribed: true },
    { id: 4, email: "remaining@example.test", isUnsubscribed: false },
    { id: 5, email: "REMAINING@example.test", isUnsubscribed: false },
  ];
  const suppressed = new Set(["suppressed@example.test"]);
  const attempts = [{ leadId: 99, toEmail: "SENT@example.test" }];
  assert.deepEqual(await eligibleRemainingLeadIds(leads, attempts, async email => suppressed.has(email)), [4]);
  suppressed.add("remaining@example.test");
  assert.deepEqual(await eligibleRemainingLeadIds(leads, attempts, async email => suppressed.has(email)), []);
});
