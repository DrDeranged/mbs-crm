import { Router, type IRouter, type Request, type Response } from "express";
import { requireUser } from "../lib/authHelpers";
import { db } from "@workspace/db";
import { companySettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logActivity } from "../lib/activityHelper";
import { z } from "zod/v4";
import { DEFAULT_ROUTING_SETTINGS } from "../lib/leadRouting";

const router: IRouter = Router();

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
    bulkEmailPerDay: settings.bulkEmailPerDay ?? 75,
  } : { emailSendingEnabled: false, bulkEmailPerMinute: 60, bulkEmailPerDay: 75 });
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

export default router;
