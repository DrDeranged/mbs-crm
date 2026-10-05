import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { eq } from "drizzle-orm";
import { db, pool, usersTable, campaignsTable, campaignLaunchesTable, campaignRecipientsTable, campaignEngagementTable, campaignRepliesTable, emailSendsTable, leadsTable, lendersTable, activityLogTable } from "@workspace/db";
import { mostRecentCampaign, attributeReferral, attributeInboundCall, validateReferrer, ATTRIBUTION_WINDOW_MS, digestReplyToken, signAttributionToken, verifyAttributionToken, referrerLabel, recordValidatedFlyerClick } from "./campaignAttribution";
import { authenticateInboundParse, automatedReply, parseMailHeaders, replyAddressToken, replyDedupeKey, safeReplyText } from "./campaignReplyPolicy";
import { reconcileCampaignMetrics } from "./campaignMetrics";
import { calculateRatePoints } from "./ratePoints";
import { createCampaignRepliesRouter } from "../routes/campaignReplies";
after(() => pool.end());

test("flyer recording failure propagates rather than silently accepting a redirect", async () => {
  const query = { from() { return this; }, innerJoin() { return this; }, where() { return this; }, async limit() { return [{ sendId: 1 }]; } };
  const failure = new Error("fixture persistence unavailable");
  await assert.rejects(recordValidatedFlyerClick({ campaignId: 1, launchId: 1, leadId: 1, recipientId: 1 }, {},
    { select: () => query, insert: () => { throw failure; } }), error => error === failure);
});

test("Parse authentication is independent, constant-time digest matched, and rejects malformed credentials", () => {
  const auth = "Basic " + Buffer.from("mbs-parse:fixture-secret").toString("base64");
  assert.equal(authenticateInboundParse(auth, "fixture-secret"), true);
  for (const bad of [undefined, "Bearer anything", "Basic " + Buffer.from("mbs-parse:wrong").toString("base64")]) assert.equal(authenticateInboundParse(bad, "fixture-secret"), false);
  assert.equal(authenticateInboundParse(auth, undefined), false);
});
test("Reply exclusions, opaque envelope addresses, stable message dedupe and text-only rendering", () => {
  for (const h of [{ "auto-submitted": "auto-replied" }, { precedence: "bulk" }, { "x-mbs-forwarded-reply": "8" }] as Array<Record<string, string>>) assert.equal(automatedReply(h, "customer@example.test"), true);
  assert.equal(automatedReply({}, "mailer-daemon@example.test"), true);
  assert.equal(automatedReply({ "auto-submitted": "no" }, "customer@example.test"), false);
  const token = "a".repeat(48);
  assert.equal(replyAddressToken(JSON.stringify({ to: [`r-${token}@replies.my-business-solutions.com`] })), token);
  assert.equal(replyAddressToken(JSON.stringify({ to: ["nate@my-business-solutions.com"] })), null);
  assert.equal(replyAddressToken(JSON.stringify({ to: [`r-${token}@replies.my-business-solutions.com`, "other@example.test"] })), null);
  const headers = parseMailHeaders("Message-ID: <message@example.test>\r\nSubject: folded\r\n line");
  assert.equal(headers.subject, "folded line");
  assert.equal(replyDedupeKey(3, headers, "a", "subject", "one", []), replyDedupeKey(3, headers, "a", "subject", "redelivered", []));
  assert.notEqual(replyDedupeKey(3, headers, "a", "", "", []), replyDedupeKey(4, headers, "a", "", "", []));
  assert.equal(safeReplyText("", "<script>alert(1)</script><p>Human reply</p>"), "Human reply\n");
});
test("Signed referral context rejects edits, cross-purpose tokens and expiry", () => {
  const token = signAttributionToken({ kind: "referral", type: "lead", id: 3, expiresAt: Date.now() + 60_000 });
  assert.equal(verifyAttributionToken(token)?.id, 3);
  assert.equal(verifyAttributionToken(token + "x"), null);
  assert.equal(verifyAttributionToken(signAttributionToken({ expiresAt: 1 })), null);
  assert.equal(verifyAttributionToken("not-a-token"), null);
});
test("KPI reconciliation deduplicates cohorts/deals, excludes pre-attribution milestones, labels unknown history and reuses rate calculator", () => {
  const at = new Date("2026-09-20T12:00:00Z");
  const later = new Date(at.getTime() + 1000), earlier = new Date(at.getTime() - 1000);
  const calculation = calculateRatePoints({ advance: 10000, payment: 1200, term: 12, timing: "arrears", buyNominalRate: 0.1 })!;
  const data = {
    recipients: [{ id: 1, campaignId: 1, leadId: 2, channel: "email", status: "sent", emailSendId: 1 }],
    sends: [{ id: 1, campaignId: 1, leadId: 2, status: "delivered", sentAt: at, sendgridMessageId: "msg", deliveryKind: "bulk" }],
    engagement: [{ id: 1, campaignId: 1, leadId: 2, kind: "referral", occurredAt: at },
      ...[1, 2].map(id => ({ id, campaignId: 1, leadId: 2, kind: "flyer_click", occurredAt: later }))],
    replies: [], webhookEvents: [{ eventType: "delivered", messageId: "msg.filter" }], leads: [],
    deals: [7, 7, 8].map(id => ({ id, leadId: 2, stage: "funded", createdAt: earlier, fundedAt: id === 7 ? later : earlier, amount: 10000, actualGm: calculation.totalCommission })),
    histories: [{ leadId: 2, toStatus: "approved", createdAt: earlier }, { leadId: 2, toStatus: "submitted_to_underwriting", createdAt: later }],
    activities: [{ id: 1, dealId: 7, action: "rate_points_saved", createdAt: later, details: { advance: 10000, payment: 1200, term: 12, timing: "arrears", buyNominalRate: 0.1 } }], approvals: [],
  };
  const result = reconcileCampaignMetrics({ id: 1, name: "Fixture", trackingSince: at }, data, true);
  assert.equal(result.sent, 1); assert.equal(result.deliveredPct, 100);
  assert.equal(result.uniqueFlyerClicks, 1); assert.equal(result.totalFlyerClicks, 2);
  assert.equal(result.engagedLeads[0].leadId, 2);
  assert.equal(result.engagedLeads[0].totalFlyerClicks, 2);
  assert.equal(result.referredLeads, 1); assert.equal(result.submitted, 1); assert.equal(result.approved, 0); assert.equal(result.funded, 1);
  assert.equal(result.fundedDollars, 10000); assert.ok(Math.abs(result.mbsPoints! - calculation.points) < 0.0001);
  const historical = reconcileCampaignMetrics({ id: 1, name: "Old", trackingSince: null }, data, false);
  assert.equal(historical.replies, null); assert.equal(historical.calls, null); assert.equal(historical.uniqueFlyerClicks, null);
  assert.equal(reconcileCampaignMetrics({ id: 2, name: "Tracked empty", trackingSince: at }, data, true).uniqueFlyerClicks, 0);
  const backdated = reconcileCampaignMetrics({ id: 1, name: "Backdated", trackingSince: at }, {
    ...data, histories: [], approvals: [], activities: [],
    deals: [{ id: 8, leadId: 2, stage: "funded", createdAt: later, fundedAt: earlier, amount: 10000 }],
  }, true);
  assert.equal(backdated.funded, 0, "current stage/createdAt never replaces a known pre-attribution funding date");
  const notSent = reconcileCampaignMetrics({ id: 1, name: "Not sent", trackingSince: at }, {
    ...data, recipients: [], engagement: [], sends: [{ ...data.sends[0], status: "queued" }],
  }, true);
  assert.equal(notSent.sent, 0); assert.equal(notSent.submitted, 0);
});

test("Real database attribution and Parse redelivery reconcile without live communications", { skip: !process.env.DATABASE_URL }, async () => {
  const rollback = new Error("ROLLBACK_CAMPAIGN_FIXTURE");
  await assert.rejects(db.transaction(async tx => {
    const key = randomUUID();
    const [user] = await tx.insert(usersTable).values({ clerkId: `fixture-campaign-${key}`, email: `fixture-${key}@example.test`, role: "admin" }).returning();
    const [lead] = await tx.insert(leadsTable).values({ companyName: "Synthetic referrer", email: `recipient-${key}@example.test`, phone: "+1 (555) 010-0913", assignedRepId: user.id }).returning();
    const [child] = await tx.insert(leadsTable).values({ companyName: "Synthetic referred applicant", assignedRepId: user.id }).returning();
    const [partner] = await tx.insert(lendersTable).values({ name: `Synthetic partner ${key}`, contactEmail: lead.email }).returning();
    const now = new Date();
    const campaigns = await tx.insert(campaignsTable).values([0, 1].map(i => ({ name: `Attribution fixture ${i} ${key}`, ownerId: user.id, createdBy: user.id, trackingSince: now }))).returning();
    const launches = await tx.insert(campaignLaunchesTable).values(campaigns.map(c => ({ campaignId: c.id, idempotencyKey: `fixture-${c.id}-${key}`, requestedBy: user.id, mode: "live" }))).returning();
    const rawToken = "b".repeat(48);
    const sends = await tx.insert(emailSendsTable).values(campaigns.map((c, i) => ({
      leadId: lead.id, campaignId: c.id, campaignLaunchId: launches[i].id, subject: "Synthetic fixture",
      toEmail: lead.email!, fromEmail: "fixture-sender@example.test", status: "sent" as const,
      deliveryKind: "bulk" as const, sentAt: new Date(now.getTime() - (i === 0 ? ATTRIBUTION_WINDOW_MS : 5000)),
      replyTokenDigest: i === 1 ? digestReplyToken(rawToken) : null, originalReplyTo: i === 1 ? "fixture-forward@example.test" : null,
    }))).returning();
    const recipients = await tx.insert(campaignRecipientsTable).values(sends.map((s, i) => ({ campaignId: campaigns[i].id, launchId: launches[i].id, leadId: lead.id, channel: "email", status: "sent" as const, emailSendId: s.id }))).returning();
    const click = { campaignId: campaigns[1].id, launchId: launches[1].id, leadId: lead.id, recipientId: recipients[1].id };
    assert.equal(await recordValidatedFlyerClick(click, { digest: "fixture" }, tx), true);
    assert.equal(await recordValidatedFlyerClick(click, { digest: "fixture" }, tx), true);
    assert.equal(await recordValidatedFlyerClick({ ...click, leadId: child.id }, {}, tx), false);
    assert.equal(await recordValidatedFlyerClick({ ...click, recipientId: -1 }, {}, tx), false);
    const clicks = await tx.select().from(campaignEngagementTable).where(eq(campaignEngagementTable.kind, "flyer_click"));
    assert.equal(clicks.filter(e => e.leadId === lead.id).length, 2);
    assert.equal((await mostRecentCampaign(lead.id, now, tx))?.campaignId, campaigns[1].id);
    assert.equal((await mostRecentCampaign(lead.id, now, tx, sends[0].id))?.campaignId, campaigns[0].id, "inclusive 30-day boundary");
    assert.equal(await mostRecentCampaign(lead.id, new Date(now.getTime() + 1), tx, sends[0].id), null);
    await tx.update(emailSendsTable).set({ status: "bounced" }).where(eq(emailSendsTable.id, sends[1].id));
    assert.equal((await mostRecentCampaign(lead.id, now, tx))?.campaignId, campaigns[0].id);
    await tx.update(emailSendsTable).set({ status: "sent" }).where(eq(emailSendsTable.id, sends[1].id));
    await attributeReferral(child.id, { referredByLeadId: lead.id, referredByPartnerId: null }, now, tx);
    await attributeReferral(child.id, { referredByLeadId: lead.id, referredByPartnerId: null }, now, tx, sends[0].id);
    const referrals = await tx.select().from(campaignEngagementTable).where(eq(campaignEngagementTable.sourceKey, `referral:${child.id}`));
    assert.equal(referrals.length, 1); assert.equal(referrals[0].campaignId, campaigns[1].id, "credit never replaced by later call");
    assert.equal(await referrerLabel({ referredByLeadId: lead.id, referredByPartnerId: null }, { role: "rep", id: -1 }, tx), null);
    await assert.rejects(validateReferrer({ referredByLeadId: lead.id }, { role: "rep", id: -1 }, child.id, tx));
    await assert.rejects(validateReferrer({ referredByLeadId: lead.id }, { role: "admin", id: user.id }, lead.id, tx));
    await assert.rejects(validateReferrer({ referredByLeadId: lead.id, referredByPartnerId: partner.id }, user, child.id, tx));
    assert.deepEqual(await validateReferrer({ referredByLeadId: null, referredByPartnerId: null }, user, child.id, tx), { referredByLeadId: null, referredByPartnerId: null });
    const sid = `fixture-${key}`;
    await attributeInboundCall(sid, "15550100913", now, tx);
    await attributeInboundCall(sid, "15550100913", new Date(now.getTime() + 60000), tx);
    assert.equal((await tx.select().from(campaignEngagementTable).where(eq(campaignEngagementTable.sourceKey, `call:${sid}`))).length, 1);
    await tx.insert(leadsTable).values({ phone: "555-010-0913" });
    await attributeInboundCall(`${sid}-ambiguous`, "15550100913", now, tx);
    assert.equal((await tx.select().from(campaignEngagementTable).where(eq(campaignEngagementTable.sourceKey, `call:${sid}-ambiguous`))).length, 0);
    let providerCalls = 0, failure: number | null = null;
    const stored = new Map<string, Buffer>();
    const storage = { bucket: () => ({ file: (path: string) => ({
      async save(bytes: Buffer) { stored.set(path, bytes); },
      async download() { return [stored.get(path)]; },
    }) }) } as any;
    const app = express(); app.use(express.json()); app.use((req, _res, next) => { (req as any).log = { error() {} }; next(); });
    app.use(createCampaignRepliesRouter({ database: tx, inboundSecret: "fixture-secret", captureEnabled: true, forwardingEnabled: () => true,
      privateObjectDir: "/fixture-bucket/private", storage,
      provider: { async send(message: any) { providerCalls++; assert.equal(message.replyTo.email, "human@example.test"); assert.equal(message.to, "fixture-forward@example.test"); if (message.attachments) {
        assert.equal(message.attachments[0].type, "application/pdf");
        assert.equal(Buffer.from(message.attachments[0].content, "base64").toString(), "%PDF-fixture");
      } if (failure) throw { response: { statusCode: failure } }; return [] as any; } } }));
    const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
    const endpoint = `http://127.0.0.1:${(server.address() as any).port}/sendgrid/inbound-parse`;
    const post = (messageId: string, extra = "", auth = true) => fetch(endpoint, { method: "POST",
      headers: { "content-type": "application/json", ...(auth ? { authorization: "Basic " + Buffer.from("mbs-parse:fixture-secret").toString("base64") } : {}) },
      body: JSON.stringify({ from: "Human <human@example.test>", subject: "Synthetic reply", text: "A real plain text fixture", headers: `Message-ID: <${messageId}>\r\n${extra}`, envelope: JSON.stringify({ to: [`r-${rawToken}@replies.my-business-solutions.com`] }) }) });
    try {
      assert.equal((await post("unauthorized", "", false)).status, 403);
      assert.equal((await post("auto", "Auto-Submitted: auto-replied")).status, 202); assert.equal(providerCalls, 0);
      assert.equal((await post("first")).status, 202); assert.equal((await post("first")).status, 202); assert.equal(providerCalls, 1);
      failure = 503; assert.equal((await post("uncertain")).status, 202);
      await post("uncertain"); assert.equal(providerCalls, 2, "uncertain forwards do not retry");
      failure = 400; assert.equal((await post("definite-failure")).status, 503);
      failure = null; assert.equal((await post("definite-failure")).status, 202); assert.equal(providerCalls, 4);
      const multipart = async (mime: string, messageId: string) => {
        const form = new FormData();
        for (const [key, value] of Object.entries({ from: "human@example.test", subject: "Attachment fixture", text: "Attachment body",
          headers: `Message-ID: <${messageId}>`, envelope: JSON.stringify({ to: [`r-${rawToken}@replies.my-business-solutions.com`] }) })) form.append(key, value);
        form.append("attachment1", new Blob(["%PDF-fixture"], { type: mime }), "document.pdf");
        return fetch(endpoint, { method: "POST", headers: { authorization: "Basic " + Buffer.from("mbs-parse:fixture-secret").toString("base64") }, body: form });
      };
      assert.equal((await multipart("image/svg+xml", "unsupported")).status, 415);
      assert.equal((await multipart("application/pdf", "attachment")).status, 202);
      assert.equal((await multipart("application/pdf", "attachment")).status, 202);
      assert.equal(providerCalls, 5); assert.equal(stored.size, 1, "redelivery does not re-upload or re-forward");
      const replies = await tx.select().from(campaignRepliesTable).where(eq(campaignRepliesTable.emailSendId, sends[1].id));
      assert.equal(replies.length, 4); assert.equal(replies.filter(r => r.forwardStatus === "uncertain").length, 1);
      const timeline = await tx.select().from(activityLogTable).where(eq(activityLogTable.leadId, lead.id));
      assert.equal(timeline.filter(a => a.action === "campaign_reply_received").length, 4);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
    throw rollback;
  }), error => error === rollback);
});
