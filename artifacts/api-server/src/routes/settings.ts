import { Router, type IRouter, type Request, type Response } from "express";
import { requireUser } from "../lib/authHelpers";
import { db } from "@workspace/db";
import { companySettingsTable, usersTable } from "@workspace/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { logActivity } from "../lib/activityHelper";
import { z } from "zod/v4";
import { DEFAULT_ROUTING_SETTINGS } from "../lib/leadRouting";
import {
  getTelephonySettings,
  isValidE164,
  listOwnedTwilioNumbers,
} from "../lib/telephonySettings";
import { ObjectStorageService } from "../lib/objectStorage";
import { createGreetingUploadGrant, isValidGreetingMp3, verifyGreetingUploadGrant, type GreetingKind } from "../lib/telephonyGreeting";
import { randomUUID } from "node:crypto";

const router: IRouter = Router();

const TelephonySettingsBody = z.object({
  voiceCallerId: z.string().trim().nullable().optional(),
  smsSenderNumber: z.string().trim().nullable().optional(),
  voiceHoursStart: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),
  voiceHoursEnd: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),
  voiceBusinessDays: z.array(z.number().int().min(0).max(6)).min(1).max(7)
    .refine((days) => new Set(days).size === days.length, "Days must be unique").optional(),
  voiceHolidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  voiceGreeting: z.string().trim().min(1).optional(),
  voiceAfterHoursGreeting: z.string().trim().min(1).optional(),
  voiceRoutingMode: z.enum(["assigned-rep-first", "ring-all", "priority-list"]).optional(),
  voicePriorityRepIds: z.array(z.number().int().positive()).max(100)
    .refine((ids) => new Set(ids).size === ids.length, "Priority reps must be unique").optional(),
  missedCallTextBackEnabled: z.boolean().optional(),
  voicemailRecipients: z.array(z.string().email()).min(1).optional(),
  forwardingNumbers: z.array(z.object({
    userId: z.number().int().positive(),
    forwardingNumber: z.string().trim().nullable(),
  })).optional(),
}).strict().refine((body) => Object.keys(body).length > 0, {
  message: "At least one setting must be provided",
}).superRefine((body, ctx) => {
  for (const field of ["voiceCallerId", "smsSenderNumber"] as const) {
    const value = body[field];
    if (value !== undefined && value !== null && !isValidE164(value)) {
      ctx.addIssue({ code: "custom", path: [field], message: "Must be a valid E.164 number" });
    }
  }
});

const RoutingSettingsBody = z.object({
  routing: z.object({
    mode: z.enum(["manual", "round_robin"]).optional(),
    staleDays: z.number().int().min(1).max(365).optional(),
    autoReassignStale: z.boolean().optional(),
  }).optional(),
  // Retained temporarily so existing clients continue to receive a clear
  // validation result while moving to the nested routing contract.
  includeAdminsInRoundRobin: z.boolean().optional(),
}).strict();
export const EmailDeliverySettingsBody = z.object({
  emailSendingEnabled: z.boolean().optional(),
  bulkEmailPerMinute: z.number().int().min(1).max(1000).optional(),
  bulkEmailPerDay: z.number().int().min(1).max(100000).optional(),
}).strict().refine((body) => Object.keys(body).length > 0, {
  message: "At least one setting must be provided",
});
export const CompanySettingsBody = z.object({
  companyName: z.string().nullable().optional(),
  companyEmail: z.string().nullable().optional(),
  companyPhone: z.string().nullable().optional(),
  companyWebsite: z.string().nullable().optional(),
  companyAddress: z.string().nullable().optional(),
  companyCity: z.string().nullable().optional(),
  companyState: z.string().nullable().optional(),
  companyZip: z.string().nullable().optional(),
  emailSendingEnabled: z.boolean().optional(),
  bulkEmailPerMinute: z.number().int().min(1).max(1000).nullable().optional(),
  bulkEmailPerDay: z.number().int().min(1).max(100000).nullable().optional(),
  usfaSheetId: z.string().trim().min(1).nullable().optional(),
  usfaSheetTab: z.string().trim().min(1).optional(),
  usfaConsentConfirmed: z.boolean().optional(),
  usfaWebhookEnabled: z.boolean().optional(),
}).refine((body) => Object.keys(body).length > 0, {
  message: "At least one setting must be provided",
});

function routingToApi(settings: typeof companySettingsTable.$inferSelect | undefined) {
  return {
    mode: settings?.routingMode ?? DEFAULT_ROUTING_SETTINGS.mode,
    staleDays: settings?.routingStaleDays ?? settings?.staleThresholdDays ?? DEFAULT_ROUTING_SETTINGS.staleDays,
    autoReassignStale: settings?.routingAutoReassignStale ?? DEFAULT_ROUTING_SETTINGS.autoReassignStale,
  };
}

router.get("/settings/company", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") return res.status(403).json({ error: "Forbidden" }) as unknown as void;

  const [settings] = await db.select().from(companySettingsTable).limit(1);
  res.json(settings ? {
    ...settings,
    emailSendingEnabled: settings.emailSendingEnabled ?? false,
    bulkEmailPerMinute: settings.bulkEmailPerMinute ?? 60,
    bulkEmailPerDay: settings.bulkEmailPerDay ?? 60,
  } : { emailSendingEnabled: false, bulkEmailPerMinute: 60, bulkEmailPerDay: 60 });
});

router.put("/settings/company", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") return res.status(403).json({ error: "Forbidden" }) as unknown as void;

  const parsed = CompanySettingsBody.safeParse(req.body);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.join(".") || "body";
    return void res.status(400).json({ error: `Invalid ${field}`, field });
  }
  const {
    companyName, companyEmail, companyPhone, companyWebsite, companyAddress,
    companyCity, companyState, companyZip, emailSendingEnabled, bulkEmailPerMinute, bulkEmailPerDay,
    usfaSheetId, usfaSheetTab,
    usfaConsentConfirmed,
    usfaWebhookEnabled,
  } = parsed.data;
  const bulkEmailRate = typeof bulkEmailPerMinute === "number" ? bulkEmailPerMinute : undefined;
  const bulkEmailDailyLimit = typeof bulkEmailPerDay === "number" ? bulkEmailPerDay : undefined;
  if (bulkEmailPerMinute !== undefined && bulkEmailPerMinute !== null &&
      (bulkEmailRate === undefined || !Number.isInteger(bulkEmailRate) || bulkEmailRate < 1 || bulkEmailRate > 1000)) {
    return void res.status(400).json({ error: "bulkEmailPerMinute must be an integer between 1 and 1000" });
  }
  if (bulkEmailPerDay !== undefined && bulkEmailPerDay !== null &&
      (bulkEmailDailyLimit === undefined || !Number.isInteger(bulkEmailDailyLimit) || bulkEmailDailyLimit < 1 || bulkEmailDailyLimit > 100000)) {
    return void res.status(400).json({ error: "bulkEmailPerDay must be an integer between 1 and 100000" });
  }

  const [existing] = await db.select().from(companySettingsTable).limit(1);

  let result;
  if (existing) {
    const [updated] = await db
      .update(companySettingsTable)
      .set({
        ...(companyName !== undefined ? { companyName: companyName as string | null } : {}),
        ...(companyEmail !== undefined ? { companyEmail: companyEmail as string | null } : {}),
        ...(companyPhone !== undefined ? { companyPhone: companyPhone as string | null } : {}),
        ...(companyWebsite !== undefined ? { companyWebsite: companyWebsite as string | null } : {}),
        ...(companyAddress !== undefined ? { companyAddress: companyAddress as string | null } : {}),
        ...(companyCity !== undefined ? { companyCity: companyCity as string | null } : {}),
        ...(companyState !== undefined ? { companyState: companyState as string | null } : {}),
        ...(companyZip !== undefined ? { companyZip: companyZip as string | null } : {}),
        ...(emailSendingEnabled !== undefined ? { emailSendingEnabled: emailSendingEnabled === true } : {}),
        ...(bulkEmailRate !== undefined ? { bulkEmailPerMinute: bulkEmailRate } : {}),
        ...(bulkEmailDailyLimit !== undefined ? { bulkEmailPerDay: bulkEmailDailyLimit } : {}),
        ...(usfaSheetId !== undefined ? { usfaSheetId } : {}),
        ...(usfaSheetTab !== undefined ? { usfaSheetTab } : {}),
        ...(usfaConsentConfirmed !== undefined ? { usfaConsentConfirmed } : {}),
        ...(usfaWebhookEnabled !== undefined ? { usfaWebhookEnabled } : {}),
        updatedAt: new Date(),
      })
      .where(eq(companySettingsTable.id, existing.id))
      .returning();
    result = updated;
  } else {
    const [created] = await db
      .insert(companySettingsTable)
      .values({
        companyName: companyName as string | null | undefined,
        companyEmail: companyEmail as string | null | undefined,
        companyPhone: companyPhone as string | null | undefined,
        companyWebsite: companyWebsite as string | null | undefined,
        companyAddress: companyAddress as string | null | undefined,
        companyCity: companyCity as string | null | undefined,
        companyState: companyState as string | null | undefined,
        companyZip: companyZip as string | null | undefined,
        emailSendingEnabled: emailSendingEnabled === true,
        bulkEmailPerMinute: bulkEmailRate ?? 60,
        bulkEmailPerDay: bulkEmailDailyLimit ?? 75,
        usfaSheetId: usfaSheetId ?? null,
        usfaSheetTab: usfaSheetTab ?? "Sheet1",
        usfaConsentConfirmed: usfaConsentConfirmed === true,
        usfaWebhookEnabled: usfaWebhookEnabled === true,
      })
      .returning();
    result = created;
  }

  await logActivity({
    userId: user.id,
    action: "company_settings_updated",
    entityType: "company_settings",
    entityId: result?.id ?? 0,
    details: { fields: Object.keys(req.body as object) },
  });

  res.json(result);
});

router.get("/settings/email-delivery", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") return void res.status(403).json({ error: "Forbidden" });

  const [settings] = await db.select().from(companySettingsTable).limit(1);
  res.json({
    emailSendingEnabled: settings?.emailSendingEnabled ?? false,
    bulkEmailPerMinute: settings?.bulkEmailPerMinute ?? 60,
    bulkEmailPerDay: settings?.bulkEmailPerDay ?? 75,
  });
});

router.put("/settings/email-delivery", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") return void res.status(403).json({ error: "Forbidden" });

  const parsed = EmailDeliverySettingsBody.safeParse(req.body);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.join(".") || "body";
    return void res.status(400).json({ error: `Invalid ${field}` });
  }
  const body = parsed.data;

  const [existing] = await db.select().from(companySettingsTable).limit(1);
  const fields = {
    ...(body.emailSendingEnabled === undefined ? {} : { emailSendingEnabled: body.emailSendingEnabled }),
    ...(body.bulkEmailPerMinute === undefined ? {} : { bulkEmailPerMinute: body.bulkEmailPerMinute }),
    ...(body.bulkEmailPerDay === undefined ? {} : { bulkEmailPerDay: body.bulkEmailPerDay }),
    updatedAt: new Date(),
  };
  let result;
  if (existing) {
    [result] = await db.update(companySettingsTable).set(fields).where(eq(companySettingsTable.id, existing.id)).returning();
  } else {
    [result] = await db.insert(companySettingsTable).values({
      emailSendingEnabled: body.emailSendingEnabled === true,
      bulkEmailPerMinute: body.bulkEmailPerMinute ?? 60,
      bulkEmailPerDay: body.bulkEmailPerDay ?? 75,
    }).returning();
  }
  await logActivity({
    userId: user.id,
    action: "email_delivery_settings_updated",
    entityType: "company_settings",
    entityId: result?.id ?? 0,
    details: { emailSendingEnabled: result?.emailSendingEnabled ?? false, bulkEmailPerMinute: result?.bulkEmailPerMinute ?? 60, bulkEmailPerDay: result?.bulkEmailPerDay ?? 75 },
  });
  res.json({
    emailSendingEnabled: result?.emailSendingEnabled ?? false,
    bulkEmailPerMinute: result?.bulkEmailPerMinute ?? 60,
    bulkEmailPerDay: result?.bulkEmailPerDay ?? 75,
  });
});

router.get("/settings/lead-distribution", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") return res.status(403).json({ error: "Forbidden" }) as unknown as void;

  const [settings] = await db.select().from(companySettingsTable).limit(1);
  res.json({
    includeAdminsInRoundRobin: settings?.includeAdminsInRoundRobin ?? false,
    routing: routingToApi(settings),
  });
});

router.put("/settings/lead-distribution", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") return res.status(403).json({ error: "Forbidden" }) as unknown as void;

  const body = RoutingSettingsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid body", details: body.error.issues });
    return;
  }

  if (body.data.includeAdminsInRoundRobin === undefined && !body.data.routing) {
    res.status(400).json({ error: "At least one setting must be provided" });
    return;
  }

  const [existing] = await db.select().from(companySettingsTable).limit(1);
  const updateFields = {
    ...(body.data.includeAdminsInRoundRobin === undefined ? {} : { includeAdminsInRoundRobin: body.data.includeAdminsInRoundRobin }),
    ...(body.data.routing?.mode === undefined ? {} : { routingMode: body.data.routing.mode }),
    ...(body.data.routing?.staleDays === undefined ? {} : { routingStaleDays: body.data.routing.staleDays }),
    ...(body.data.routing?.autoReassignStale === undefined ? {} : { routingAutoReassignStale: body.data.routing.autoReassignStale }),
    updatedAt: new Date(),
  };
  let result;
  if (existing) {
    [result] = await db
      .update(companySettingsTable)
      .set(updateFields)
      .where(eq(companySettingsTable.id, existing.id))
      .returning();
  } else {
    [result] = await db
      .insert(companySettingsTable)
      .values({
        includeAdminsInRoundRobin: body.data.includeAdminsInRoundRobin ?? false,
        routingMode: body.data.routing?.mode ?? DEFAULT_ROUTING_SETTINGS.mode,
        routingStaleDays: body.data.routing?.staleDays ?? DEFAULT_ROUTING_SETTINGS.staleDays,
        routingAutoReassignStale: body.data.routing?.autoReassignStale ?? DEFAULT_ROUTING_SETTINGS.autoReassignStale,
      })
      .returning();
  }

  await logActivity({
    userId: user.id,
    action: "lead_distribution_settings_updated",
    entityType: "company_settings",
    entityId: result?.id ?? 0,
    details: updateFields,
  });

  res.json({
    includeAdminsInRoundRobin: result?.includeAdminsInRoundRobin ?? false,
    routing: routingToApi(result),
  });
});

router.get("/settings/partner-texting", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") return res.status(403).json({ error: "Forbidden" }) as unknown as void;
  const [settings] = await db.select({ enabled: companySettingsTable.partnerTextingEnabled }).from(companySettingsTable).limit(1);
  res.json({ enabled: settings?.enabled ?? true });
});

router.put("/settings/partner-texting", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") return res.status(403).json({ error: "Forbidden" }) as unknown as void;
  const enabled = z.boolean().safeParse(req.body?.enabled);
  if (!enabled.success) return void res.status(400).json({ error: "enabled must be boolean" });
  const [existing] = await db.select({ id: companySettingsTable.id }).from(companySettingsTable).limit(1);
  const [result] = existing
    ? await db.update(companySettingsTable).set({ partnerTextingEnabled: enabled.data, updatedAt: new Date() }).where(eq(companySettingsTable.id, existing.id)).returning()
    : await db.insert(companySettingsTable).values({ partnerTextingEnabled: enabled.data }).returning();
  await logActivity({ userId: user.id, action: "partner_texting_setting_updated", entityType: "company_settings", entityId: result.id, details: { enabled: enabled.data } });
  res.json({ enabled: result.partnerTextingEnabled });
});

router.get("/settings/telephony", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") return void res.status(403).json({ error: "Forbidden" });
  const [settings, users] = await Promise.all([
    getTelephonySettings(),
    db.select({
      id: usersTable.id, name: usersTable.name, email: usersTable.email,
      role: usersTable.role, isActive: usersTable.isActive, forwardingNumber: usersTable.forwardingNumber,
    }).from(usersTable).where(and(eq(usersTable.isActive, true), isNull(usersTable.mergedInto))).orderBy(usersTable.name),
  ]);
  res.json({
    ...settings,
    voiceHoursStart: settings.voiceHoursStart ?? "08:00",
    voiceHoursEnd: settings.voiceHoursEnd ?? "18:00",
    voiceBusinessDays: settings.voiceBusinessDays ?? [1, 2, 3, 4, 5],
    voiceHolidays: settings.voiceHolidays ?? [],
    voiceGreeting: settings.voiceGreeting ?? "Thanks for calling My Business Solutions. Please leave your name, business name, and phone number, and a representative will call you back within one business day.",
    voiceAfterHoursGreeting: settings.voiceAfterHoursGreeting ?? "Thanks for calling My Business Solutions. Our office is currently closed. Please leave your name, business name, and phone number, and we'll return your call the next business day.",
    voiceRoutingMode: settings.voiceRoutingMode ?? "assigned-rep-first",
    voicePriorityRepIds: settings.voicePriorityRepIds ?? [],
    missedCallTextBackEnabled: settings.missedCallTextBackEnabled ?? false,
    voicemailRecipients: settings.voicemailRecipients ?? ["funding@my-business-solutions.com"],
    users,
  });
});

function greetingKind(value: string): GreetingKind | null {
  return value === "business" || value === "after-hours" ? value : null;
}

router.post("/settings/telephony/greetings/:kind/upload-url", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") return void res.status(403).json({ error: "Forbidden" });
  const kind = greetingKind(String(req.params.kind));
  const info = z.object({ name: z.string().regex(/\.mp3$/i), size: z.number().int().min(1).max(2 * 1024 * 1024), contentType: z.literal("audio/mpeg") }).safeParse(req.body);
  if (!kind || !info.success) return void res.status(400).json({ error: "MP3 greeting must be at most 2 MB" });
  try {
    const { uploadUrl, objectPath } = await new ObjectStorageService().getTelephonyGreetingUploadURL();
    res.json({ uploadUrl, objectPath, grant: createGreetingUploadGrant(objectPath, kind, user.id) });
  } catch (error) {
    req.log.error({ err: error }, "Greeting upload URL unavailable");
    res.status(503).json({ error: "Greeting upload unavailable" });
  }
});

router.post("/settings/telephony/greetings/:kind/complete", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") return void res.status(403).json({ error: "Forbidden" });
  const kind = greetingKind(String(req.params.kind));
  const parsed = z.object({
    objectPath: z.string().regex(/^\/objects\/telephony\/greetings\/staging\/[0-9a-f-]{36}\.mp3$/),
    grant: z.string(),
  }).safeParse(req.body);
  if (!kind || !parsed.success || !verifyGreetingUploadGrant(parsed.data.grant, parsed.data.objectPath, kind, user.id)) {
    return void res.status(400).json({ error: "Invalid or expired greeting upload" });
  }
  try {
    const storage = new ObjectStorageService();
    const metadata = await storage.getObjectEntityMetadata(parsed.data.objectPath);
    if (metadata.contentType !== "audio/mpeg" || metadata.size < 1 || metadata.size > 2 * 1024 * 1024) {
      return void res.status(400).json({ error: "Greeting must be a valid MP3 under 2 MB" });
    }
    const audio = await storage.readObjectEntity(parsed.data.objectPath, 2 * 1024 * 1024);
    if (!isValidGreetingMp3(audio.bytes, audio.contentType) || audio.size !== audio.bytes.length) {
      return void res.status(400).json({ error: "Greeting must be a valid MP3 under 2 MB" });
    }
    const finalPath = `/objects/telephony/greetings/${randomUUID()}.mp3`;
    await storage.saveObjectEntity(finalPath, audio.bytes, "audio/mpeg");
    const field = kind === "business" ? "voiceGreetingAudioPath" : "voiceAfterHoursGreetingAudioPath";
    const [existing] = await db.select({ id: companySettingsTable.id }).from(companySettingsTable).limit(1);
    if (existing) await db.update(companySettingsTable).set({ [field]: finalPath, updatedAt: new Date() }).where(eq(companySettingsTable.id, existing.id));
    else await db.insert(companySettingsTable).values({ [field]: finalPath });
    await logActivity({ userId: user.id, action: "telephony_greeting_uploaded", entityType: "company_settings", entityId: existing?.id ?? 0, details: { kind } });
    res.json({ objectPath: finalPath });
  } catch (error) {
    req.log.error({ err: error }, "Greeting upload verification failed");
    res.status(503).json({ error: "Greeting upload verification unavailable" });
  }
});

router.delete("/settings/telephony/greetings/:kind", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") return void res.status(403).json({ error: "Forbidden" });
  const kind = greetingKind(String(req.params.kind));
  if (!kind) return void res.status(400).json({ error: "Invalid greeting" });
  const field = kind === "business" ? "voiceGreetingAudioPath" : "voiceAfterHoursGreetingAudioPath";
  const [existing] = await db.select({ id: companySettingsTable.id }).from(companySettingsTable).limit(1);
  if (existing) await db.update(companySettingsTable).set({ [field]: null, updatedAt: new Date() }).where(eq(companySettingsTable.id, existing.id));
  await logActivity({ userId: user.id, action: "telephony_greeting_removed", entityType: "company_settings", entityId: existing?.id ?? 0, details: { kind } });
  res.json({ ok: true });
});

router.get("/settings/telephony/owned-numbers", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") return void res.status(403).json({ error: "Forbidden" });
  try {
    res.json(await listOwnedTwilioNumbers());
  } catch {
    res.status(503).json({ error: "Twilio owned-number lookup unavailable" });
  }
});

router.put("/settings/telephony", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") return void res.status(403).json({ error: "Forbidden" });
  const parsed = TelephonySettingsBody.safeParse(req.body);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.join(".") || "body";
    return void res.status(400).json({ error: `Invalid ${field}` });
  }

  let owned: Awaited<ReturnType<typeof listOwnedTwilioNumbers>>;
  try {
    owned = await listOwnedTwilioNumbers();
  } catch {
    return void res.status(503).json({ error: "Twilio owned-number lookup unavailable" });
  }
  const ownedNumbers = new Set(owned.map((number) => number.phoneNumber));
  for (const field of ["voiceCallerId", "smsSenderNumber"] as const) {
    const value = parsed.data[field];
    if (value !== undefined && value !== null && !ownedNumbers.has(value)) {
      return void res.status(400).json({ error: `${field} must be an owned Twilio number` });
    }
  }
  if (parsed.data.forwardingNumbers) {
    const ids = parsed.data.forwardingNumbers.map((entry) => entry.userId);
    if (new Set(ids).size !== ids.length) {
      return void res.status(400).json({ error: "forwardingNumbers must not contain duplicate user IDs" });
    }
    for (const entry of parsed.data.forwardingNumbers) {
      if (entry.forwardingNumber !== null && !isValidE164(entry.forwardingNumber)) {
        return void res.status(400).json({ error: `Invalid forwarding number for user ${entry.userId}` });
      }
    }
    const matchedUsers = await db
      .select({ id: usersTable.id, role: usersTable.role, isActive: usersTable.isActive, mergedInto: usersTable.mergedInto })
      .from(usersTable)
      .where(inArray(usersTable.id, ids));
    if (matchedUsers.length !== ids.length) {
      return void res.status(400).json({ error: "forwardingNumbers may only target existing users" });
    }
    if (matchedUsers.some((row) => !row.isActive || row.mergedInto != null || !["rep", "manager", "admin"].includes(row.role))) {
      return void res.status(400).json({ error: "forwardingNumbers may only target active authorized users" });
    }
  }
  if (parsed.data.voicePriorityRepIds?.length) {
    const reps = await db.select({ id: usersTable.id, role: usersTable.role, isActive: usersTable.isActive, mergedInto: usersTable.mergedInto, forwardingNumber: usersTable.forwardingNumber })
      .from(usersTable).where(inArray(usersTable.id, parsed.data.voicePriorityRepIds));
    if (reps.length !== parsed.data.voicePriorityRepIds.length || reps.some((rep) => rep.role !== "rep" || !rep.isActive || rep.mergedInto != null)) {
      return void res.status(400).json({ error: "Priority list must contain active, non-merged reps" });
    }
  }

  const [existing] = await db.select({ id: companySettingsTable.id }).from(companySettingsTable).limit(1);
  const fields = {
    ...(parsed.data.voiceCallerId !== undefined ? { voiceCallerId: parsed.data.voiceCallerId } : {}),
    ...(parsed.data.smsSenderNumber !== undefined ? { smsSenderNumber: parsed.data.smsSenderNumber } : {}),
    ...(parsed.data.voiceHoursStart !== undefined ? { voiceHoursStart: parsed.data.voiceHoursStart } : {}),
    ...(parsed.data.voiceHoursEnd !== undefined ? { voiceHoursEnd: parsed.data.voiceHoursEnd } : {}),
    ...(parsed.data.voiceBusinessDays !== undefined ? { voiceBusinessDays: parsed.data.voiceBusinessDays } : {}),
    ...(parsed.data.voiceHolidays !== undefined ? { voiceHolidays: parsed.data.voiceHolidays } : {}),
    ...(parsed.data.voiceGreeting !== undefined ? { voiceGreeting: parsed.data.voiceGreeting } : {}),
    ...(parsed.data.voiceAfterHoursGreeting !== undefined ? { voiceAfterHoursGreeting: parsed.data.voiceAfterHoursGreeting } : {}),
    ...(parsed.data.voiceRoutingMode !== undefined ? { voiceRoutingMode: parsed.data.voiceRoutingMode } : {}),
    ...(parsed.data.voicePriorityRepIds !== undefined ? { voicePriorityRepIds: parsed.data.voicePriorityRepIds } : {}),
    ...(parsed.data.missedCallTextBackEnabled !== undefined ? { missedCallTextBackEnabled: parsed.data.missedCallTextBackEnabled } : {}),
    ...(parsed.data.voicemailRecipients !== undefined ? { voicemailRecipients: parsed.data.voicemailRecipients } : {}),
    updatedAt: new Date(),
  };
  if (existing) {
    await db.update(companySettingsTable).set(fields).where(eq(companySettingsTable.id, existing.id));
  } else {
    await db.insert(companySettingsTable).values(fields);
  }
  if (parsed.data.forwardingNumbers) {
    for (const entry of parsed.data.forwardingNumbers) {
      await db.update(usersTable).set({ forwardingNumber: entry.forwardingNumber, updatedAt: new Date() }).where(eq(usersTable.id, entry.userId));
    }
  }
  await logActivity({
    userId: user.id,
    action: "telephony_settings_updated",
    entityType: "company_settings",
    entityId: existing?.id ?? 0,
    details: { fields: Object.keys(parsed.data) },
  });
  const [updatedSettings, updatedUsers] = await Promise.all([
    getTelephonySettings(),
    db.select({
      id: usersTable.id, name: usersTable.name, email: usersTable.email,
      role: usersTable.role, isActive: usersTable.isActive, forwardingNumber: usersTable.forwardingNumber,
    }).from(usersTable).where(and(eq(usersTable.isActive, true), isNull(usersTable.mergedInto))).orderBy(usersTable.name),
  ]);
  res.json({ ...updatedSettings, users: updatedUsers });
});

export default router;
