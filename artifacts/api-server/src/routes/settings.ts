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

function routingToApi(settings: typeof companySettingsTable.$inferSelect | undefined) {
  return {
    mode: settings?.routingMode ?? DEFAULT_ROUTING_SETTINGS.mode,
    staleDays: settings?.routingStaleDays ?? settings?.staleThresholdDays ?? DEFAULT_ROUTING_SETTINGS.staleDays,
    autoReassignStale: settings?.routingAutoReassignStale ?? DEFAULT_ROUTING_SETTINGS.autoReassignStale,
  };
router.get("/settings/company", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") return res.status(403).json({ error: "Forbidden" }) as unknown as void;

  const [settings] = await db.select().from(companySettingsTable).limit(1);
  res.json(settings ? {
    ...settings,
    emailSendingEnabled: settings.emailSendingEnabled ?? false,
    bulkEmailPerMinute: settings.bulkEmailPerMinute ?? 60,
  } : { emailSendingEnabled: false, bulkEmailPerMinute: 60 });
});

router.put("/settings/company", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") return res.status(403).json({ error: "Forbidden" }) as unknown as void;

  const {
    companyName, companyEmail, companyPhone, companyWebsite, companyAddress,
    companyCity, companyState, companyZip, emailSendingEnabled, bulkEmailPerMinute,
  } = req.body as Record<string, string | boolean | number | null | undefined>;
  const bulkEmailRate = typeof bulkEmailPerMinute === "number" ? bulkEmailPerMinute : undefined;
  if (bulkEmailPerMinute !== undefined && bulkEmailPerMinute !== null &&
      (bulkEmailRate === undefined || !Number.isInteger(bulkEmailRate) || bulkEmailRate < 1 || bulkEmailRate > 1000)) {
    return void res.status(400).json({ error: "bulkEmailPerMinute must be an integer between 1 and 1000" });
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
  });
});

router.put("/settings/email-delivery", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") return void res.status(403).json({ error: "Forbidden" });

  const body = req.body as { emailSendingEnabled?: unknown; bulkEmailPerMinute?: unknown };
  if (body.emailSendingEnabled !== undefined && typeof body.emailSendingEnabled !== "boolean") {
    return void res.status(400).json({ error: "emailSendingEnabled must be a boolean" });
  }
  if (body.bulkEmailPerMinute !== undefined &&
      (!Number.isInteger(body.bulkEmailPerMinute) || (body.bulkEmailPerMinute as number) < 1 || (body.bulkEmailPerMinute as number) > 1000)) {
    return void res.status(400).json({ error: "bulkEmailPerMinute must be an integer between 1 and 1000" });
  }
  if (body.emailSendingEnabled === undefined && body.bulkEmailPerMinute === undefined) {
    return void res.status(400).json({ error: "At least one setting must be provided" });
  }

  const [existing] = await db.select().from(companySettingsTable).limit(1);
  const fields = {
    ...(body.emailSendingEnabled === undefined ? {} : { emailSendingEnabled: body.emailSendingEnabled }),
    ...(body.bulkEmailPerMinute === undefined ? {} : { bulkEmailPerMinute: body.bulkEmailPerMinute as number }),
    updatedAt: new Date(),
  };
  let result;
  if (existing) {
    [result] = await db.update(companySettingsTable).set(fields).where(eq(companySettingsTable.id, existing.id)).returning();
  } else {
    [result] = await db.insert(companySettingsTable).values({
      emailSendingEnabled: body.emailSendingEnabled === true,
      bulkEmailPerMinute: body.bulkEmailPerMinute === undefined ? 60 : body.bulkEmailPerMinute as number,
    }).returning();
  }
  await logActivity({
    userId: user.id,
    action: "email_delivery_settings_updated",
    entityType: "company_settings",
    entityId: result?.id ?? 0,
    details: { emailSendingEnabled: result?.emailSendingEnabled ?? false, bulkEmailPerMinute: result?.bulkEmailPerMinute ?? 60 },
  });
  res.json({
    emailSendingEnabled: result?.emailSendingEnabled ?? false,
    bulkEmailPerMinute: result?.bulkEmailPerMinute ?? 60,
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
