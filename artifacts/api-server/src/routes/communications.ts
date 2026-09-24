import { Router, type Request } from "express";
import twilio from "twilio";
import { db } from "@workspace/db";
import { communicationsTable, leadsTable, usersTable, lendersTable, partnerContactsTable, companySettingsTable } from "@workspace/db";
import { eq, desc, and, gte, lte, inArray } from "drizzle-orm";
import { getUserDisplayName, requireUser } from "../lib/authHelpers";
import { logActivity } from "../lib/activityHelper";
import { z } from "zod/v4";
import { isUsfaMarketingBlocked } from "../lib/intake/usfaCompliance";
import { getLeadSmsEligibility } from "../lib/smsEligibility";
import { getTelephonySettings } from "../lib/telephonySettings";
import { APPROVED_TWILIO_NUMBERS, selectSmsSender } from "../lib/telephonyRouting";

function absUrl(req: Request, path: string): string {
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host = (req.headers["x-forwarded-host"] as string) || req.headers["host"] || "";
  return `${proto}://${host}${path}`;
}

const router = Router();
const positiveId = z.coerce.number().int().positive();
const callLogBody = z.object({
  toNumber: z.string().trim().min(1).optional(),
  type: z.enum(["call", "sms"]).optional(),
}).strict();
const sendSmsBody = z.object({ body: z.string().trim().min(1) }).strict();
const communicationMetricsQuery = z.object({
  repId: positiveId.optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
}).strict();
const updateCommunicationBody = z.object({
  callNotes: z.string().optional(),
  callOutcome: z.enum(["connected", "voicemail", "no_answer", "wrong_number", "busy"]).optional(),
}).refine(
  (value) => Object.keys(value).length > 0,
  { message: "At least one communication field is required" },
);

function invalidInput(res: import("express").Response, parsed: z.ZodSafeParseError<unknown>): void {
  const field = parsed.error.issues[0]?.path.join(".") || "body";
  res.status(400).json({ error: `Invalid ${field}` });
}

const ACCOUNT_SID = process.env["TWILIO_ACCOUNT_SID"];
const AUTH_TOKEN = process.env["TWILIO_AUTH_TOKEN"];

function commToApi(comm: any) {
  return {
    id: comm.id,
    leadId: comm.leadId,
    userId: comm.userId,
    user: comm.user
      ? {
          id: comm.user.id,
          clerkId: comm.user.clerkId,
          name: comm.user.name,
          email: comm.user.email,
          role: comm.user.role,
          isActive: comm.user.isActive,
          createdAt: comm.user.createdAt.toISOString(),
        }
      : null,
    type: comm.type,
    direction: comm.direction,
    fromNumber: comm.fromNumber,
    toNumber: comm.toNumber,
    body: comm.body,
    durationSeconds: comm.durationSeconds,
    recordingUrl: comm.recordingUrl,
    recordingSid: comm.recordingSid,
    status: comm.status,
    twilioSid: comm.twilioSid,
    callNotes: comm.callNotes ?? null,
    callOutcome: comm.callOutcome ?? null,
    createdAt: comm.createdAt.toISOString(),
    updatedAt: comm.updatedAt.toISOString(),
  };
}

// POST /api/leads/:id/calls/log — log an outbound call attempt from mobile
router.post("/leads/:id/calls/log", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const leadId = parseInt(req.params["id"]!, 10);
  if (isNaN(leadId)) return void res.status(400).json({ error: "Invalid lead ID" });

  const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, leadId) });
  if (!lead) return void res.status(404).json({ error: "Lead not found" });

  if (user.role === "rep" && lead.assignedRepId !== user.id) {
    return void res.status(403).json({ error: "Forbidden" });
  }

  const body = callLogBody.safeParse(req.body);
  if (!body.success) return invalidInput(res, body);
  const { toNumber, type: commType } = body.data;
  const phone = toNumber ?? lead.phone ?? undefined;
  const resolvedType = commType === "sms" ? "sms" : "call";

  const [comm] = await db.insert(communicationsTable).values({
    leadId,
    userId: user.id,
    type: resolvedType,
    direction: "outbound",
    fromNumber: undefined,
    toNumber: phone,
    status: "attempted",
  }).returning();

  await logActivity({
    userId: user.id,
    leadId,
    action: "outbound_call_attempted",
    entityType: "lead",
    entityId: leadId,
    details: { toNumber: phone },
  });

  return void res.status(201).json(commToApi(comm));
});

// POST /api/leads/:id/sms — send outbound SMS
router.post("/leads/:id/sms", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const settings = await getTelephonySettings();
  if (!ACCOUNT_SID || !AUTH_TOKEN || !settings.smsSenderNumber) {
    return void res.status(503).json({ error: "Twilio not configured" });
  }

  const leadId = parseInt(req.params["id"]!, 10);
  if (isNaN(leadId)) return void res.status(400).json({ error: "Invalid lead ID" });

  const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, leadId) });
  if (!lead) return void res.status(404).json({ error: "Lead not found" });

  if (user.role === "rep" && lead.assignedRepId !== user.id) {
    return void res.status(403).json({ error: "Forbidden" });
  }

  if (!lead.phone) return void res.status(400).json({ error: "Lead has no phone number" });

  const smsEligibility = await getLeadSmsEligibility(db, leadId);
  if (!smsEligibility.eligible && smsEligibility.reason === "unsubscribed") {
    return void res.status(422).json({
      error: "consent_required",
      message: "Cannot send SMS: lead has unsubscribed (TCPA opt-out). Update isUnsubscribed to false only with documented re-consent.",
    });
  }
  if (!smsEligibility.eligible) {
    return void res.status(422).json({
      error: "consent_required",
      message: `Cannot send SMS: ${smsEligibility.reason}.`,
    });
  }
  if (await isUsfaMarketingBlocked(db, lead.leadSource)) {
    return void res.status(422).json({
      error: "consent_required",
      message: "Cannot send SMS: USFA lead SMS consent has not been confirmed by an administrator.",
    });
  }

  const bodyInput = sendSmsBody.safeParse(req.body);
  if (!bodyInput.success) return invalidInput(res, bodyInput);
  const { body } = bodyInput.data;

  // Replies must stay on the number the lead contacted. Otherwise use the
  // configured outbound sender (never accept a client-provided sender).
  const inbound = await db.query.communicationsTable.findFirst({
    where: and(
      eq(communicationsTable.leadId, leadId),
      eq(communicationsTable.type, "sms"),
      eq(communicationsTable.direction, "inbound"),
      eq(communicationsTable.fromNumber, lead.phone),
      inArray(communicationsTable.toNumber, [...APPROVED_TWILIO_NUMBERS]),
    ),
    orderBy: [desc(communicationsTable.createdAt)],
  });
  const owned = new Set<string>(APPROVED_TWILIO_NUMBERS);
  const replyNumber = selectSmsSender(settings.smsSenderNumber, inbound?.toNumber, owned);
  const client = twilio(ACCOUNT_SID, AUTH_TOKEN);
  const message = await client.messages.create({
    from: replyNumber,
    to: lead.phone,
    body: body.trim(),
    statusCallback: absUrl(req, "/api/twilio/sms/status"),
  });

  const [comm] = await db.insert(communicationsTable).values({
    leadId,
    userId: user.id,
    type: "sms",
    direction: "outbound",
    fromNumber: replyNumber,
    toNumber: lead.phone,
    body: body.trim(),
    status: message.status,
    twilioSid: message.sid,
  }).returning();

  await logActivity({
    userId: user.id,
    leadId,
    action: "sms_sent",
    entityType: "communication",
    entityId: comm!.id,
    details: { to: lead.phone, body: body.trim().slice(0, 100) },
  });

  const full = await db.query.communicationsTable.findFirst({
    where: eq(communicationsTable.id, comm!.id),
    with: { user: true },
  });

  res.status(201).json(commToApi(full));
});

// POST /api/partners/:partnerId/contacts/:contactId/sms — business-contact SMS.
// Partner contacts are not consumer leads: no consumer consent gate is applied,
// while Twilio/A2P provider errors and STOP handling remain unchanged.
router.post("/partners/:partnerId/contacts/:contactId/sms", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const telephonySettings = await getTelephonySettings();
  if (!ACCOUNT_SID || !AUTH_TOKEN || !telephonySettings.smsSenderNumber) {
    return void res.status(503).json({ error: "Twilio not configured" });
  }
  const partnerId = positiveId.safeParse(req.params.partnerId);
  const contactId = positiveId.safeParse(req.params.contactId);
  const bodyInput = sendSmsBody.safeParse(req.body);
  if (!partnerId.success || !contactId.success) return void res.status(400).json({ error: "Invalid partner or contact ID" });
  if (!bodyInput.success) return invalidInput(res, bodyInput);
  const settings = await db.select({ enabled: companySettingsTable.partnerTextingEnabled }).from(companySettingsTable).limit(1);
  if (settings[0] && !settings[0].enabled) return void res.status(403).json({ error: "Partner texting is disabled by an administrator" });
  const contact = await db.query.partnerContactsTable.findFirst({
    where: and(eq(partnerContactsTable.id, contactId.data), eq(partnerContactsTable.partnerId, partnerId.data)),
  });
  if (!contact) return void res.status(404).json({ error: "Partner contact not found" });
  if (!contact.phone) return void res.status(400).json({ error: "Partner contact has no phone number" });
  if (contact.smsOptedOut) return void res.status(422).json({ error: "sms_opted_out", message: "Partner contact has sent STOP and cannot receive SMS." });
  const inbound = await db.query.communicationsTable.findFirst({
    where: and(
      eq(communicationsTable.partnerId, partnerId.data),
      eq(communicationsTable.type, "sms"),
      eq(communicationsTable.direction, "inbound"),
      eq(communicationsTable.fromNumber, contact.phone),
      inArray(communicationsTable.toNumber, [...APPROVED_TWILIO_NUMBERS]),
    ),
    orderBy: [desc(communicationsTable.createdAt)],
  });
  const senderNumber = selectSmsSender(
    telephonySettings.smsSenderNumber,
    inbound?.toNumber,
    new Set(APPROVED_TWILIO_NUMBERS),
  );
  let message: any;
  try {
    message = await twilio(ACCOUNT_SID, AUTH_TOKEN).messages.create({
      from: senderNumber,
      to: contact.phone,
      body: bodyInput.data.body.trim(),
      statusCallback: absUrl(req, "/api/twilio/sms/status"),
    });
  } catch (error: any) {
    const code = String(error?.code ?? "");
    return void res.status(code === "30034" ? 422 : 502).json({
      error: code === "30034" ? "A2P approval required" : "Partner SMS delivery failed",
      reason: code || "twilio_send_failed",
      message: error?.message ?? "Twilio rejected the message",
    });
  }
  const [comm] = await db.insert(communicationsTable).values({
    partnerId: partnerId.data,
    userId: user.id,
    type: "sms",
    direction: "outbound",
    fromNumber: senderNumber,
    toNumber: contact.phone,
    body: bodyInput.data.body.trim(),
    status: message.status,
    twilioSid: message.sid,
  }).returning();
  await logActivity({
    userId: user.id,
    action: "partner_sms_sent",
    entityType: "partner_contact",
    entityId: String(contact.id),
    details: { partnerId: partnerId.data, to: contact.phone, body: bodyInput.data.body.trim().slice(0, 100) },
  });
  res.status(201).json(commToApi(comm));
});

// GET /api/leads/:id/communications — list all communications for a lead
router.get("/leads/:id/communications", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const leadId = parseInt(req.params["id"]!, 10);
  if (isNaN(leadId)) return void res.status(400).json({ error: "Invalid lead ID" });

  const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, leadId) });
  if (!lead) return void res.status(404).json({ error: "Lead not found" });

  if (user.role === "rep" && lead.assignedRepId !== user.id) {
    return void res.status(403).json({ error: "Forbidden" });
  }

  const comms = await db.query.communicationsTable.findMany({
    where: eq(communicationsTable.leadId, leadId),
    with: { user: true },
    orderBy: [desc(communicationsTable.createdAt)],
  });

  res.json(comms.map(commToApi));
});

// GET /api/metrics/communications — per-rep communication stats
router.get("/metrics/communications", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  if (user.role === "rep") {
    return void res.status(403).json({ error: "Forbidden" });
  }

  const query = communicationMetricsQuery.safeParse(req.query);
  if (!query.success) return invalidInput(res, query);
  const { repId, startDate, endDate } = query.data;

  const filters: any[] = [];
  if (repId) filters.push(eq(communicationsTable.userId, repId));
  if (startDate) filters.push(gte(communicationsTable.createdAt, startDate));
  if (endDate) filters.push(lte(communicationsTable.createdAt, endDate));

  const whereClause = filters.length > 0 ? and(...filters) : undefined;

  const rows = await db
    .select({
      userId: communicationsTable.userId,
      type: communicationsTable.type,
      direction: communicationsTable.direction,
      durationSeconds: communicationsTable.durationSeconds,
    })
    .from(communicationsTable)
    .where(whereClause);

  const userIds = [...new Set(rows.map((r) => r.userId).filter((id): id is number => id !== null))];
  const users = userIds.length
    ? await db.query.usersTable.findMany({ where: (u, { inArray }) => inArray(u.id, userIds) })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  const metrics = new Map<number, { callsMade: number; callsReceived: number; smsSent: number; smsReceived: number; totalDurationSec: number }>();

  for (const row of rows) {
    if (!row.userId) continue;
    if (!metrics.has(row.userId)) {
      metrics.set(row.userId, { callsMade: 0, callsReceived: 0, smsSent: 0, smsReceived: 0, totalDurationSec: 0 });
    }
    const m = metrics.get(row.userId)!;
    if (row.type === "call" && row.direction === "outbound") m.callsMade++;
    if (row.type === "call" && row.direction === "inbound") m.callsReceived++;
    if (row.type === "sms" && row.direction === "outbound") m.smsSent++;
    if (row.type === "sms" && row.direction === "inbound") m.smsReceived++;
    if (row.type === "call" && row.durationSeconds) m.totalDurationSec += row.durationSeconds;
  }

  const result = [...metrics.entries()].map(([uid, m]) => ({
    userId: uid,
    userName: getUserDisplayName(userMap.get(uid), "Unknown"),
    callsMade: m.callsMade,
    callsReceived: m.callsReceived,
    smsSent: m.smsSent,
    smsReceived: m.smsReceived,
    totalCallDurationMinutes: Math.round((m.totalDurationSec / 60) * 100) / 100,
  }));

  res.json(result);
});

// PUT /api/communications/:id — save call notes + outcome after a call
router.put("/communications/:id", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const commId = parseInt(req.params["id"] ?? "");
  if (isNaN(commId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const parsed = updateCommunicationBody.safeParse(req.body);
  if (!parsed.success) {
    return invalidInput(res, parsed);
  }

  const [existing] = await db
    .select()
    .from(communicationsTable)
    .where(eq(communicationsTable.id, commId))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const isOwner = existing.userId === user.id;
  const isManagerOrAdmin = user.role === "manager" || user.role === "admin";
  if (!isOwner && !isManagerOrAdmin) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { callNotes, callOutcome } = parsed.data;

  type CallOutcome = "connected" | "voicemail" | "no_answer" | "wrong_number" | "busy";
  const newOutcome: CallOutcome | null | undefined = callOutcome ?? (existing.callOutcome as CallOutcome | null);

  await db
    .update(communicationsTable)
    .set({
      callNotes: callNotes ?? existing.callNotes,
      callOutcome: newOutcome,
      updatedAt: new Date(),
    })
    .where(eq(communicationsTable.id, commId));

  await logActivity({
    leadId: existing.leadId,
    userId: user.id,
    action: "updated",
    entityType: "communication",
    entityId: commId,
    details: {
      callOutcome: newOutcome,
      noteSnippet: callNotes ? callNotes.slice(0, 120) : undefined,
    },
  });

  const [withUser] = await db
    .select({ comm: communicationsTable, user: usersTable })
    .from(communicationsTable)
    .leftJoin(usersTable, eq(communicationsTable.userId, usersTable.id))
    .where(eq(communicationsTable.id, commId))
    .limit(1);

  res.json(commToApi({ ...withUser.comm, user: withUser.user }));
});

export default router;
