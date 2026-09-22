import assert from "node:assert/strict";
import test from "node:test";
import {
  canManageCampaign,
  canTransitionCampaign,
  campaignFailureState,
  campaignStatusAfterLaunch,
  classifyEmailRecipient,
  classifySmsRecipient,
  hasCurrentApproval,
  isSmsLaunchUnsupported,
  campaignContentHash,
  assignedRepReplyTo,
  sameKeyResumeDecision,
  eligibleResumeCandidates,
  summarizeRecipientLedger,
  canAcquireExecutionLease,
  selectResumeClaimOutcome,
  approvedFlyerMatches,
  buildCampaignFlyerAttachment,
  campaignPlainText,
  minimalCampaignHtml,
} from "./campaignCore";

test("campaign APIs are restricted to manager and admin roles", () => {
  assert.equal(canManageCampaign({ role: "admin" }), true);
  assert.equal(canManageCampaign({ role: "manager" }), true);
  assert.equal(canManageCampaign({ role: "rep" }), false);
  assert.equal(canManageCampaign({ role: "pending" }), false);
});

test("campaign without a flyer produces plain text and image-free minimal HTML", () => {
  const text = campaignPlainText('<div><img src="logo.png"><h2>Hello &amp; welcome</h2><p>Call us today.</p></div>');
  const html = minimalCampaignHtml(text);
  assert.equal(text, "Hello & welcome\nCall us today.");
  assert.doesNotMatch(html, /<img|src=/i);
  assert.match(html, /Hello &amp; welcome/);
  assert.equal(buildCampaignFlyerAttachment(null), undefined);
});

test("audience classification preserves actionable email exclusion reasons", () => {
  assert.equal(classifyEmailRecipient({ email: null, duplicate: false, unsubscribed: false, suppressed: false, capacityAvailable: true }), "missing_contact_info");
  assert.equal(classifyEmailRecipient({ email: "x@example.com", duplicate: true, unsubscribed: false, suppressed: false, capacityAvailable: true }), "duplicate_email");
  assert.equal(classifyEmailRecipient({ email: "x@example.com", duplicate: false, unsubscribed: true, suppressed: false, capacityAvailable: true }), "email_unsubscribed_or_suppressed");
  assert.equal(classifyEmailRecipient({ email: "x@example.com", duplicate: false, unsubscribed: false, suppressed: true, capacityAvailable: true }), "email_unsubscribed_or_suppressed");
  assert.equal(classifyEmailRecipient({ email: "x@example.com", duplicate: false, unsubscribed: false, suppressed: false, capacityAvailable: false }), "daily_email_capacity");
});

test("SMS preview explains missing, duplicate, consent, and unsupported launch outcomes", () => {
  assert.equal(classifySmsRecipient({ phone: null, duplicate: false, eligible: false, reason: "missing_phone" }), "missing_contact_info");
  assert.equal(classifySmsRecipient({ phone: "+15550001111", duplicate: true, eligible: true }), "duplicate_phone");
  assert.equal(classifySmsRecipient({ phone: "+15550001111", duplicate: false, eligible: false, reason: "application_sms_consent_required" }), "application_sms_consent_required");
  assert.equal(classifySmsRecipient({ phone: "+15550001111", duplicate: false, eligible: true }), "sms_launch_not_supported");
  assert.equal(isSmsLaunchUnsupported("sms"), true);
  assert.equal(isSmsLaunchUnsupported("email_sms"), true);
  assert.equal(isSmsLaunchUnsupported("email"), false);
});

test("editing a campaign invalidates its approval version", () => {
  const current = { contentVersion: 2, invalidatedAt: null };
  assert.equal(hasCurrentApproval(current, 2), true);
  assert.equal(hasCurrentApproval(current, 3), false);
  assert.equal(hasCurrentApproval({ contentVersion: 2, invalidatedAt: new Date() }, 2), false);
});

test("repeat launch lifecycle is idempotent and transitions are explicit", () => {
  assert.equal(canTransitionCampaign("draft", "approved"), true);
  assert.equal(canTransitionCampaign("approved", "running"), true);
  assert.equal(canTransitionCampaign("completed", "running"), false);
  assert.equal(canTransitionCampaign("cancelled", "approved"), false);
  assert.deepEqual(campaignFailureState(), { campaign: "failed", launch: "failed" });
});

test("future scheduling advances the campaign, while an unscheduled dry run does not", () => {
  assert.equal(campaignStatusAfterLaunch("approved", true), "scheduled");
  assert.equal(campaignStatusAfterLaunch("approved", false), "approved");
  assert.equal(canTransitionCampaign("scheduled", "cancelled"), true);
});

test("campaign content hashes are stable and change when approved template content changes", () => {
  const base = { channel: "email", audienceRules: { statuses: ["new"] }, smsBody: null,
    emailTemplate: { id: 3, updatedAt: "2025-01-01", subject: "Hello", bodyHtml: "<p>Hi</p>", senderMode: "default", isActive: true } };
  assert.equal(campaignContentHash(base), campaignContentHash({ ...base, audienceRules: { statuses: ["new"] } }));
  assert.notEqual(campaignContentHash(base), campaignContentHash({ ...base, emailTemplate: { ...base.emailTemplate, subject: "Changed" } }));
  assert.notEqual(campaignContentHash(base), campaignContentHash({
    ...base,
    flyer: { source: "built_in", key: "equipment_financing", name: "Equipment Financing", contentType: "image/png" },
  }));
});

test("campaign flyer delivery uses the approved immutable creative", () => {
  const attachment = buildCampaignFlyerAttachment({
    bytes: Buffer.from("flyer-bytes"),
    name: "../Working Capital?.pdf",
    contentType: "application/pdf",
  });
  assert.deepEqual(attachment, [{
    content: Buffer.from("flyer-bytes").toString("base64"),
    filename: ".._Working Capital_.pdf",
    type: "application/pdf",
    disposition: "attachment",
  }]);
  assert.equal(approvedFlyerMatches(
    { digest: "abc", generation: "7" },
    { digest: "abc", generation: "7" },
  ), true);
  assert.equal(approvedFlyerMatches(
    { digest: "abc", generation: "7" },
    { digest: "changed", generation: "8" },
  ), false);
});

test("approval requires the current hash and explicit claims affirmation", () => {
  const approval = { contentVersion: 2, invalidatedAt: null, contentHash: campaignContentHash({ body: "approved" }), claimsAffirmed: true };
  assert.equal(hasCurrentApproval(approval, 2, campaignContentHash({ body: "approved" })), true);
  assert.equal(hasCurrentApproval({ ...approval, claimsAffirmed: false }, 2, approval.contentHash), false);
  assert.equal(hasCurrentApproval(approval, 2, campaignContentHash({ body: "edited" })), false);
});

test("assigned representative reply-to contract preserves routing", () => {
  assert.deepEqual(assignedRepReplyTo({ name: " Rep ", email: " rep@example.com " }), { name: "Rep", email: "rep@example.com" });
  assert.equal(assignedRepReplyTo(null), undefined);
});

test("same-key resume only selects eligible recipients and never retries uncertain queued rows", () => {
  assert.deepEqual(eligibleResumeCandidates([
    { status: "eligible", id: 1 }, { status: "queued", id: 2 },
    { status: "sent", id: 3 }, { status: "failed", id: 4 },
  ]), [{ status: "eligible", id: 1 }]);
  assert.equal(sameKeyResumeDecision({ sameCampaign: true, launchStatus: "running", campaignStatus: "running" }), "resume");
  assert.equal(sameKeyResumeDecision({ sameCampaign: true, launchStatus: "queued", campaignStatus: "paused" }), "return_existing");
  assert.equal(sameKeyResumeDecision({ sameCampaign: false, launchStatus: "running", campaignStatus: "running" }), "reject");
});

test("recipient ledger summaries are cumulative across partial runs", () => {
  assert.deepEqual(summarizeRecipientLedger([
    { status: "sent" }, { status: "failed" }, { status: "queued" },
    { status: "excluded", exclusionReason: "email_suppressed" }, { status: "excluded", exclusionReason: "duplicate_email" },
  ]), { sent: 1, failed: 2, eligible: 0, uncertain: 1, terminalStatus: "failed" });
});

test("execution lease refuses active owners and allows expiry takeover", () => {
  const now = new Date("2025-01-01T00:00:00Z");
  assert.equal(canAcquireExecutionLease("active", new Date("2025-01-01T00:05:00Z"), now), false);
  assert.equal(canAcquireExecutionLease("expired", new Date("2024-12-31T23:59:00Z"), now), true);
  assert.equal(canAcquireExecutionLease(null, null, now), true);
});

test("resume continues past already-processed queued recipient", () => {
  assert.deepEqual(selectResumeClaimOutcome([{ status: "queued" }, { status: "eligible" }]), ["already_processed", "claimed"]);
});