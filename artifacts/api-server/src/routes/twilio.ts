import { Router, type Request, type Response } from "express";
import twilio from "twilio";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { communicationsTable, leadsTable, usersTable, partnerContactsTable, companySettingsTable } from "@workspace/db";
import { eq, and, isNotNull } from "drizzle-orm";
import { requireUser } from "../lib/authHelpers";
import { logActivity } from "../lib/activityHelper";
import { sendPushNotification } from "../lib/pushNotifications";
import { createNotification } from "../lib/notify";
import { logger } from "../lib/logger";
import { getTwilioFailureReason, mintVoiceToken } from "../lib/integrationHealth";
import { getTelephonySettings } from "../lib/telephonySettings";
import { approvedTwilioNumbers, isOwnedInboundNumber, selectVoiceCallerId } from "../lib/telephonyRouting";
import { appendVoiceMessage, buildInboundVoiceTwiML, isWithinVoiceHours, nextPriorityTarget, selectRingTargets } from "../lib/inboundVoice";
import { resolveGreetingAudioUrl } from "../lib/telephonyGreeting";
import { handleVoicemailComplete, handleMissedCall, handleRecordingComplete } from "../lib/voicemail";

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
  RecordingDuration: z.string().optional(),
  RecordingStatus: z.string().optional(),
  TranscriptionText: z.string().optional(),
  TranscriptionStatus: z.string().optional(),
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
  // The same TwiML application is attached to both PSTN numbers and browser
  // clients. A public PSTN caller must never be handled as an outbound dial.
  if (!fromClient.startsWith("client:user_")) {
    await handleInboundVoice(req, res, body);
    return;
  }
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

async function handleInboundVoice(
  req: Request,
  res: Response,
  body: z.infer<typeof twilioPayload>,
): Promise<void> {
  const from = body.From || "";
  const to = body.To || body.to || "";
  const callSid = body.CallSid || "";
  const { numbers } = await routingNumbers();

  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  // Twilio can retain old webhook URLs after a number is moved between
  // accounts. A signed callback is still acknowledged, but must not ring an
  // agent unless its destination is one of our owned numbers.
  if (!isOwnedInboundNumber(to, numbers)) {
    twiml.say("This number is not configured for inbound calls.");
    res.type("text/xml").send(twiml.toString());
    return;
  }

  const lead = await db.query.leadsTable.findFirst({
    where: and(isNotNull(leadsTable.phone), eq(leadsTable.phone, from)),
    with: { assignedRep: true },
  });

  const [settings] = await db.select().from(companySettingsTable).limit(1);
  const effective = settings ?? {
    voiceHoursStart: "08:00", voiceHoursEnd: "18:00", voiceBusinessDays: [1, 2, 3, 4, 5],
    voiceHolidays: [], voiceGreeting: "Thanks for calling My Business Solutions. Please leave your name, business name, and phone number, and a representative will call you back within one business day.",
    voiceAfterHoursGreeting: "Thanks for calling My Business Solutions. Our office is currently closed. Leave a message and we'll return your call the next business day.",
    voiceRoutingMode: "assigned-rep-first" as const,
    voicePriorityRepIds: [] as number[],
    voiceGreetingAudioPath: null as string | null,
    voiceAfterHoursGreetingAudioPath: null as string | null,
  };
  const open = isWithinVoiceHours(effective);
  const reps = open ? await db.query.usersTable.findMany({
    where: eq(usersTable.isActive, true),
  }) : [];
  const targets = open ? selectRingTargets(reps, lead?.assignedRepId ?? null, effective.voiceRoutingMode, effective.voicePriorityRepIds) : [];
  const audioUrl = await resolveGreetingAudioUrl(open ? effective.voiceGreetingAudioPath : effective.voiceAfterHoursGreetingAudioPath);

  // Twilio may retry the initial request; do not create duplicate call logs.
  if (callSid) {
    const existing = await db.query.communicationsTable.findFirst({
      where: eq(communicationsTable.twilioSid, callSid),
    });
    if (!existing) await db.insert(communicationsTable).values({
      leadId: lead?.id ?? null,
      userId: null,
      type: "call",
      direction: "inbound",
      fromNumber: from,
      toNumber: to,
      status: open && targets.length ? "ringing" : "voicemail",
      twilioSid: callSid,
    });
  }

  res.type("text/xml").send(buildInboundVoiceTwiML({
    baseUrl: absUrl(req, ""),
    greeting: effective.voiceGreeting,
    afterHoursGreeting: effective.voiceAfterHoursGreeting,
    ...(open ? { greetingAudioUrl: audioUrl } : { afterHoursGreetingAudioUrl: audioUrl }),
    open, targets, callerId: to, callSid, routingMode: effective.voiceRoutingMode,
  }));
}

router.post("/twilio/voice/inbound", async (req, res): Promise<void> => {
  if (!validateTwilioSignature(req)) { res.status(403).send("Forbidden"); return; }
  const body = parseTwilioPayload(req, res);
  if (body) await handleInboundVoice(req, res, body);
});

router.post("/twilio/voice/dial-result", async (req, res): Promise<void> => {
  if (!validateTwilioSignature(req)) { res.status(403).send("Forbidden"); return; }
  const body = parseTwilioPayload(req, res);
  if (!body) return;
  const twiml = new twilio.twiml.VoiceResponse();
  const status = body.DialCallStatus || "";
  const callSid = body.CallSid || "";
  if (callSid) {
    const [call] = await db.update(communicationsTable).set({
      status: status || "completed",
      durationSeconds: Number.parseInt(body.DialCallDuration || "0", 10) || null,
      callOutcome: status === "completed" || status === "answered" ? "connected" : "no_answer",
      updatedAt: new Date(),
    }).where(and(eq(communicationsTable.twilioSid, callSid), eq(communicationsTable.direction, "inbound"))).returning();
    if (call && status === "completed" && !call.leadId && call.fromNumber) {
      const existing = await db.query.leadsTable.findFirst({ where: eq(leadsTable.phone, call.fromNumber) });
      const lead = existing ?? (await db.insert(leadsTable).values({
        phone: call.fromNumber, firstName: "Inbound", lastName: "Caller", leadSource: "inbound-call",
      }).returning())[0];
      await db.update(communicationsTable).set({ leadId: lead.id }).where(eq(communicationsTable.id, call.id));
    }
    if (call && status !== "completed" && status !== "answered") {
      const [settings] = await db.select().from(companySettingsTable).limit(1);
      const attempt = Number(req.query["attempt"]);
      if (settings?.voiceRoutingMode === "priority-list" && Number.isInteger(attempt) && attempt >= 0 && attempt < 100
        && isWithinVoiceHours(settings, call.createdAt)) {
        const reps = await db.query.usersTable.findMany({ where: eq(usersTable.isActive, true) });
        const ordered = selectRingTargets(reps, null, "priority-list", settings.voicePriorityRepIds);
        const next = nextPriorityTarget(ordered, attempt, status);
        if (next) {
          res.type("text/xml").send(buildInboundVoiceTwiML({
            baseUrl: absUrl(req, ""), greeting: settings.voiceGreeting,
            afterHoursGreeting: settings.voiceAfterHoursGreeting,
            open: true, targets: [next], callerId: call.toNumber || "",
            callSid, routingMode: "priority-list", priorityAttempt: attempt + 1,
          }));
          return;
        }
      }
      const greetingAudioUrl = await resolveGreetingAudioUrl(settings?.voiceGreetingAudioPath);
      appendVoiceMessage(twiml, {
        baseUrl: absUrl(req, ""),
        greeting: settings?.voiceGreeting ?? "Thanks for calling My Business Solutions. Please leave a message.",
        afterHoursGreeting: settings?.voiceAfterHoursGreeting ?? "Our office is currently closed. Please leave a message.",
        greetingAudioUrl,
      }, false);
    }
  }
  res.type("text/xml").send(twiml.toString());
});

router.post("/twilio/voice/voicemail-finished", async (req, res): Promise<void> => {
  if (!validateTwilioSignature(req)) { res.status(403).send("Forbidden"); return; }
  const body = parseTwilioPayload(req, res);
  if (!body) return;
  if (body.CallSid && (!body.RecordingSid || (body.RecordingDuration != null && Number(body.RecordingDuration) === 0))) {
    await handleMissedCall({ callSid: body.CallSid });
  }
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say({ voice: "Polly.Joanna" } as any, "Thank you. Goodbye.");
  res.type("text/xml").send(twiml.toString());
});

router.post("/twilio/voice/voicemail-complete", async (req, res): Promise<void> => {
  if (!validateTwilioSignature(req)) { res.status(403).send("Forbidden"); return; }
  const body = parseTwilioPayload(req, res);
  if (!body) return;
  if (body.RecordingStatus === "completed" && body.CallSid && body.RecordingSid && body.RecordingUrl) {
    await handleVoicemailComplete({
      callSid: body.CallSid, recordingSid: body.RecordingSid,
      recordingUrl: body.RecordingUrl, recordingDuration: body.RecordingDuration,
    });
  }
  res.json({ ok: true });
});

router.post("/twilio/voice/transcription", async (req, res): Promise<void> => {
  if (!validateTwilioSignature(req)) { res.status(403).send("Forbidden"); return; }
  const body = parseTwilioPayload(req, res);
  if (!body) return;
  if (body.CallSid && body.RecordingSid && body.TranscriptionStatus === "completed") {
    await handleVoicemailComplete({
      callSid: body.CallSid, recordingSid: body.RecordingSid,
      transcriptionText: body.TranscriptionText ?? "",
      transcriptionStatus: body.TranscriptionStatus,
    });
  }
  res.json({ ok: true });
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
    const repId = Number(req.query["repId"]);
    const parentCallSid = String(req.query["parentCallSid"] ?? "");
    if (Number.isInteger(repId) && repId > 0 && /^CA[a-f0-9]{32}$/i.test(parentCallSid)
      && ["in-progress", "answered", "completed"].includes(status)) {
      const rep = await db.query.usersTable.findFirst({ where: and(eq(usersTable.id, repId), eq(usersTable.isActive, true)) });
      if (rep) await db.update(communicationsTable).set({ userId: rep.id, updatedAt: new Date() })
        .where(and(eq(communicationsTable.twilioSid, parentCallSid), eq(communicationsTable.direction, "inbound")));
    }
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
  if (callSid && recordingSid && body.RecordingUrl && body.RecordingStatus === "completed") {
    await handleRecordingComplete({
      callSid, recordingSid, recordingUrl: body.RecordingUrl,
      recordingDuration: body.RecordingDuration,
    });
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
