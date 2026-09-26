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
  campaignFlyerAttachments,
  campaignFlyerLinkMarker,
  renderCampaignFlyerLink,
  vendorVertical,
  campaignPlainText,
  minimalCampaignHtml,
  nextBusinessDayInNewYork,
  deferEligibleRecipients,
  selectDueResumeCandidates,
  DEFAULT_CAMPAIGN_REPLY_TO,
  isFutureCampaignSchedule,
  unionCampaignAudience,
  campaignExclusionReasonCounts,
  includeCampaignFilterMatches,
} from "./campaignCore";
import { approvedAudienceSummary, buildCampaignValidationResult, hasEligibleCampaignAudience, validateCampaignRender, validateCampaignMergeTokens } from "./campaignReadiness";
import { EMAIL_BRAND_LOGO_URL } from "./brand";
import { renderTemplate } from "../routes/email";

test("campaign APIs are restricted to manager and admin roles", () => {
  assert.equal(canManageCampaign({ role: "admin" }), true);
  assert.equal(canManageCampaign({ role: "manager" }), true);
  assert.equal(canManageCampaign({ role: "rep" }), false);
  assert.equal(canManageCampaign({ role: "pending" }), false);
});

test("campaign without a flyer produces plain text and one remote logo HTML alternative", () => {
  const text = campaignPlainText('<div><img src="logo.png"><h2>Hello &amp; welcome</h2><p>Call us today.</p></div>');
  const html = minimalCampaignHtml(text);
  assert.equal(text, "Hello & welcome\nCall us today.");
  assert.ok(html.includes(`<img src="${EMAIL_BRAND_LOGO_URL}"`));
  assert.equal(html.split(EMAIL_BRAND_LOGO_URL).length - 1, 1);
  assert.match(html, /Hello &amp; welcome/);
  assert.equal(buildCampaignFlyerAttachment(null), undefined);
});

test("Link sends no attachment and renders an expiring URL in both email alternatives; Attach is unchanged", () => {
  const flyer = { bytes: Buffer.from("approved bytes"), name: "Vendor.pdf", contentType: "application/pdf" };
  assert.equal(campaignFlyerAttachments(flyer, "link"), undefined);
  assert.deepEqual(campaignFlyerAttachments(flyer, "attach"), buildCampaignFlyerAttachment(flyer));
  const url = "https://example.com/api/collateral/flyers/public/signed?expires=123&sig=abc";
  const body = renderTemplate("Hi {{first_name|there}},\n\n{{flyer_link}}", {
    first_name: "", flyer_link: campaignFlyerLinkMarker(),
  });
  const rendered = renderCampaignFlyerLink(body, url);
  assert.match(rendered.bodyText, /Hi there,/);
  assert.ok(rendered.bodyText.includes(url));
  assert.match(rendered.bodyHtml, /<a href="https:\/\/example\.com\/api\/collateral\/flyers\/public\/signed\?expires=123&amp;sig=abc">View our vendor program →<\/a>/);
  assert.ok(!rendered.bodyHtml.includes(campaignFlyerLinkMarker()));
  assert.ok(!renderCampaignFlyerLink(body, null).bodyText.includes("View our vendor program"));
  assert.equal(validateCampaignMergeTokens({ subject: "Financing for your {{vertical}} buyers", bodyHtml: body.replace("there", "{{first_name|there}}") }), null);
});

test("vendor vertical mappings use imported lead vertical first and default to equipment", () => {
  assert.equal(vendorVertical("yellow_iron"), "heavy equipment");
  assert.equal(vendorVertical(null, "Construction"), "heavy equipment");
  assert.equal(vendorVertical("trucking"), "truck and trailer");
  assert.equal(vendorVertical(null, "Restaurants"), "restaurant equipment");
  assert.equal(vendorVertical(null, "Generators"), "generator");
  assert.equal(vendorVertical("amusement"), "equipment");
  assert.equal(vendorVertical(null, null), "equipment");
  assert.equal(vendorVertical("trucking", "Restaurants"), "truck and trailer");
  assert.equal(renderTemplate("Financing for your {{vertical}} buyers", { vertical: vendorVertical("trucking") }), "Financing for your truck and trailer buyers");
  assert.equal(renderTemplate("If a buyer at {{company}} ever stalls on financing", { company: "" }),
    "If a buyer ever stalls on financing");
});

test("daily overflow is deferred to the next New York business day", () => {
  const friday = new Date("2026-01-16T20:00:00.000Z");
  const due = nextBusinessDayInNewYork(friday);
  assert.equal(due.toISOString(), "2026-01-19T13:00:00.000Z");
  const rows = deferEligibleRecipients([
    { id: 1, status: "eligible" }, { id: 2, status: "eligible" }, { id: 3, status: "sent" },
  ], due);
  assert.deepEqual(rows.map((row) => row.status), ["deferred", "deferred", "sent"]);
  assert.deepEqual(selectDueResumeCandidates(rows, new Date("2026-01-19T12:59:59.000Z")), []);
  assert.deepEqual(selectDueResumeCandidates(rows, due).map((row) => row.id), [1, 2]);
});

test("future scheduled launches are rejected when no delivery worker exists", () => {
  const now = new Date("2026-01-19T12:00:00.000Z");
  assert.equal(isFutureCampaignSchedule(new Date("2026-01-19T13:00:00.000Z"), now), true);
  assert.equal(isFutureCampaignSchedule(new Date("2026-01-19T11:00:00.000Z"), now), false);
  assert.equal(isFutureCampaignSchedule(null, now), false);
});

test("resume candidates exclude sent, uncertain, and early deferred rows", () => {
  const now = new Date("2026-01-20T13:00:00.000Z");
  assert.deepEqual(selectDueResumeCandidates([
    { id: 1, status: "sent", availableAt: null },
    { id: 2, status: "queued", availableAt: null },
    { id: 3, status: "deferred", availableAt: new Date("2026-01-21T13:00:00.000Z") },
    { id: 4, status: "deferred", availableAt: now },
  ], now).map((row) => row.id), [4]);
});

test("audience classification preserves actionable email exclusion reasons", () => {
  assert.equal(classifyEmailRecipient({ email: null, duplicate: false, unsubscribed: false, suppressed: false, capacityAvailable: true }), "missing_contact_info");
  assert.equal(classifyEmailRecipient({ email: "x@example.com", duplicate: true, unsubscribed: false, suppressed: false, capacityAvailable: true }), "duplicate_email");
  assert.equal(classifyEmailRecipient({ email: "x@example.com", duplicate: false, unsubscribed: true, suppressed: false, capacityAvailable: true }), "email_unsubscribed");
  assert.equal(classifyEmailRecipient({ email: "x@example.com", duplicate: false, unsubscribed: false, suppressed: true, capacityAvailable: true }), "email_suppressed");
  assert.equal(classifyEmailRecipient({ email: "x@example.com", duplicate: false, unsubscribed: false, suppressed: false, capacityAvailable: false }), "daily_email_capacity");
});

test("campaign audience union deduplicates IDs, prioritizes picked origin, and sorts by ID", () => {
  const audience = unionCampaignAudience(
    [{ id: 8, name: "filter" }, { id: 3, name: "both" }],
    [{ id: 3, name: "picked" }, { id: 10, name: "picked only" }],
  );
  assert.deepEqual(audience, [
    { id: 3, name: "picked", origin: "picked" },
    { id: 8, name: "filter", origin: "filtered" },
    { id: 10, name: "picked only", origin: "picked" },
  ]);
});

test("campaign exclusion breakdown distinguishes consent, suppression, prior sends and duplicates", () => {
  assert.deepEqual(campaignExclusionReasonCounts([
    { reason: "missing_contact_info" },
    { reason: "email_unsubscribed" },
    { reason: "email_suppressed" },
    { reason: "already_sent" },
    { reason: "duplicate_email" },
    { reason: "application_sms_consent_required" },
  ]), { noEmail: 1, unsubscribed: 1, suppressed: 1, alreadySent: 1, duplicate: 1, other: 1 });
});

test("a picked lead outside the filters is included but suppression excludes it with a visible reason", () => {
  const [picked] = unionCampaignAudience(
    [{ id: 5, email: "matched@example.com" }],
    [{ id: 27, email: "suppressed@example.com" }],
  ).filter((lead) => lead.id === 27);
  assert.equal(picked.origin, "picked");
  const reason = classifyEmailRecipient({
    email: picked.email, duplicate: false, unsubscribed: false,
    suppressed: true, capacityAvailable: true,
  });
  assert.equal(reason, "email_suppressed");
  assert.equal(campaignExclusionReasonCounts([{ reason, channel: "email" }]).suppressed, 1);
});

test("manual picks without filters never expand into an all-leads campaign", () => {
  assert.equal(includeCampaignFilterMatches(0, 2), false);
  assert.equal(includeCampaignFilterMatches(1, 2), true);
  assert.equal(includeCampaignFilterMatches(0, 0), true);
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

test("campaign Reply-To defaults and participates in approval hash", () => {
  const base = { channel: "email", replyToEmail: DEFAULT_CAMPAIGN_REPLY_TO, body: "approved" };
  assert.equal(DEFAULT_CAMPAIGN_REPLY_TO, "nate@my-business-solutions.com");
  assert.notEqual(campaignContentHash(base), campaignContentHash({ ...base, replyToEmail: "manager@example.com" }));
});

test("approval blocks unknown merge tokens before any provider send", () => {
  assert.equal(validateCampaignMergeTokens({ subject: "Hi {{lead_first_name}}", bodyHtml: "Thanks {{lead_company}}" }), null);
  assert.match(validateCampaignMergeTokens({ subject: "Hi {{unknown_token}}", bodyHtml: "Body" }) ?? "", /unknown_token/);
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

test("approval and launch reject empty or malformed eligible audience counts", () => {
  assert.equal(hasEligibleCampaignAudience({ eligible: 1 }), true);
  assert.equal(hasEligibleCampaignAudience({ eligible: 0 }), false);
  assert.equal(hasEligibleCampaignAudience(null), false);
  assert.equal(hasEligibleCampaignAudience({ eligible: "1" }), false);
});

test("provider-free validation reports no-send, tested address, audience count, and timestamp", () => {
  assert.deepEqual(buildCampaignValidationResult({
    toEmail: "manager@example.com",
    eligibleCount: 7,
    validatedAt: new Date("2026-09-22T23:00:00.000Z"),
  }), {
    mode: "dry_run",
    toEmail: "manager@example.com",
    eligibleCount: 7,
    validatedAt: "2026-09-22T23:00:00.000Z",
    message: "No provider message was sent. Use Launch Campaign after approval to deliver.",
  });
});

test("provider-free validation rejects inactive or missing content and exercises rendering", () => {
  assert.match(validateCampaignRender(null, (value) => value) ?? "", /active email template/);
  assert.match(validateCampaignRender({ subject: "Hi", bodyHtml: "Body", isActive: false }, (value) => value) ?? "", /active email template/);
  assert.match(validateCampaignRender({ subject: "Hi", bodyHtml: " ", isActive: true }, (value) => value) ?? "", /subject and body/);
  const rendered: string[] = [];
  assert.equal(validateCampaignRender({ subject: "Hi {{lead_email}}", bodyHtml: "<p>Hello</p>", isActive: true }, (value) => {
    rendered.push(value);
    return value.replace("{{lead_email}}", "qa@example.com");
  }), null);
  assert.deepEqual(rendered, ["Hi {{lead_email}}", "<p>Hello</p>"]);
});

test("approved audience remains the launch source after reload or newer preview changes", () => {
  const approval = { contentVersion: 3, invalidatedAt: null, snapshot: { counts: { eligible: 5, excluded: 2, emailCapacityRemaining: 20 } } };
  assert.deepEqual(approvedAudienceSummary("approved", 3, approval), {
    eligible: 5, excluded: 2, emailCapacityRemaining: 20, emailToday: 5, emailQueuedNextBusinessDay: 0,
  });
  assert.equal(approvedAudienceSummary("draft", 4, approval), null);
  assert.equal(approvedAudienceSummary("approved", 3, { ...approval, invalidatedAt: new Date() }), null);
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