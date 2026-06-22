import { Router, type Request } from "express";
import twilio from "twilio";
import { db } from "@workspace/db";
import { communicationsTable, leadsTable, usersTable, tasksTable } from "@workspace/db";
import { eq, desc, and, gte, lte } from "drizzle-orm";
import { requireUser } from "../lib/authHelpers";
import { logActivity } from "../lib/activityHelper";
import { z } from "zod/v4";

function absUrl(req: Request, path: string): string {
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host = (req.headers["x-forwarded-host"] as string) || req.headers["host"] || "";
  return `${proto}://${host}${path}`;
}

const router = Router();

const TWILIO_PHONE = process.env["TWILIO_PHONE_NUMBER"];
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

  const { toNumber, type: commType } = req.body as { toNumber?: string; type?: "call" | "sms" };
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

  if (!ACCOUNT_SID || !AUTH_TOKEN || !TWILIO_PHONE) {
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

  const { body } = req.body as { body?: string };
  if (!body?.trim()) return void res.status(400).json({ error: "Message body is required" });

  const client = twilio(ACCOUNT_SID, AUTH_TOKEN);
  const message = await client.messages.create({
    from: TWILIO_PHONE,
    to: lead.phone,
    body: body.trim(),
    statusCallback: absUrl(req, "/api/twilio/sms/status"),
  });

  const [comm] = await db.insert(communicationsTable).values({
    leadId,
    userId: user.id,
    type: "sms",
    direction: "outbound",
    fromNumber: TWILIO_PHONE,
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

  const { repId, startDate, endDate } = req.query as { repId?: string; startDate?: string; endDate?: string };

  const filters: any[] = [];
  if (repId) filters.push(eq(communicationsTable.userId, parseInt(repId, 10)));
  if (startDate) filters.push(gte(communicationsTable.createdAt, new Date(startDate)));
  if (endDate) filters.push(lte(communicationsTable.createdAt, new Date(endDate)));

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
    userName: userMap.get(uid)?.name ?? null,
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

  const bodySchema = z.object({
    callNotes: z.string().optional(),
    callOutcome: z.enum(["connected", "voicemail", "no_answer", "wrong_number", "busy"]).optional(),
    followUpDate: z.string().optional(),
    followUpTitle: z.string().optional(),
  });

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
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

  const { callNotes, callOutcome, followUpDate, followUpTitle } = parsed.data;

  const [updated] = await db
    .update(communicationsTable)
    .set({
      callNotes: callNotes ?? existing.callNotes,
      callOutcome: (callOutcome ?? existing.callOutcome) as any,
      updatedAt: new Date(),
    })
    .where(eq(communicationsTable.id, commId))
    .returning();

  await logActivity({
    leadId: existing.leadId,
    userId: user.id,
    action: "updated",
    entityType: "communication",
    entityId: commId,
    details: {
      callOutcome: callOutcome ?? existing.callOutcome,
      noteSnippet: callNotes ? callNotes.slice(0, 120) : undefined,
    },
  });

  if (followUpDate && existing.leadId) {
    const title = followUpTitle || "Follow-up call";
    await db.insert(tasksTable).values({
      leadId: existing.leadId,
      userId: user.id,
      title,
      dueDate: followUpDate,
      isCompleted: false,
    });
    await logActivity({
      leadId: existing.leadId,
      userId: user.id,
      action: "created",
      entityType: "task",
      entityId: title,
    });
  }

  const [withUser] = await db
    .select({ comm: communicationsTable, user: usersTable })
    .from(communicationsTable)
    .leftJoin(usersTable, eq(communicationsTable.userId, usersTable.id))
    .where(eq(communicationsTable.id, commId))
    .limit(1);

  res.json(commToApi({ ...withUser.comm, user: withUser.user }));
});

export default router;
