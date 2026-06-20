import { Router, type Request } from "express";
import twilio from "twilio";
import { db } from "@workspace/db";
import { communicationsTable, leadsTable, usersTable } from "@workspace/db";
import { eq, and, isNotNull } from "drizzle-orm";
import { requireUser } from "../lib/authHelpers";
import { logActivity } from "../lib/activityHelper";
import { sendPushNotification } from "../lib/pushNotifications";

const router = Router();

const ACCOUNT_SID = process.env["TWILIO_ACCOUNT_SID"];
const AUTH_TOKEN = process.env["TWILIO_AUTH_TOKEN"];
const TWILIO_PHONE = process.env["TWILIO_PHONE_NUMBER"];
const TWIML_APP_SID = process.env["TWILIO_TWIML_APP_SID"];
const API_KEY = process.env["TWILIO_API_KEY"];
const API_SECRET = process.env["TWILIO_API_SECRET"];

function getTwilioClient() {
  if (!ACCOUNT_SID || !AUTH_TOKEN) return null;
  return twilio(ACCOUNT_SID, AUTH_TOKEN);
}

function absUrl(req: Request, path: string): string {
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host = (req.headers["x-forwarded-host"] as string) || req.headers["host"] || "";
  return `${proto}://${host}${path}`;
}

function validateTwilioSignature(req: any): boolean {
  if (!AUTH_TOKEN) return false;
  const sig = req.headers["x-twilio-signature"] as string | undefined;
  if (!sig) return false;
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host = (req.headers["x-forwarded-host"] as string) || req.headers["host"] || "";
  const url = `${proto}://${host}${req.originalUrl}`;
  return twilio.validateRequest(AUTH_TOKEN, sig, url, req.body);
}

// POST /api/twilio/token
router.post("/twilio/token", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  if (!ACCOUNT_SID || !AUTH_TOKEN || !TWIML_APP_SID) {
    return void res.status(503).json({ error: "Twilio not configured" });
  }

  const AccessToken = twilio.jwt.AccessToken;
  const VoiceGrant = AccessToken.VoiceGrant;

  const identity = `user_${user.id}`;

  if (!API_KEY || !API_SECRET) {
    return void res.status(503).json({
      error:
        "Twilio API Key not configured. Create an API Key in the Twilio console and set TWILIO_API_KEY + TWILIO_API_SECRET.",
    });
  }

  const token = new AccessToken(ACCOUNT_SID, API_KEY, API_SECRET, { identity });
  const voiceGrant = new VoiceGrant({
    outgoingApplicationSid: TWIML_APP_SID,
    incomingAllow: true,
  });
  token.addGrant(voiceGrant);

  res.json({ token: token.toJwt(), identity });
});

// POST /api/twilio/voice — outbound call TwiML (Twilio calls this when browser dials)
router.post("/twilio/voice", async (req, res) => {
  if (!validateTwilioSignature(req)) {
    return void res.status(403).send("Forbidden");
  }

  const to: string = req.body?.To || req.body?.to || "";
  const callSid: string = req.body?.CallSid || "";
  const fromClient: string = req.body?.From || "";

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
    callerId: TWILIO_PHONE || fromClient,
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
    fromNumber: TWILIO_PHONE || fromClient,
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

  const from: string = req.body?.From || "";
  const callSid: string = req.body?.CallSid || "";

  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  const statusCb = absUrl(req, "/api/twilio/voice/status");
  const recordingCb = absUrl(req, "/api/twilio/voice/recording");

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
    toNumber: TWILIO_PHONE || "",
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

  const callSid: string = req.body?.CallSid || "";
  const status: string = req.body?.CallStatus || req.body?.DialCallStatus || "";
  const duration: string = req.body?.CallDuration || req.body?.DialCallDuration || "0";

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

  const callSid: string = req.body?.CallSid || "";
  const recordingSid: string = req.body?.RecordingSid || "";
  const recordingUrl: string = req.body?.RecordingUrl
    ? `${req.body.RecordingUrl}.mp3`
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

  const from: string = req.body?.From || "";
  const to: string = req.body?.To || "";
  const body: string = req.body?.Body || "";
  const smsSid: string = req.body?.SmsSid || req.body?.MessageSid || "";

  const lead = await db.query.leadsTable.findFirst({
    where: and(isNotNull(leadsTable.phone), eq(leadsTable.phone, from)),
  });

  const [comm] = await db.insert(communicationsTable).values({
    leadId: lead?.id ?? null,
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

    // Notify assigned rep of inbound SMS
    if (lead.assignedRepId) {
      db.query.usersTable.findFirst({ where: eq(usersTable.id, lead.assignedRepId) })
        .then((rep): void => {
          if (rep?.pushToken) {
            sendPushNotification(
              rep.pushToken,
              "Inbound SMS",
              `${from}: ${body.slice(0, 120)}`,
              { leadId: lead.id },
            ).catch(() => {});
          }
        })
        .catch(() => {});
    }
  }

  const MessagingResponse = twilio.twiml.MessagingResponse;
  const twiml = new MessagingResponse();
  res.type("text/xml").send(twiml.toString());
});

// POST /api/twilio/sms/status — SMS delivery status callback
router.post("/twilio/sms/status", async (req, res) => {
  if (!validateTwilioSignature(req)) {
    return void res.status(403).send("Forbidden");
  }

  const smsSid: string = req.body?.SmsSid || req.body?.MessageSid || "";
  const status: string = req.body?.MessageStatus || req.body?.SmsStatus || "";

  if (smsSid && status) {
    await db
      .update(communicationsTable)
      .set({ status, updatedAt: new Date() })
      .where(eq(communicationsTable.twilioSid, smsSid));
  }

  res.json({ ok: true });
});

export default router;
