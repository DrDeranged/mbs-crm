import crypto from "node:crypto";
import sgMail from "@sendgrid/mail";
import twilio from "twilio";
import { db } from "@workspace/db";
import {
  activityLogTable,
  communicationsTable,
  companySettingsTable,
  documentsTable,
  idempotencyKeysTable,
  leadsTable,
  tasksTable,
  usersTable,
} from "@workspace/db";
import { and, desc, eq, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { ObjectStorageService } from "./objectStorage";
import { logActivity } from "./activityHelper";
import { createNotification } from "./notify";
import { logger } from "./logger";
import { getLeadSmsEligibility } from "./smsEligibility";
import { isUsfaMarketingBlocked } from "./intake/usfaCompliance";
import { getTelephonySettings } from "./telephonySettings";
import { isWithinVoiceHours, newYorkBusinessTime } from "./inboundVoice";

const PLAYBACK_TTL_SECONDS = 15 * 60;
const FUNDING_EMAIL = "funding@my-business-solutions.com";
const DEFAULT_GREETING =
  "Thanks for calling My Business Solutions. Please leave your name, business name, and phone number, and a representative will call you back within one business day.";
export const MISSED_CALL_TEXT =
  "Sorry we missed your call — a My Business Solutions rep will call you back shortly. Reply STOP to opt out.";

export function missedCallTextBackClaimKey(leadId: number, callTime: Date): string {
  return `missed-call-text-back:${leadId}:${newYorkBusinessTime(callTime).date}`;
}

export function shouldSendMissedCallTextBack(input: {
  enabled: boolean;
  hasRecording: boolean;
  callOutcome: string | null;
  callTime: Date;
  voiceSettings: {
    voiceHoursStart: string;
    voiceHoursEnd: string;
    voiceBusinessDays: number[];
    voiceHolidays: string[];
  };
  smsEligible: boolean;
  usfaBlocked: boolean;
  twilioConfigured: boolean;
}): boolean {
  return input.enabled
    && !input.hasRecording
    && input.callOutcome !== "voicemail"
    && input.callOutcome !== "connected"
    && isWithinVoiceHours(input.voiceSettings, input.callTime)
    && input.smsEligible
    && !input.usfaBlocked
    && input.twilioConfigured;
}

export type VoicemailCompleteInput = {
  callSid: string;
  recordingSid: string;
  recordingUrl?: string | null;
  recordingDuration?: string | number | null;
  transcriptionText?: string | null;
  transcriptionStatus?: string | null;
};

export type VoicemailResult = {
  leadId: number;
  documentId: number;
  taskIds: number[];
  playbackPath: string;
  duplicate: boolean;
};

export type RecordingCompleteInput = {
  callSid: string;
  recordingSid: string;
  recordingUrl: string;
  recordingDuration?: string | number | null;
};

type VoicemailCallbackState = {
  phase: "processing" | "recorded" | "notified";
  callSid: string;
  recordingSid: string;
  documentId?: number;
  emailClaimed?: boolean;
  leaseUntil: number;
};

async function claimVoicemailCallback(callSid: string, recordingSid: string): Promise<{ acquired: boolean; state: VoicemailCallbackState }> {
  const key = `${callSid}:${recordingSid}`;
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
    const [row] = await tx.select().from(idempotencyKeysTable).where(and(
      eq(idempotencyKeysTable.key, key),
      eq(idempotencyKeysTable.endpoint, "twilio.voicemail"),
    )).limit(1);
    const now = Date.now();
    if (row) {
      const state = (row.resultPayload ?? {}) as Partial<VoicemailCallbackState>;
      if (state.leaseUntil && state.leaseUntil > now) {
        return { acquired: false, state: state as VoicemailCallbackState };
      }
      const next = { ...state, callSid, recordingSid, phase: state.phase === "notified" ? "notified" : "processing", leaseUntil: now + 5 * 60_000 } as VoicemailCallbackState;
      await tx.update(idempotencyKeysTable).set({ resultPayload: next }).where(eq(idempotencyKeysTable.id, row.id));
      return { acquired: true, state: next };
    }
    const state: VoicemailCallbackState = { callSid, recordingSid, phase: "processing", leaseUntil: now + 5 * 60_000 };
    await tx.insert(idempotencyKeysTable).values({ key, endpoint: "twilio.voicemail", resultPayload: state });
    return { acquired: true, state };
  });
}

async function saveVoicemailCallbackState(callSid: string, recordingSid: string, patch: Partial<VoicemailCallbackState>): Promise<void> {
  const key = `${callSid}:${recordingSid}`;
  const [row] = await db.select().from(idempotencyKeysTable).where(and(eq(idempotencyKeysTable.key, key), eq(idempotencyKeysTable.endpoint, "twilio.voicemail"))).limit(1);
  if (!row) return;
  const state = { ...(row.resultPayload as object ?? {}), ...patch, leaseUntil: Date.now() } as VoicemailCallbackState;
  await db.update(idempotencyKeysTable).set({ resultPayload: state }).where(eq(idempotencyKeysTable.id, row.id));
}

async function claimVoicemailEmail(callSid: string, recordingSid: string): Promise<boolean> {
  const key = `${callSid}:${recordingSid}`;
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${key}:email`}))`);
    const [row] = await tx.select().from(idempotencyKeysTable).where(and(eq(idempotencyKeysTable.key, key), eq(idempotencyKeysTable.endpoint, "twilio.voicemail"))).limit(1);
    if (!row || (row.resultPayload as VoicemailCallbackState | null)?.emailClaimed) return false;
    await tx.update(idempotencyKeysTable).set({ resultPayload: { ...(row.resultPayload as object ?? {}), emailClaimed: true, phase: "notified", leaseUntil: Date.now() } }).where(eq(idempotencyKeysTable.id, row.id));
    return true;
  });
}

function playbackSecret(): string | null {
  return process.env.SESSION_SECRET || process.env.UNSUB_SECRET || null;
}

function requirePlaybackSecret(): void {
  if (!playbackSecret()) throw new Error("Voicemail playback signing secret is not configured");
}

export function createVoicemailPlaybackToken(documentId: number, expiresAt = Date.now() + PLAYBACK_TTL_SECONDS * 1000): string {
  const secret = playbackSecret();
  if (!secret) throw new Error("Voicemail playback signing secret is not configured");
  const payload = `${documentId}.${expiresAt}`;
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${Buffer.from(payload).toString("base64url")}.${signature}`;
}

export function verifyVoicemailPlaybackToken(token: string): number | null {
  const secret = playbackSecret();
  if (!secret) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  let payload: string;
  try {
    payload = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const [rawId, rawExpiry] = payload.split(".");
  const id = Number(rawId);
  const expiresAt = Number(rawExpiry);
  if (!Number.isInteger(id) || id < 1 || !Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  return id;
}

async function dueBusinessDate(now = new Date()): Promise<string> {
  const [settings] = await db.select({
    voiceHoursStart: companySettingsTable.voiceHoursStart,
    voiceHoursEnd: companySettingsTable.voiceHoursEnd,
    voiceBusinessDays: companySettingsTable.voiceBusinessDays,
    voiceHolidays: companySettingsTable.voiceHolidays,
  }).from(companySettingsTable).limit(1);
  const businessDays = new Set(settings?.voiceBusinessDays ?? [1, 2, 3, 4, 5]);
  const holidays = new Set(settings?.voiceHolidays ?? []);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const get = (name: string) => parts.find((p) => p.type === name)?.value ?? "";
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const date = new Date(Date.UTC(Number(get("year")), Number(get("month")) - 1, Number(get("day"))));
  let weekday = dayNames.indexOf(get("weekday"));
  const holidayKey = () => date.toISOString().slice(0, 10);
  const [endHour, endMinute] = (settings?.voiceHoursEnd ?? "18:00").split(":").map(Number);
  const afterHours = Number(get("hour")) * 60 + Number(get("minute")) >= endHour * 60 + endMinute;
  if (!businessDays.has(weekday) || holidays.has(holidayKey()) || afterHours) {
    do {
      date.setUTCDate(date.getUTCDate() + 1);
      weekday = date.getUTCDay();
    } while (!businessDays.has(weekday) || holidays.has(holidayKey()));
  }
  return date.toISOString().slice(0, 10);
}

async function fetchRecording(recordingUrl: string, recordingSid: string): Promise<{ bytes: Buffer; contentType: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error("Twilio credentials are required to fetch voicemail recordings");
  if (!/^RE[a-f0-9]{32}$/i.test(recordingSid)) throw new Error("Invalid Twilio recording SID");
  const url = new URL(recordingUrl);
  const allowedHosts = new Set(["api.twilio.com", "api.us1.twilio.com", "api.ie1.twilio.com", "api.au1.twilio.com"]);
  const expectedPath = `/2010-04-01/Accounts/${sid}/Recordings/${recordingSid}`;
  if (url.protocol !== "https:" || url.port || !allowedHosts.has(url.hostname) || (url.pathname !== expectedPath && url.pathname !== `${expectedPath}.mp3`) || url.search || url.hash) {
    throw new Error("Untrusted Twilio recording URL");
  }
  const response = await fetch(url.pathname.endsWith(".mp3") ? url.toString() : `${url.toString()}.mp3`, {
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Twilio recording download failed (${response.status})`);
  return { bytes: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get("content-type") || "audio/mpeg" };
}

function playbackPath(documentId: number): string {
  return `/api/storage/voicemail-playback/${createVoicemailPlaybackToken(documentId)}`;
}

function stableDocumentPath(documentId: number): string {
  return `/api/documents/${documentId}/download`;
}

function trustedAppUrl(path: string): string {
  const configured = process.env.APP_URL || process.env.PUBLIC_APP_URL || "https://app.my-business-solutions.com";
  const base = new URL(configured);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) {
    throw new Error("APP_URL must be a trusted HTTPS origin");
  }
  const allowed = new Set(["app.my-business-solutions.com", ...(process.env.TRUSTED_APP_HOSTS || "").split(",").map((host) => host.trim()).filter(Boolean)]);
  if (!allowed.has(base.hostname)) throw new Error("APP_URL is not an allowed application origin");
  return new URL(path, `${base.origin}/`).toString();
}

/**
 * Fetches a Twilio recording with server-side credentials and replaces the
 * provider URL on the communication with an authenticated CRM playback path.
 * This is intentionally reusable for outbound/answered-call recording
 * callbacks as well as voicemail callbacks.
 */
export async function handleRecordingComplete(input: RecordingCompleteInput): Promise<{ documentId: number; playbackPath: string } | null> {
  requirePlaybackSecret();
  const communication = await db.query.communicationsTable.findFirst({ where: eq(communicationsTable.twilioSid, input.callSid) });
  if (!communication?.leadId) return null;
  const fileKey = `leads/${communication.leadId}/documents/call-recording-${input.recordingSid}.mp3`;
  const existing = await db.query.documentsTable.findFirst({ where: eq(documentsTable.fileKey, fileKey) });
  if (existing) {
    const link = playbackPath(existing.id);
    await db.update(communicationsTable).set({ recordingSid: input.recordingSid, recordingUrl: stableDocumentPath(existing.id) }).where(eq(communicationsTable.id, communication.id));
    return { documentId: existing.id, playbackPath: link };
  }
  const recording = await fetchRecording(input.recordingUrl, input.recordingSid);
  await new ObjectStorageService().saveObjectEntity(`/objects/${fileKey}`, recording.bytes, recording.contentType);
  const [document] = await db.insert(documentsTable).values({
    leadId: communication.leadId,
    userId: communication.userId,
    filename: `call-recording-${input.recordingSid}.mp3`,
    fileKey,
    fileType: recording.contentType,
    fileSize: recording.bytes.length,
    category: "other",
    label: `Call recording ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
  }).returning();
  const link = trustedAppUrl(playbackPath(document.id));
  await db.update(communicationsTable).set({
    recordingSid: input.recordingSid,
    recordingUrl: stableDocumentPath(document.id),
    durationSeconds: input.recordingDuration == null ? communication.durationSeconds : Number(input.recordingDuration),
  }).where(eq(communicationsTable.id, communication.id));
  return { documentId: document.id, playbackPath: link };
}

function escaped(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] as string));
}

async function notifyVoicemail(lead: typeof leadsTable.$inferSelect, rep: typeof usersTable.$inferSelect | null, transcript: string, link: string): Promise<void> {
  const [settings] = await db.select({ voicemailRecipients: companySettingsTable.voicemailRecipients }).from(companySettingsTable).limit(1);
  const subject = `Voicemail from ${lead.phone || "unknown caller"}`;
  const body = `<p>A voicemail was received for <strong>${escaped(lead.companyName || `${lead.firstName || ""} ${lead.lastName || ""}`.trim() || "Unknown caller")}</strong>.</p><p><strong>Transcript:</strong><br>${escaped(transcript || "(No transcription was returned.)").replace(/\n/g, "<br>")}</p><p><a href="${link}">Play voicemail (expires in 15 minutes)</a></p>`;
  const recipients = [...(settings?.voicemailRecipients ?? []), FUNDING_EMAIL, rep?.email].filter((email, index, all): email is string => Boolean(email) && all.indexOf(email) === index);
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    logger.error("Voicemail notification email could not be sent: SendGrid is not configured");
    return;
  }
  sgMail.setApiKey(apiKey);
  for (const toEmail of recipients) {
    try {
      await sgMail.send({
        to: toEmail,
        from: { email: process.env.SENDGRID_FROM_EMAIL?.trim() || FUNDING_EMAIL, name: "My Business Solutions" },
        subject,
        html: body,
        text: `Voicemail from ${lead.phone || "unknown caller"}\n\nTranscript: ${transcript || "(No transcription was returned.)"}\n\nPlay voicemail: ${link}`,
        trackingSettings: { clickTracking: { enable: false, enableText: false }, openTracking: { enable: false } },
      });
    } catch (error) {
      logger.error({ err: error, leadId: lead.id }, "Voicemail notification email delivery failed");
    }
  }
}

export async function handleVoicemailComplete(input: VoicemailCompleteInput): Promise<VoicemailResult | null> {
  requirePlaybackSecret();
  const communication = await db.query.communicationsTable.findFirst({ where: eq(communicationsTable.twilioSid, input.callSid) });
  if (!communication) return null;
  if (!input.recordingUrl) {
    if (input.transcriptionText != null) {
      await db.update(communicationsTable).set({ body: input.transcriptionText, callOutcome: "voicemail" }).where(eq(communicationsTable.id, communication.id));
      if (communication.leadId) {
        const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, communication.leadId) });
        if (lead) {
          const rep = (lead.assignedRepId ? await db.query.usersTable.findFirst({ where: eq(usersTable.id, lead.assignedRepId) }) : null) ?? null;
          const alreadyNoted = await db.query.activityLogTable.findFirst({
            where: and(eq(activityLogTable.entityType, "communication"), eq(activityLogTable.entityId, input.callSid), eq(activityLogTable.action, "voicemail_transcription_received")),
          });
          if (!alreadyNoted) {
            await logActivity({ userId: rep?.id ?? null, leadId: lead.id, action: "voicemail_transcription_received", entityType: "communication", entityId: input.callSid, details: { transcript: input.transcriptionText, recordingSid: input.recordingSid } });
            const doc = await db.query.documentsTable.findFirst({ where: eq(documentsTable.fileKey, `leads/${lead.id}/documents/voicemail-${input.recordingSid}.mp3`) });
            if (doc && await claimVoicemailEmail(input.callSid, input.recordingSid)) {
              await notifyVoicemail(lead, rep, input.transcriptionText, trustedAppUrl(playbackPath(doc.id)));
            }
          }
        }
      }
    }
    return null;
  }
  const callbackClaim = await claimVoicemailCallback(input.callSid, input.recordingSid);
  if (!callbackClaim.acquired) return null;
  const existing = await db.query.documentsTable.findFirst({
    where: and(eq(documentsTable.leadId, communication.leadId ?? -1), eq(documentsTable.fileKey, `leads/${communication.leadId}/documents/voicemail-${input.recordingSid}.mp3`)),
  });
  const voicemailActivity = existing ? await db.query.activityLogTable.findFirst({
    where: and(eq(activityLogTable.entityType, "communication"), eq(activityLogTable.entityId, input.callSid), eq(activityLogTable.action, "voicemail_received")),
  }) : null;
  if (communication.callOutcome === "voicemail" && communication.recordingSid === input.recordingSid && existing && voicemailActivity) {
    if (input.transcriptionText != null) {
      await db.update(communicationsTable).set({ body: input.transcriptionText }).where(eq(communicationsTable.id, communication.id));
      const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, existing.leadId) });
      if (lead) {
        const rep = (lead.assignedRepId ? await db.query.usersTable.findFirst({ where: eq(usersTable.id, lead.assignedRepId) }) : null) ?? null;
        const alreadyNoted = await db.query.activityLogTable.findFirst({
          where: and(eq(activityLogTable.entityType, "communication"), eq(activityLogTable.entityId, input.callSid), eq(activityLogTable.action, "voicemail_transcription_received")),
        });
        if (!alreadyNoted) {
          await logActivity({ userId: rep?.id ?? null, leadId: lead.id, action: "voicemail_transcription_received", entityType: "communication", entityId: input.callSid, details: { transcript: input.transcriptionText, recordingSid: input.recordingSid } });
          if (await claimVoicemailEmail(input.callSid, input.recordingSid)) {
            await notifyVoicemail(lead, rep, input.transcriptionText, trustedAppUrl(playbackPath(existing.id)));
          }
        }
      }
    }
    return { leadId: existing.leadId, documentId: existing.id, taskIds: [], playbackPath: playbackPath(existing.id), duplicate: true };
  }

  let lead = communication.leadId ? await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, communication.leadId) }) : null;
  if (!lead) {
    const phone = communication.fromNumber || "unknown";
    const inserted = await db.insert(leadsTable).values({
      phone,
      firstName: "Inbound",
      lastName: "Caller",
      leadSource: "inbound-call",
    }).returning();
    lead = inserted[0];
    await db.update(communicationsTable).set({ leadId: lead.id }).where(eq(communicationsTable.id, communication.id));
  }

  const rep = (lead.assignedRepId ? await db.query.usersTable.findFirst({ where: eq(usersTable.id, lead.assignedRepId) }) : null) ?? null;
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const fileKey = `leads/${lead.id}/documents/voicemail-${input.recordingSid}.mp3`;
  const [currentCall] = await db.select({ body: communicationsTable.body }).from(communicationsTable)
    .where(eq(communicationsTable.id, communication.id)).limit(1);
  const transcript = input.transcriptionText ?? currentCall?.body ?? "";
  let document = existing;
  if (!document) {
    const recording = await fetchRecording(input.recordingUrl, input.recordingSid);
    await new ObjectStorageService().saveObjectEntity(`/objects/${fileKey}`, recording.bytes, recording.contentType);
    const [created] = await db.insert(documentsTable).values({
      leadId: lead.id, userId: rep?.id ?? null, filename: `voicemail-${input.recordingSid}.mp3`, fileKey,
      fileType: recording.contentType, fileSize: recording.bytes.length, category: "other", label: `Voicemail ${stamp}`,
    }).returning();
    document = created;
  }

  await db.update(communicationsTable).set({
    leadId: lead.id, recordingSid: input.recordingSid, recordingUrl: stableDocumentPath(document.id), durationSeconds: input.recordingDuration == null ? null : Number(input.recordingDuration),
    body: transcript || null, status: "completed", callOutcome: "voicemail",
  }).where(eq(communicationsTable.id, communication.id));
  await logActivity({ userId: rep?.id ?? null, leadId: lead.id, action: "voicemail_received", entityType: "communication", entityId: input.callSid, details: { transcript: transcript || null, recordingSid: input.recordingSid, documentId: document.id } });

  const dueDate = await dueBusinessDate();
  const taskIds: number[] = [];
  const assignees = rep ? [rep] : await db.query.usersTable.findMany({ where: and(eq(usersTable.role, "admin"), eq(usersTable.isActive, true)) });
  for (const assignee of assignees) {
    const [task] = await db.insert(tasksTable).values({ leadId: lead.id, userId: assignee.id, title: "Return voicemail", description: transcript || "Return the inbound voicemail call.", dueDate }).returning({ id: tasksTable.id });
    taskIds.push(task.id);
    await createNotification({ userId: assignee.id, type: "call_received", title: "New voicemail", body: `Return voicemail from ${lead.phone || "unknown caller"}`, leadId: lead.id, event: "task_due" });
  }
  await saveVoicemailCallbackState(input.callSid, input.recordingSid, { phase: "recorded", documentId: document.id });
  const link = trustedAppUrl(playbackPath(document.id));
  if (transcript && await claimVoicemailEmail(input.callSid, input.recordingSid)) {
    await notifyVoicemail(lead, rep, transcript, link);
  }
  return { leadId: lead.id, documentId: document.id, taskIds, playbackPath: link, duplicate: false };
}

export async function handleMissedCall({ callSid }: { callSid: string }): Promise<boolean> {
  const communication = await db.query.communicationsTable.findFirst({ where: eq(communicationsTable.twilioSid, callSid) });
  if (!communication?.leadId || communication.callOutcome === "voicemail" || communication.callOutcome === "connected") return false;
  const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, communication.leadId) });
  if (!lead) return false;
  const alreadyLogged = await db.query.activityLogTable.findFirst({
    where: and(eq(activityLogTable.entityType, "communication"), eq(activityLogTable.entityId, callSid), eq(activityLogTable.action, "missed_call")),
  });
  if (!alreadyLogged) {
    await db.update(communicationsTable).set({ status: "missed", callOutcome: "no_answer" })
      .where(and(eq(communicationsTable.id, communication.id), sql`${communicationsTable.callOutcome} IS DISTINCT FROM 'voicemail'`));
    await logActivity({ userId: lead.assignedRepId, leadId: lead.id, action: "missed_call", entityType: "communication", entityId: callSid, details: { callSid } });
    if (lead.assignedRepId) {
      const existingTask = await db.query.tasksTable.findFirst({
        where: and(eq(tasksTable.leadId, lead.id), eq(tasksTable.userId, lead.assignedRepId), eq(tasksTable.title, "Return missed call")),
      });
      if (!existingTask) await db.insert(tasksTable).values({ leadId: lead.id, userId: lead.assignedRepId, title: "Return missed call", description: "A known lead called and there was no answer.", dueDate: await dueBusinessDate() });
    }
  }

  // Text-back is an independent, opt-in side effect. Missed-call logging and
  // the return-call task above must survive every SMS guard/provider failure.
  try {
    const settings = await getTelephonySettings();
    const rawSettings = settings as Record<string, unknown>;
    const voiceSettings = {
      voiceHoursStart: String(rawSettings.voiceHoursStart ?? "08:00"),
      voiceHoursEnd: String(rawSettings.voiceHoursEnd ?? "18:00"),
      voiceBusinessDays: (rawSettings.voiceBusinessDays as number[] | null) ?? [1, 2, 3, 4, 5],
      voiceHolidays: (rawSettings.voiceHolidays as string[] | null) ?? [],
    };
    const smsEligible = shouldSendMissedCallTextBack({
      enabled: rawSettings.missedCallTextBackEnabled === true,
      hasRecording: Boolean(communication.recordingSid),
      callOutcome: communication.callOutcome,
      callTime: communication.createdAt,
      voiceSettings,
      smsEligible: (await getLeadSmsEligibility(db, lead.id)).eligible,
      usfaBlocked: await isUsfaMarketingBlocked(db, lead.leadSource),
      twilioConfigured: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && settings.smsSenderNumber),
    });
    if (smsEligible) {
    const callDay = newYorkBusinessTime(communication.createdAt).date;
    const claimKey = missedCallTextBackClaimKey(lead.id, communication.createdAt);
    const claim = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${claimKey}))`);
      const [existing] = await tx.select().from(idempotencyKeysTable).where(and(
        eq(idempotencyKeysTable.key, claimKey),
        eq(idempotencyKeysTable.endpoint, "twilio.missed-call-text-back"),
      )).limit(1);
      if (existing) {
        const payload = (existing.resultPayload ?? {}) as { state?: string; twilioSid?: string };
        return { acquired: false, sentSid: payload.state === "sent" ? payload.twilioSid : undefined };
      }
      const [claim] = await tx.insert(idempotencyKeysTable).values({
        key: claimKey,
        endpoint: "twilio.missed-call-text-back",
        resultPayload: { leadId: lead.id, callSid, date: callDay, state: "claimed" },
      }).onConflictDoNothing({
        target: [idempotencyKeysTable.key, idempotencyKeysTable.endpoint],
      }).returning({ id: idempotencyKeysTable.id });
      return { acquired: Boolean(claim) };
    });
    if (claim.acquired || claim.sentSid) {
      try {
        let sid = claim.sentSid;
        let status = "sent";
        if (!sid) {
          const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
          const message = await client.messages.create({
            from: settings.smsSenderNumber!,
            to: lead.phone!,
            body: MISSED_CALL_TEXT,
          });
          sid = message.sid;
          status = message.status;
          const [claimRow] = await db.select().from(idempotencyKeysTable).where(and(
            eq(idempotencyKeysTable.key, claimKey),
            eq(idempotencyKeysTable.endpoint, "twilio.missed-call-text-back"),
          )).limit(1);
          if (claimRow) await db.update(idempotencyKeysTable).set({
            resultPayload: { leadId: lead.id, callSid, date: callDay, state: "sent", twilioSid: sid },
          }).where(eq(idempotencyKeysTable.id, claimRow.id));
        }
        const existingSms = await db.query.communicationsTable.findFirst({ where: eq(communicationsTable.twilioSid, sid) });
        if (!existingSms) await db.insert(communicationsTable).values({
          leadId: lead.id, userId: lead.assignedRepId, type: "sms", direction: "outbound",
          fromNumber: settings.smsSenderNumber, toNumber: lead.phone, body: MISSED_CALL_TEXT,
          status, twilioSid: sid,
        });
        const sentActivity = await db.query.activityLogTable.findFirst({ where: and(
          eq(activityLogTable.entityType, "communication"), eq(activityLogTable.entityId, callSid),
          eq(activityLogTable.action, "missed_call_text_back_sent"),
        ) });
        if (!sentActivity) {
          await logActivity({
            userId: lead.assignedRepId, leadId: lead.id, action: "missed_call_text_back_sent",
            entityType: "communication", entityId: callSid, details: { callSid, date: callDay, twilioSid: sid },
          });
        }
      } catch (error) {
        // The claim remains durable when Twilio has an unknown outcome. Never
        // retry automatically and risk sending a second text.
        logger.warn({ err: error, leadId: lead.id, callSid }, "Missed-call text-back delivery failed");
      }
    }
  }
  } catch (error) {
    logger.warn({ err: error, leadId: lead.id, callSid }, "Missed-call text-back guard/reconciliation failed");
  }
  return !alreadyLogged;
}

export async function finalizeVoicemail({ callSid, recordingSid, minAgeMinutes = 10 }: {
  callSid: string;
  recordingSid?: string;
  minAgeMinutes?: number;
}): Promise<boolean> {
  const communication = await db.query.communicationsTable.findFirst({ where: eq(communicationsTable.twilioSid, callSid) });
  const sid = recordingSid ?? communication?.recordingSid;
  if (!communication?.leadId || !sid || communication.callOutcome !== "voicemail") return false;
  if (Date.now() - communication.updatedAt.getTime() < minAgeMinutes * 60_000) return false;
  const doc = await db.query.documentsTable.findFirst({ where: eq(documentsTable.fileKey, `leads/${communication.leadId}/documents/voicemail-${sid}.mp3`) });
  if (!doc) return false;
  const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, communication.leadId) });
  if (!lead) return false;
  const rep = (lead.assignedRepId ? await db.query.usersTable.findFirst({ where: eq(usersTable.id, lead.assignedRepId) }) : null) ?? null;
  const unavailable = "Transcription unavailable; please listen to the recording.";
  const transcript = communication.body?.trim() || unavailable;
  if (!communication.body?.trim()) {
    await db.update(communicationsTable).set({ body: unavailable }).where(eq(communicationsTable.id, communication.id));
  }
  const alreadyNoted = await db.query.activityLogTable.findFirst({
    where: and(eq(activityLogTable.entityType, "communication"), eq(activityLogTable.entityId, callSid), eq(activityLogTable.action, "voicemail_transcription_unavailable")),
  });
  if (!alreadyNoted) {
    await logActivity({ userId: rep?.id ?? null, leadId: lead.id, action: "voicemail_transcription_unavailable", entityType: "communication", entityId: callSid, details: { recordingSid: sid } });
  }
  if (await claimVoicemailEmail(callSid, sid)) {
    await notifyVoicemail(lead, rep, transcript, trustedAppUrl(playbackPath(doc.id)));
    return true;
  }
  return Boolean(alreadyNoted);
}

export async function reconcileInboundVoicemailCalls({ minAgeMinutes = 2 }: { minAgeMinutes?: number } = {}): Promise<{ recovered: number; missed: number; finalized: number }> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) throw new Error("Twilio credentials are required for voicemail reconciliation");
  const client = twilio(accountSid, authToken);
  const cutoff = new Date(Date.now() - minAgeMinutes * 60_000);
  const calls = await db.select().from(communicationsTable).where(and(
    eq(communicationsTable.direction, "inbound"),
    isNotNull(communicationsTable.twilioSid),
    lt(communicationsTable.createdAt, cutoff),
    ne(communicationsTable.status, "missed"),
    or(
      isNull(communicationsTable.callOutcome),
      eq(communicationsTable.callOutcome, "no_answer"),
      and(eq(communicationsTable.callOutcome, "voicemail"), isNull(communicationsTable.recordingSid)),
    ),
  )).orderBy(desc(communicationsTable.createdAt)).limit(100);
  let recovered = 0;
  let missed = 0;
  let finalized = 0;
  for (const communication of calls) {
    if (!communication.twilioSid) continue;
    try {
      const call = await client.calls(communication.twilioSid).fetch();
      const recordings = await client.calls(communication.twilioSid).recordings.list({ limit: 1 });
      const recording = recordings[0];
      if (recording) {
        const recordingUrl = `https://api.twilio.com${recording.uri.replace(/\.json$/, "")}`;
        await handleVoicemailComplete({
          callSid: communication.twilioSid,
          recordingSid: recording.sid,
          recordingUrl,
          recordingDuration: recording.duration,
        });
        recovered++;
      } else if (["completed", "busy", "failed", "no-answer"].includes(call.status)) {
        if (await handleMissedCall({ callSid: communication.twilioSid })) missed++;
        else if (!communication.leadId) await db.update(communicationsTable).set({ status: "missed", callOutcome: "no_answer" })
          .where(eq(communicationsTable.id, communication.id));
      }
    } catch (error) {
      logger.warn({ err: error, callSid: communication.twilioSid }, "Inbound voicemail reconciliation failed");
    }
  }
  const pending = await db.select({ twilioSid: communicationsTable.twilioSid }).from(communicationsTable).where(and(
    eq(communicationsTable.direction, "inbound"),
    eq(communicationsTable.callOutcome, "voicemail"),
    isNotNull(communicationsTable.twilioSid),
    lt(communicationsTable.updatedAt, cutoff),
  )).orderBy(desc(communicationsTable.updatedAt)).limit(100);
  for (const row of pending) {
    if (row.twilioSid && await finalizeVoicemail({ callSid: row.twilioSid, minAgeMinutes })) finalized++;
  }
  return { recovered, missed, finalized };
}

export { DEFAULT_GREETING };