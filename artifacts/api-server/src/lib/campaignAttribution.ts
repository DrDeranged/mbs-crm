import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, or, desc, eq, gte, lte, sql, inArray } from "drizzle-orm";
import { db, campaignRecipientsTable, campaignLaunchesTable, emailSendsTable, emailWebhookEventsTable, leadsTable, lendersTable, campaignEngagementTable, campaignCallAttributionsTable } from "@workspace/db";

export const ATTRIBUTION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export const REPLY_DOMAIN = "replies.my-business-solutions.com";
export const digestReplyToken = (token: string) => createHash("sha256").update(token).digest("hex");
export function replyCaptureConfigured() {
  return Boolean(process.env.SENDGRID_INBOUND_PARSE_SECRET?.trim() && process.env.SENDGRID_INBOUND_PARSE_ENABLED === "true");
}
export function signAttributionToken(payload: object) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("Attribution signing is not configured");
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${createHmac("sha256", secret).update(`campaign-attribution:${encoded}`).digest("base64url")}`;
}
export function verifyAttributionToken(token: string): any | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret || token.length > 8192) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const expected = createHmac("sha256", secret).update(`campaign-attribution:${parts[0]}`).digest();
  const actual = Buffer.from(parts[1], "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    return Number.isFinite(payload.expiresAt) && payload.expiresAt > Date.now() ? payload : null;
  } catch { return null; }
}

/** Positive, live receipt evidence only; deterministic ID breaks same-time ties. */
export async function mostRecentCampaign(leadId: number, at: Date, database: any = db, explicitSendId?: number) {
  const receiptTime = sql<Date>`coalesce(${emailSendsTable.sentAt}, ${campaignRecipientsTable.sentAt})`;
  const rows = await database.select({
    campaignId: campaignRecipientsTable.campaignId, launchId: campaignRecipientsTable.launchId,
    emailSendId: emailSendsTable.id, sentAt: receiptTime,
  }).from(campaignRecipientsTable)
    .innerJoin(campaignLaunchesTable, eq(campaignLaunchesTable.id, campaignRecipientsTable.launchId))
    .leftJoin(emailSendsTable, eq(emailSendsTable.id, campaignRecipientsTable.emailSendId))
    .where(and(eq(campaignRecipientsTable.leadId, leadId), eq(campaignRecipientsTable.status, "sent"),
      eq(campaignLaunchesTable.mode, "live"),
      or(and(eq(campaignRecipientsTable.channel, "email"),
        eq(emailSendsTable.campaignId, campaignRecipientsTable.campaignId),
        eq(emailSendsTable.campaignLaunchId, campaignRecipientsTable.launchId),
        inArray(emailSendsTable.status, ["sent", "delivered", "opened", "clicked", "unsubscribed"]),
        sql`NOT EXISTS (SELECT 1 FROM ${emailWebhookEventsTable} e
          WHERE e.event_type IN ('bounce','blocked','dropped')
          AND split_part(replace(replace(e.message_id, '<', ''), '>', ''), '.', 1) =
              split_part(replace(replace(${emailSendsTable.sendgridMessageId}, '<', ''), '>', ''), '.', 1))`),
        eq(campaignRecipientsTable.channel, "sms")),
      gte(receiptTime, new Date(at.getTime() - ATTRIBUTION_WINDOW_MS)), lte(receiptTime, at),
      explicitSendId ? eq(emailSendsTable.id, explicitSendId) : undefined))
    .orderBy(desc(receiptTime), desc(campaignRecipientsTable.id)).limit(1);
  return rows[0] ?? null;
}

export function normalizedCallerPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}
export async function recordValidatedFlyerClick(a: { campaignId: number; launchId: number; leadId: number; recipientId: number }, evidence: object, database: any = db) {
  if (![a.campaignId, a.launchId, a.leadId, a.recipientId].every(id => Number.isSafeInteger(id) && id > 0)) return false;
  const [recipient] = await database.select({ sendId: emailSendsTable.id }).from(campaignRecipientsTable)
    .innerJoin(campaignLaunchesTable, eq(campaignLaunchesTable.id, campaignRecipientsTable.launchId))
    .innerJoin(emailSendsTable, eq(emailSendsTable.id, campaignRecipientsTable.emailSendId))
    .where(and(eq(campaignRecipientsTable.id, a.recipientId), eq(campaignRecipientsTable.campaignId, a.campaignId),
      eq(campaignRecipientsTable.launchId, a.launchId), eq(campaignRecipientsTable.leadId, a.leadId),
      eq(campaignRecipientsTable.status, "sent"), eq(campaignLaunchesTable.mode, "live"),
      eq(emailSendsTable.campaignId, a.campaignId), eq(emailSendsTable.campaignLaunchId, a.launchId),
      eq(emailSendsTable.leadId, a.leadId))).limit(1);
  if (!recipient) return false;
  await database.insert(campaignEngagementTable).values({
    campaignId: a.campaignId, launchId: a.launchId, leadId: a.leadId,
    emailSendId: recipient.sendId, kind: "flyer_click", evidence,
  });
  return true;
}
/** Records no-match/ambiguity too, so late callbacks cannot invent a new credit. */
export async function attributeInboundCall(callSid: string, from: string, originalAt: Date, database: any = db) {
  if (!callSid) return;
  await database.transaction(async (tx: any) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`campaign-call:${callSid}`}))`);
    const [existing] = await tx.select().from(campaignCallAttributionsTable).where(eq(campaignCallAttributionsTable.callSid, callSid)).limit(1);
    if (existing) return;
    const phone = normalizedCallerPhone(from);
    const candidates = phone.length >= 7 ? await tx.select({ id: leadsTable.id }).from(leadsTable)
      .where(sql`CASE WHEN length(regexp_replace(${leadsTable.phone}, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(${leadsTable.phone}, '[^0-9]', '', 'g'), 1) = '1'
        THEN right(regexp_replace(${leadsTable.phone}, '[^0-9]', '', 'g'), 10)
        ELSE regexp_replace(${leadsTable.phone}, '[^0-9]', '', 'g') END = ${phone}`).limit(2) : [];
    const leadId = candidates.length === 1 ? candidates[0].id : null;
    const source = leadId ? await mostRecentCampaign(leadId, originalAt, tx) : null;
    await tx.insert(campaignCallAttributionsTable).values({
      callSid, leadId, originalAt, campaignId: source?.campaignId ?? null,
      reason: candidates.length > 1 ? "ambiguous_phone" : !leadId ? "unmatched_phone" : !source ? "no_qualifying_send" : "last_touch_30_days",
    });
    if (source && leadId) await tx.insert(campaignEngagementTable).values({
      campaignId: source.campaignId, launchId: source.launchId, emailSendId: source.emailSendId,
      leadId, kind: "inbound_call", sourceKey: `call:${callSid}`,
      occurredAt: originalAt, evidence: { rule: "last_touch_30_days", sentAt: source.sentAt, callSid },
    }).onConflictDoNothing();
  });
}

export type Referrer = { referredByLeadId: number | null; referredByPartnerId: number | null };
export async function validateReferrer(data: any, user: { id: number; role: string } | null, selfId?: number, database: any = db): Promise<Referrer> {
  const leadId = data.referredByLeadId ?? null, partnerId = data.referredByPartnerId ?? null;
  if ((leadId !== null && (!Number.isSafeInteger(leadId) || leadId <= 0)) ||
      (partnerId !== null && (!Number.isSafeInteger(partnerId) || partnerId <= 0)) ||
      (leadId !== null && partnerId !== null) || (leadId !== null && leadId === selfId)) throw new Error("Invalid or self referral");
  if (leadId) {
    const [target] = await database.select().from(leadsTable).where(eq(leadsTable.id, leadId)).limit(1);
    if (!target || (user?.role === "rep" && target.assignedRepId !== user.id)) throw new Error("Referrer not available");
  }
  if (partnerId) {
    const [target] = await database.select().from(lendersTable).where(eq(lendersTable.id, partnerId)).limit(1);
    if (!target) throw new Error("Referrer not available");
  }
  return { referredByLeadId: leadId, referredByPartnerId: partnerId };
}

export async function referrerRecipient(referrer: Referrer, database: any = db): Promise<number | null> {
  if (referrer.referredByLeadId) return referrer.referredByLeadId;
  if (!referrer.referredByPartnerId) return null;
  const [partner] = await database.select({ email: lendersTable.contactEmail }).from(lendersTable).where(eq(lendersTable.id, referrer.referredByPartnerId)).limit(1);
  if (!partner?.email) return null;
  const rows = await database.select({ id: leadsTable.id }).from(leadsTable)
    .where(sql`lower(trim(${leadsTable.email})) = ${partner.email.trim().toLowerCase()}`).limit(2);
  return rows.length === 1 ? rows[0].id : null;
}
export async function referrerLabel(referrer: Referrer, user: { id: number; role: string }, database: any = db): Promise<string | null> {
  if (referrer.referredByLeadId) {
    const [lead] = await database.select().from(leadsTable).where(and(eq(leadsTable.id, referrer.referredByLeadId),
      user.role === "rep" ? eq(leadsTable.assignedRepId, user.id) : undefined)).limit(1);
    return lead ? lead.companyName || `${lead.firstName ?? ""} ${lead.lastName ?? ""}`.trim() || `Lead #${lead.id}` : null;
  }
  if (referrer.referredByPartnerId) {
    const [partner] = await database.select({ name: lendersTable.name }).from(lendersTable).where(eq(lendersTable.id, referrer.referredByPartnerId)).limit(1);
    return partner?.name ?? null;
  }
  return null;
}
/** Only creation establishes campaign credit; later edits are audited, not recredited. */
export async function attributeReferral(leadId: number, referrer: Referrer, at: Date, database: any = db, explicitSendId?: number) {
  const recipient = await referrerRecipient(referrer, database);
  const source = recipient ? await mostRecentCampaign(recipient, at, database, explicitSendId) : null;
  if (source) await database.insert(campaignEngagementTable).values({
    campaignId: source.campaignId, launchId: source.launchId, emailSendId: source.emailSendId,
    leadId, kind: "referral", sourceKey: `referral:${leadId}`, occurredAt: at,
    evidence: { ...referrer, referrerLeadId: recipient, rule: explicitSendId ? "signed_campaign_provenance" : "last_touch_30_days", sentAt: source.sentAt },
  }).onConflictDoNothing();
}
