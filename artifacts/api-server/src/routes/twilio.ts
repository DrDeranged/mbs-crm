import { Router } from "express";
import twilio from "twilio";
import { db } from "@workspace/db";
import { communicationsTable, leadsTable, usersTable } from "@workspace/db";
import { eq, and, isNotNull } from "drizzle-orm";
import { requireUser } from "../lib/authHelpers";
import { logActivity } from "../lib/activityHelper";

const router = Router();

const ACCOUNT_SID = process.env["TWILIO_ACCOUNT_SID"];
const AUTH_TOKEN = process.env["TWILIO_AUTH_TOKEN"];
const TWILIO_PHONE = process.env["TWILIO_PHONE_NUMBER"];
const TWIML_APP_SID = process.env["TWILIO_TWIML_APP_SID"];

function getTwilioClient() {
  if (!ACCOUNT_SID || !AUTH_TOKEN) return null;
  return twilio(ACCOUNT_SID, AUTH_TOKEN);
}

function validateTwilioSignature(req: any): boolean {
  if (!AUTH_TOKEN) return false;
  const sig = req.headers["x-twilio-signature"] as string | undefined;
  if (!sig) return false;
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["host"];
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
  const token = new AccessToken(ACCOUNT_SID, process.env["TWILIO_API_KEY"] || ACCOUNT_SID, process.env["TWILIO_API_SECRET"] || AUTH_TOKEN, { identity });
  const voiceGrant = new VoiceGrant({ outgoingApplicationSid: TWIML_APP_SID, incomingAllow: true });
  token.addGrant(voiceGrant);

  res.json({ token: token.toJwt(), identity });
});

// POST /api/twilio/voice — outbound call TwiML (Twilio calls this)
router.post("/twilio/voice", async (req, res) => {
  if (!validateTwilioSignature(req)) {
    return void res.status(403).send("Forbidden");
  }

  const to: string = req.body?.To || req.body?.to || "";
  const callSid: string = req.body?.CallSid || "";
  const from: string = req.body?.From || TWILIO_PHONE || "";

  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  if (!to) {
    twiml.say("No destination number provided.");
    res.type("text/xml").send(twiml.toString());
    return;
  }

  const dial = twiml.dial({ callerId: TWILIO_PHONE || from, record: "record-from-ringing", recordingStatusCallback: "/api/twilio/voice/recording", recordingStatusCallbackMethod: "POST" });
  dial.number(to);

  const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.phone, to) });
  let userId: number | null = null;
  const identity: string = req.body?.From || "";
  if (identity.startsWith("client:user_")) {
    const uid = parseInt(identity.replace("client:user_", ""), 10);
    if (!isNaN(uid)) userId = uid;
  }

  await db.insert(communicationsTable).values({
    leadId: lead?.id ?? null,
    userId,
    type: "call",
    direction: "outbound",
    fromNumber: from,
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

  const lead = await db.query.leadsTable.findFirst({
    where: and(eq(leadsTable.phone, from), isNotNull(leadsTable.phone)),
    with: { assignedRep: true },
  });

  const dial = twiml.dial({ record: "record-from-ringing", recordingStatusCallback: "/api/twilio/voice/recording", recordingStatusCallbackMethod: "POST" });

  if (lead?.assignedRepId) {
    dial.client(`user_${lead.assignedRepId}`);
  } else {
    const admin = await db.query.usersTable.findFirst({ where: eq(usersTable.role, "admin") });
    if (admin) {
      dial.client(`user_${admin.id}`);
    } else {
      twiml.say("No available agent. Please try again later.");
    }
  }

  await db.insert(communicationsTable).values({
    leadId: lead?.id ?? null,
    userId: lead?.assignedRepId ?? null,
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
  const status: string = req.body?.CallStatus || "";
  const duration: string = req.body?.CallDuration || "0";

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

    if (updated && status === "completed") {
      await logActivity({
        userId: updated.userId,
        leadId: updated.leadId,
        action: updated.direction === "outbound" ? "call_completed_outbound" : "call_completed_inbound",
        entityType: "communication",
        entityId: updated.id,
        details: { duration: parseInt(duration, 10), status, direction: updated.direction },
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
  const recordingUrl: string = req.body?.RecordingUrl ? `${req.body.RecordingUrl}.mp3` : "";

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

  const lead = await db.query.leadsTable.findFirst({ where: and(eq(leadsTable.phone, from), isNotNull(leadsTable.phone)) });

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
