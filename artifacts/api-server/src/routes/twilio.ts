import { Router, type Request } from "express";
import twilio from "twilio";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { communicationsTable, leadsTable, usersTable, partnerContactsTable } from "@workspace/db";
import { eq, and, isNotNull } from "drizzle-orm";
import { requireUser } from "../lib/authHelpers";
import { logActivity } from "../lib/activityHelper";
import { sendPushNotification } from "../lib/pushNotifications";
import { createNotification } from "../lib/notify";
import { logger } from "../lib/logger";
import { getTwilioFailureReason, mintVoiceToken } from "../lib/integrationHealth";
import { getTelephonySettings } from "../lib/telephonySettings";
import { approvedTwilioNumbers, isOwnedInboundNumber, selectVoiceCallerId } from "../lib/telephonyRouting";

const router = Router();
export const twilioTokenRouter = Router();

const ACCOUNT_SID = process.env["TWILIO_ACCOUNT_SID"];
const AUTH_TOKEN = process.env["TWILIO_AUTH_TOKEN"];
const TWILIO_PHONE = process.env["TWILIO_PHONE_NUMBER"];
const TWIML_APP_SID = process.env["TWILIO_TWIML_APP_SID"];
const API_KEY = process.env["TWILIO_API_KEY"];
const API_SECRET = process.env["TWILIO_API_SECRET"];

async function routingNumbers() {
  const settings = await getTelephonySettings();
  return { settings, numbers: approvedTwilioNumbers };
}
const twilioPayload = z.object({
  To: z.string().optional(),
  to: z.string().optional(),
  From: z.string().optional(),
  CallSid: z.string().optional(),
  CallStatus: z.string().optional(),
  DialCallStatus: z.string().optional(),
  CallDuration: z.string().optional(),
  DialCallDuration: z.string().optional(),
  RecordingSid: z.string().optional(),
  RecordingUrl: z.string().url().optional(),
  Body: z.string().optional(),
  SmsSid: z.string().optional(),
  MessageSid: z.string().optional(),
  MessageStatus: z.string().optional(),
  SmsStatus: z.string().optional(),
}).passthrough();

function parseTwilioPayload(req: Request, res: import("express").Response) {
  const parsed = twilioPayload.safeParse(req.body);
  if (parsed.success) return parsed.data;
  const field = parsed.error.issues[0]?.path.join(".") || "body";
  res.status(400).json({ error: `Invalid ${field}` });
  return null;
}

function getTwilioClient() {
  if (!ACCOUNT_SID || !AUTH_TOKEN) return null;
  return twilio(ACCOUNT_SID, AUTH_TOKEN);
}

function absUrl(req: Request, path: string): string {
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host = (req.headers["x-forwarded-host"] as string) || req.headers["host"] || "";
  return `${proto}://${host}${path}`;
}

function validateTwilioSignature(req: Request): boolean {
  if (!AUTH_TOKEN) return false;
  const sig = req.headers["x-twilio-signature"] as string | undefined;
  if (!sig) return false;
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host = (req.headers["x-forwarded-host"] as string) || req.headers["host"] || "";
  const url = `${proto}://${host}${req.originalUrl}`;
  return twilio.validateRequest(AUTH_TOKEN, sig, url, req.body);
}

// POST /api/twilio/token
twilioTokenRouter.post("/twilio/token", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  // Read integration settings when the request arrives so a credential
  // rotation or a secret added after process startup is immediately usable.
  // requireUser already rejects inactive and pending accounts; active reps
  // are intentionally allowed to mint their own browser token.
  const identity = `user_${user.id}`;
  const reason = getTwilioFailureReason();
  if (reason) {
    logger.error({ route: "/api/twilio/token", reason }, "Twilio token unavailable");
    return void res.status(503).json({ error: "Twilio token unavailable", reason });
  }
  try {
    res.json({ token: mintVoiceToken(identity), identity });
  } catch (error) {
    const mintReason = error instanceof Error ? error.message : "token_mint_failed";
    logger.error(
      { route: "/api/twilio/token", reason: mintReason, err: error },
      "Twilio token unavailable",
    );
    return void res.status(503).json({
      error: "Twilio token unavailable",
      reason: mintReason,
    });
  }
});

// POST /api/twilio/voice — outbound call TwiML (Twilio calls this when browser dials)
router.post("/twilio/voice", async (req, res) => {
  if (!validateTwilioSignature(req)) {
    return void res.status(403).send("Forbidden");
  }
  const body = parseTwilioPayload(req, res);
  if (!body) return;

  const to = body.To || body.to || "";
  const callSid = body.CallSid || "";
  const fromClient = body.From || "";
  const settings = await getTelephonySettings();

  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  if (!to) {
    twiml.say("No destination number provided.");
    res.type("text/xml").send(twiml.toString());
    return;
  }

  const statusCb = absUrl(req, "/api/twilio/voice/status");
  const recordingCb = absUrl(req, "/api/twilio/voice/recording");

  const dial = twiml.dial({
    callerId: selectVoiceCallerId(settings.voiceCallerId, fromClient),
    record: "record-from-ringing",
    recordingStatusCallback: recordingCb,
    recordingStatusCallbackMethod: "POST",
    action: statusCb,
  } as any);

  dial.number({
    statusCallback: statusCb,
    statusCallbackMethod: "POST",
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
  } as any, to);

  // Resolve userId from Twilio Client identity (e.g. "client:user_5")
  let userId: number | null = null;
  if (fromClient.startsWith("client:user_")) {
    const uid = parseInt(fromClient.replace("client:user_", ""), 10);
    if (!isNaN(uid)) userId = uid;
  }

  const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.phone, to) });

  await db.insert(communicationsTable).values({
    leadId: lead?.id ?? null,
    userId,
    type: "call",
    direction: "outbound",
    fromNumber: selectVoiceCallerId(settings.voiceCallerId, fromClient),
    toNumber: to,
    status: "initiated",
    twilioSid: callSid,
  });

  res.type("text/xml").send(twiml.toString());
});

// POST /api/twilio/voice/inbound — inbound call routing TwiML
router.post("/twilio/voice/inbound", async (req, res) => {
  if (!validateTwilioSignature(req)) {
    return void res.status(403).send("Forbidden");
  }
  const body = parseTwilioPayload(req, res);
  if (!body) return;

  const from = body.From || "";
  const to = body.To || body.to || "";
  const callSid = body.CallSid || "";
  const { numbers } = await routingNumbers();

  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  const statusCb = absUrl(req, "/api/twilio/voice/status");
  const recordingCb = absUrl(req, "/api/twilio/voice/recording");

  // Twilio can retain old webhook URLs after a number is moved between
  // accounts. A signed callback is still acknowledged, but must not ring an
  // agent unless its destination is one of our owned numbers.
  if (!isOwnedInboundNumber(to, numbers)) {
    twiml.say("This number is not configured for inbound calls.");
    return void res.type("text/xml").send(twiml.toString());
  }

  const lead = await db.query.leadsTable.findFirst({
    where: and(isNotNull(leadsTable.phone), eq(leadsTable.phone, from)),
    with: { assignedRep: true },
  });

  const dial = twiml.dial({
    timeout: 20,
    record: "record-from-ringing",
    recordingStatusCallback: recordingCb,
    recordingStatusCallbackMethod: "POST",
    action: statusCb,
  } as any);

  let targetUserId: number | null = null;
  let targetMobile: string | null = null;

  if (lead?.assignedRepId) {
    targetUserId = lead.assignedRepId;
    const rep = await db.query.usersTable.findFirst({
      where: eq(usersTable.id, lead.assignedRepId),
    });
    targetMobile = rep?.mobileNumber ?? null;

    // Ring browser client
    dial.client({
      statusCallback: statusCb,
      statusCallbackMethod: "POST",
    } as any, `user_${lead.assignedRepId}`);

    // Also ring mobile if configured (simultaneous ring for offline fallback)
    if (targetMobile) {
      dial.number({
        statusCallback: statusCb,
        statusCallbackMethod: "POST",
      } as any, targetMobile);
    }
  } else {
    // No assigned rep — find first admin and ring their client + mobile
    const admin = await db.query.usersTable.findFirst({
      where: eq(usersTable.role, "admin"),
    });
    if (admin) {
      targetUserId = admin.id;
      dial.client({
        statusCallback: statusCb,
        statusCallbackMethod: "POST",
      } as any, `user_${admin.id}`);
      if (admin.mobileNumber) {
        dial.number({
          statusCallback: statusCb,
          statusCallbackMethod: "POST",
        } as any, admin.mobileNumber);
      }
    } else {
      twiml.say("No available agent. Please try again later.");
    }
  }

  await db.insert(communicationsTable).values({
    leadId: lead?.id ?? null,
    userId: targetUserId,
    type: "call",
    direction: "inbound",
    fromNumber: from,
    toNumber: to,
    status: "ringing",
    twilioSid: callSid,
  });

  res.type("text/xml").send(twiml.toString());
});

// POST /api/twilio/voice/status — call status callback
router.post("/twilio/voice/status", async (req, res) => {
  if (!validateTwilioSignature(req)) {
    return void res.status(403).send("Forbidden");
  }
  const body = parseTwilioPayload(req, res);
  if (!body) return;

  const callSid = body.CallSid || "";
  const status = body.CallStatus || body.DialCallStatus || "";
  const duration = body.CallDuration || body.DialCallDuration || "0";

  if (callSid) {
    const [updated] = await db
      .update(communicationsTable)
      .set({
        status,
        durationSeconds: parseInt(duration, 10) || null,
        updatedAt: new Date(),
      })
      .where(eq(communicationsTable.twilioSid, callSid))
      .returning();

    if (updated && (status === "completed" || status === "no-answer" || status === "busy" || status === "failed")) {
      await logActivity({
        userId: updated.userId,
        leadId: updated.leadId,
        action: updated.direction === "outbound" ? "call_completed_outbound" : "call_completed_inbound",
        entityType: "communication",
        entityId: updated.id,
        details: {
          duration: parseInt(duration, 10) || 0,
          status,
          direction: updated.direction,
        },
      });
    }
  }

  res.json({ ok: true });
});

// POST /api/twilio/voice/recording — recording ready webhook
router.post("/twilio/voice/recording", async (req, res) => {
  if (!validateTwilioSignature(req)) {
    return void res.status(403).send("Forbidden");
  }
  const body = parseTwilioPayload(req, res);
  if (!body) return;

  const callSid = body.CallSid || "";
  const recordingSid = body.RecordingSid || "";
  const recordingUrl = body.RecordingUrl
    ? `${body.RecordingUrl}.mp3`
    : "";

  if (callSid && recordingSid) {
    await db
      .update(communicationsTable)
      .set({ recordingSid, recordingUrl, updatedAt: new Date() })
      .where(eq(communicationsTable.twilioSid, callSid));
  }

  res.json({ ok: true });
});

// POST /api/twilio/sms/inbound — inbound SMS from Twilio
router.post("/twilio/sms/inbound", async (req, res) => {
  if (!validateTwilioSignature(req)) {
    return void res.status(403).send("Forbidden");
  }
  const payload = parseTwilioPayload(req, res);
  if (!payload) return;

  const from = payload.From || "";
  const to = payload.To || "";
  const body = payload.Body || "";
  const smsSid = payload.SmsSid || payload.MessageSid || "";

  const { numbers } = await routingNumbers();
  const MessagingResponse = twilio.twiml.MessagingResponse;
  const twiml = new MessagingResponse();
  if (!isOwnedInboundNumber(to, numbers)) {
    return void res.type("text/xml").send(twiml.toString());
  }
  const lead = isOwnedInboundNumber(to, numbers)
    ? await db.query.leadsTable.findFirst({
        where: and(isNotNull(leadsTable.phone), eq(leadsTable.phone, from)),
      })
    : undefined;
  const partnerContact = await db.query.partnerContactsTable.findFirst({
    where: eq(partnerContactsTable.phone, from),
  });
  if (partnerContact && /^\s*stop\b/i.test(body)) {
    await db.update(partnerContactsTable)
      .set({ smsOptedOut: true, updatedAt: new Date() })
      .where(eq(partnerContactsTable.id, partnerContact.id));
  }

  const [comm] = await db.insert(communicationsTable).values({
    leadId: lead?.id ?? null,
    partnerId: partnerContact?.partnerId ?? null,
    userId: lead?.assignedRepId ?? null,
    type: "sms",
    direction: "inbound",
    fromNumber: from,
    toNumber: to,
    body,
    status: "received",
    twilioSid: smsSid,
  }).returning();

  if (comm && lead?.id) {
    await logActivity({
      userId: lead.assignedRepId ?? null,
      leadId: lead.id,
      action: "sms_received",
      entityType: "communication",
      entityId: comm.id,
      details: { from, body: body.slice(0, 100) },
    });

    // Notify assigned rep of inbound SMS (in-app + push)
    if (lead.assignedRepId) {
      createNotification({
        userId: lead.assignedRepId,
        type: "sms_received",
        title: "New SMS received",
        body: `Message from ${lead.firstName || lead.companyName || from}`,
        leadId: lead.id,
      }).catch(() => {});
    }
  }

  res.type("text/xml").send(twiml.toString());
});

// POST /api/twilio/sms/status — SMS delivery status callback
router.post("/twilio/sms/status", async (req, res) => {
  if (!validateTwilioSignature(req)) {
    return void res.status(403).send("Forbidden");
  }
  const body = parseTwilioPayload(req, res);
  if (!body) return;

  const smsSid = body.SmsSid || body.MessageSid || "";
  const status = body.MessageStatus || body.SmsStatus || "";

  if (smsSid && status) {
    await db
      .update(communicationsTable)
      .set({ status, updatedAt: new Date() })
      .where(eq(communicationsTable.twilioSid, smsSid));
  }

  res.json({ ok: true });
});

export default router;
export const twilioProviderRouter = router;
