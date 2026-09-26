import { Router, type Request, type Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod/v4";
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or, isNull, isNotNull, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  campaignsTable,
  campaignAudiencePresetsTable,
  campaignApprovalsTable,
  campaignAudiencePreviewsTable,
  campaignAuditEventsTable,
  campaignLaunchesTable,
  campaignRecipientsTable,
  collateralTemplatesTable,
  companiesTable,
  emailTemplatesTable,
  leadsTable,
  usersTable,
} from "@workspace/db";
import { requireUser } from "../lib/authHelpers";
import { getLeadSmsEligibility } from "../lib/smsEligibility";
import { isEmailSuppressed } from "../lib/emailSafety";
import { getDailyMarketingEmailCapacity, doSendEmail, buildVariables, renderTemplate } from "./email";
import { getPublicBaseUrl } from "../lib/brand";
import {
  canTransitionCampaign,
  canManageCampaign,
  campaignFailureState,
  campaignStatusAfterLaunch,
  classifyEmailRecipient,
  classifySmsRecipient,
  hasCurrentApproval,
  isSmsLaunchUnsupported,
  campaignContentHash,
  approvedFlyerMatches,
  campaignFlyerAttachments,
  campaignFlyerLinkMarker,
  renderCampaignFlyerLink,
  vendorVertical,
  isFutureCampaignSchedule,
  unionCampaignAudience,
  campaignExclusionReasonCounts,
  includeCampaignFilterMatches,
} from "../lib/campaignCore";
import { ObjectStorageService } from "../lib/objectStorage";
import { campaignSourceBytes, buildSignedCampaignFlyerUrl } from "./collateral";
import { approvedAudienceSummary, buildCampaignValidationResult, hasEligibleCampaignAudience, validateCampaignMergeTokens, validateCampaignRender } from "../lib/campaignReadiness";
import { sanitizeLikeInput } from "../lib/sanitize";

const router = Router();
const objectStorage = new ObjectStorageService();
const id = z.coerce.number().int().positive();
const channels = z.enum(["email", "sms", "email_sms"]);
const flyerSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("built_in"),
    key: z.enum(["equipment_financing", "working_capital"]),
    name: z.string().trim().min(1).max(255),
    contentType: z.literal("image/png"),
  }),
  z.object({
    source: z.literal("uploaded"),
    objectPath: z.string().regex(/^\/objects\/campaigns\/\d+\/[a-f0-9-]+$/),
    name: z.string().trim().min(1).max(255),
    contentType: z.enum(["image/png", "image/jpeg", "image/webp", "application/pdf"]),
    size: z.number().int().positive().max(15 * 1024 * 1024),
  }),
  z.object({
    source: z.literal("library"),
    templateId: id,
    name: z.string().trim().min(1).max(255),
  }),
]).nullable();
const rulesSchema = z.object({
  statuses: z.array(z.string()).max(20).optional(),
  programTypes: z.array(z.enum(["equipment", "working_capital"])).max(2).optional(),
  assignedRepId: id.nullable().optional(),
  leadSources: z.array(z.string()).max(20).optional(),
  createdFrom: z.coerce.date().nullable().optional(),
  createdTo: z.coerce.date().nullable().optional(),
  minAmount: z.coerce.number().int().nonnegative().nullable().optional(),
  maxAmount: z.coerce.number().int().nonnegative().nullable().optional(),
  pickedLeadIds: z.array(z.number().int().positive()).max(1000).refine((ids) => new Set(ids).size === ids.length, "pickedLeadIds must be unique").optional(),
});
const campaignBody = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).nullable().optional(),
  channel: channels.optional(),
  emailTemplateId: id.nullable().optional(),
  smsBody: z.string().trim().max(1600).nullable().optional(),
  flyer: flyerSchema.optional(),
  flyerDeliveryMode: z.enum(["attach", "link"]).optional(),
  audienceRules: rulesSchema.optional(),
  ownerId: id.optional(),
  replyToEmail: z.string().trim().email().optional(),
});
const launchBody = z.object({
  idempotencyKey: z.string().trim().min(8).max(200),
  mode: z.enum(["live", "dry_run"]).default("live"),
  scheduledAt: z.coerce.date().nullable().optional(),
});
const DEFAULT_REPLY_TO = "nate@my-business-solutions.com";

function flyerModeError(flyer: z.infer<typeof flyerSchema> | undefined, mode: "attach" | "link"): string | null {
  return mode === "link" && flyer && flyer.source !== "library"
    ? "Link delivery requires a flyer from the collateral library. Select one or choose Attach."
    : null;
}

function nextBusinessDay(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(now).reduce<Record<string, string>>((out, part) => { out[part.type] = part.value; return out; }, {});
  const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 13));
  do date.setUTCDate(date.getUTCDate() + 1);
  while ([0, 6].includes(date.getUTCDay()));
  return date;
}
const presetBody = z.object({
  name: z.string().trim().min(1).max(120),
  rules: rulesSchema,
});

async function validateUploadedFlyer(
  flyer: z.infer<typeof flyerSchema> | undefined,
  user: { id: number; role: string },
): Promise<string | null> {
  if (!flyer) return null;
  if (flyer.source === "library") {
    const [item] = await db.select().from(collateralTemplatesTable).where(eq(collateralTemplatesTable.id, flyer.templateId)).limit(1);
    if (!item || item.category !== "flyer" || item.status !== "published" ||
      !item.assetSha256 || !item.assetGeneration || !item.sourceKey.startsWith("/objects/")) {
      return "Selected library flyer is unavailable";
    }
    return null;
  }
  if (flyer.source !== "uploaded") return null;
  if (!flyer.objectPath.startsWith(`/objects/campaigns/${user.id}/`) && user.role !== "admin") {
    return "Uploaded flyer does not belong to the current user";
  }
  try {
    const metadata = await objectStorage.getObjectEntityMetadata(flyer.objectPath);
    if (metadata.contentType !== flyer.contentType || metadata.size !== flyer.size) {
      return "Uploaded flyer metadata does not match the stored file";
    }
  } catch {
    return "Uploaded flyer could not be found in App Storage";
  }
  return null;
}

type ResolvedCampaignFlyer = {
  source: "built_in" | "uploaded" | "library";
  key?: "equipment_financing" | "working_capital";
  templateId?: number;
  objectPath?: string;
  name: string;
  contentType: string;
  size: number;
  digest: string;
  generation: string;
  bytes: Buffer;
};

async function resolveCampaignFlyer(raw: unknown): Promise<ResolvedCampaignFlyer | null> {
  const parsed = flyerSchema.safeParse(raw);
  if (!parsed.success || !parsed.data) return null;
  const flyer = parsed.data;
  if (flyer.source === "built_in") {
    const sourceKey = `mbs://campaign/${flyer.key === "equipment_financing" ? "equipment-financing" : "working-capital"}`;
    const bytes = await campaignSourceBytes(sourceKey);
    if (!bytes) throw new Error("APPROVED_FLYER_UNAVAILABLE");
    return {
      ...flyer,
      bytes,
      size: bytes.length,
      digest: createHash("sha256").update(bytes).digest("hex"),
      generation: "built-in",
    };
  }
  if (flyer.source === "library") {
    const [item] = await db.select().from(collateralTemplatesTable).where(eq(collateralTemplatesTable.id, flyer.templateId)).limit(1);
    if (!item || item.status !== "published" || item.category !== "flyer" ||
      !item.assetSha256 || !item.assetGeneration || !item.sourceKey.startsWith("/objects/")) {
      throw new Error("APPROVED_FLYER_UNAVAILABLE");
    }
    const stored = await objectStorage.readObjectEntity(item.sourceKey);
    const digest = createHash("sha256").update(stored.bytes).digest("hex");
    if (!["image/png", "application/pdf"].includes(stored.contentType) ||
      stored.contentType !== item.assetContentType || stored.size !== item.assetSize ||
      stored.generation !== item.assetGeneration || digest !== item.assetSha256) {
      throw new Error("APPROVED_FLYER_CHANGED");
    }
    return {
      source: "library", templateId: item.id, objectPath: item.sourceKey,
      name: item.name, ...stored,
      digest,
    };
  }
  const stored = await objectStorage.readObjectEntity(flyer.objectPath);
  if (stored.contentType !== flyer.contentType || stored.size !== flyer.size) throw new Error("APPROVED_FLYER_CHANGED");
  return {
    ...flyer,
    ...stored,
    digest: createHash("sha256").update(stored.bytes).digest("hex"),
  };
}

function flyerSnapshot(flyer: ResolvedCampaignFlyer | null) {
  if (!flyer) return null;
  const { bytes: _bytes, ...snapshot } = flyer;
  return snapshot;
}

function parseId(req: Request): number | null {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const parsed = id.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

async function getCampaign(campaignId: number) {
  const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, campaignId));
  return campaign;
}

async function audit(campaignId: number, actorUserId: number, action: string, fromStatus: string | null, toStatus: string | null, details?: Record<string, unknown>) {
  await db.insert(campaignAuditEventsTable).values({ campaignId, actorUserId, action, fromStatus, toStatus, details: details ?? null });
}

function requestedChannels(channel: "email" | "sms" | "email_sms"): Array<"email" | "sms"> {
  return channel === "email_sms" ? ["email", "sms"] : [channel];
}

async function audiencePreview(campaign: typeof campaignsTable.$inferSelect) {
  const rules = rulesSchema.parse(campaign.audienceRules ?? {});
  const conditions = [];
  if (rules.statuses?.length) conditions.push(inArray(leadsTable.status, rules.statuses as any));
  if (rules.programTypes?.length) conditions.push(inArray(leadsTable.applicationType, rules.programTypes));
  if (rules.assignedRepId != null) conditions.push(eq(leadsTable.assignedRepId, rules.assignedRepId));
  if (rules.leadSources?.length) conditions.push(inArray(leadsTable.leadSource, rules.leadSources as any));
  if (rules.createdFrom) conditions.push(gte(leadsTable.createdAt, rules.createdFrom));
  if (rules.createdTo) conditions.push(lte(leadsTable.createdAt, rules.createdTo));
  if (rules.minAmount != null) conditions.push(gte(leadsTable.requestedAmount, rules.minAmount));
  if (rules.maxAmount != null) conditions.push(lte(leadsTable.requestedAmount, rules.maxAmount));
  const pickedIds = rules.pickedLeadIds ?? [];
  // No filter plus manual picks means picked-only, not an accidental all-leads send.
  const filterMatches = includeCampaignFilterMatches(conditions.length, pickedIds.length)
    ? await db.select().from(leadsTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(leadsTable.id))
    : [];
  const pickedLeads = pickedIds.length
    ? await db.select().from(leadsTable).where(inArray(leadsTable.id, pickedIds)).orderBy(asc(leadsTable.id))
    : [];
  const foundPickedIds = new Set(pickedLeads.map((lead) => lead.id));
  const missingPickedLeadIds = pickedIds.filter((leadId) => !foundPickedIds.has(leadId));
  if (missingPickedLeadIds.length) {
    const error = new Error(`Selected lead IDs no longer exist: ${missingPickedLeadIds.join(", ")}`);
    Object.assign(error, { statusCode: 400 });
    throw error;
  }
  const leads = unionCampaignAudience(filterMatches, pickedLeads);
  const filterMatchIds = new Set(filterMatches.map((lead) => lead.id));
  const seenEmails = new Set<string>();
  const seenPhones = new Set<string>();
  const channelsForCampaign = requestedChannels(campaign.channel);
  const exclusions: Array<{ leadId: number; channel: string; reason: string; origin: "filtered" | "picked" }> = [];
  const eligible: Array<{ leadId: number; channel: "email" | "sms"; target: string; origin: "filtered" | "picked" }> = [];
  const emailCapacity = await getDailyMarketingEmailCapacity();
  const alreadySentRows = leads.length ? await db.select({
    leadId: campaignRecipientsTable.leadId,
    channel: campaignRecipientsTable.channel,
  }).from(campaignRecipientsTable).where(and(
    eq(campaignRecipientsTable.campaignId, campaign.id),
    eq(campaignRecipientsTable.status, "sent"),
    inArray(campaignRecipientsTable.leadId, leads.map((lead) => lead.id)),
  )) : [];
  const alreadySent = new Set(alreadySentRows.map((row) => `${row.leadId}:${row.channel}`));
  let emailEligibleCount = 0;
  for (const lead of leads) {
    for (const channel of channelsForCampaign) {
      if (alreadySent.has(`${lead.id}:${channel}`)) {
        exclusions.push({ leadId: lead.id, channel, reason: "already_sent", origin: lead.origin });
        continue;
      }
      if (channel === "email") {
        const email = lead.email?.trim().toLowerCase();
        const emailReason = classifyEmailRecipient({
          email: lead.email,
          duplicate: Boolean(email && seenEmails.has(email)),
          unsubscribed: lead.isUnsubscribed,
          suppressed: Boolean(email && await isEmailSuppressed(email)),
          // Capacity controls dispatch, not audience eligibility. Overflow is
          // retained in the approved snapshot and queued for the next
          // business day rather than being silently excluded.
          capacityAvailable: true,
        });
        if (emailReason !== "eligible") { exclusions.push({ leadId: lead.id, channel, reason: emailReason, origin: lead.origin }); continue; }
        if (!email) continue;
        seenEmails.add(email);
        emailEligibleCount++;
        eligible.push({ leadId: lead.id, channel, target: email, origin: lead.origin });
      } else {
        const phone = lead.phone?.trim();
        const sms = await getLeadSmsEligibility(db, lead.id);
        const smsReason = classifySmsRecipient({
          phone: lead.phone,
          duplicate: Boolean(phone && seenPhones.has(phone)),
          eligible: sms.eligible,
          reason: sms.reason,
        });
        if (smsReason !== "sms_launch_not_supported") { exclusions.push({ leadId: lead.id, channel, reason: smsReason, origin: lead.origin }); continue; }
        if (!phone) continue;
        seenPhones.add(phone);
        exclusions.push({ leadId: lead.id, channel, reason: "sms_launch_not_supported", origin: lead.origin });
      }
    }
  }
  return {
    totalMatching: leads.length,
    eligible,
    exclusions,
    counts: {
      eligible: eligible.length,
      excluded: exclusions.length,
      emailEligible: eligible.filter((entry) => entry.channel === "email").length,
      smsEligible: 0,
      emailCapacityRemaining: emailCapacity.remaining,
      emailToday: Math.min(emailEligibleCount, emailCapacity.remaining),
      emailQueuedNextBusinessDay: Math.max(0, emailEligibleCount - emailCapacity.remaining),
      filterMatches: filterMatches.length,
      pickedAdded: pickedLeads.filter((lead) => !filterMatchIds.has(lead.id)).length,
      reasonCounts: campaignExclusionReasonCounts(exclusions),
    },
  };
}

async function campaignContent(campaign: typeof campaignsTable.$inferSelect) {
  const template = campaign.emailTemplateId
    ? (await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.id, campaign.emailTemplateId)).limit(1))[0] ?? null
    : null;
  const resolvedFlyer = await resolveCampaignFlyer(campaign.flyer);
  return {
    channel: campaign.channel,
    replyToEmail: campaign.replyToEmail ?? DEFAULT_REPLY_TO,
    audienceRules: campaign.audienceRules ?? {},
    smsBody: campaign.smsBody ?? null,
    flyerDeliveryMode: campaign.flyerDeliveryMode,
    flyer: flyerSnapshot(resolvedFlyer),
    emailTemplate: template ? {
      id: template.id, updatedAt: template.updatedAt?.toISOString() ?? null,
      subject: template.subject, bodyHtml: template.bodyHtml,
      senderMode: template.senderMode, isActive: template.isActive,
    } : null,
  };
}

async function campaignTemplateTokenError(templateId: number | null | undefined, channel: string): Promise<string | null> {
  if (!["email", "email_sms"].includes(channel) || !templateId) return null;
  const [template] = await db.select({ subject: emailTemplatesTable.subject, bodyHtml: emailTemplatesTable.bodyHtml })
    .from(emailTemplatesTable).where(eq(emailTemplatesTable.id, templateId)).limit(1);
  return validateCampaignMergeTokens(template ?? null);
}

async function reconcileCampaignRecipient(input: {
  launchId: number; campaignId: number; recipientId: number; leaseToken: string;
  status: "sent" | "failed" | "excluded"; reason?: string; emailSendId?: number;
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [lease] = await tx.update(campaignLaunchesTable).set({
      executionLeaseExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
    }).where(and(eq(campaignLaunchesTable.id, input.launchId), eq(campaignLaunchesTable.status, "running"),
      eq(campaignLaunchesTable.executionLeaseToken, input.leaseToken))).returning({ id: campaignLaunchesTable.id });
    if (!lease) return false;
    const [campaign] = await tx.select({ status: campaignsTable.status }).from(campaignsTable)
      .where(eq(campaignsTable.id, input.campaignId)).limit(1);
    if (!campaign || campaign.status !== "running") return false;
    const [updated] = await tx.update(campaignRecipientsTable).set({
      status: input.status, ...(input.reason ? { exclusionReason: input.reason } : {}),
      ...(input.emailSendId ? { emailSendId: input.emailSendId } : {}),
    }).where(and(eq(campaignRecipientsTable.id, input.recipientId), eq(campaignRecipientsTable.status, "queued"))).returning({ id: campaignRecipientsTable.id });
    return Boolean(updated);
  });
}

async function requireCampaignManager(req: Request, res: Response) {
  const user = await requireUser(req, res);
  if (!user) return null;
  if (!canManageCampaign(user)) { res.status(403).json({ error: "Manager or admin role required" }); return null; }
  return user;
}

router.get("/campaigns", async (req, res): Promise<void> => {
  const user = await requireCampaignManager(req, res);
  if (!user) return;
  const rows = await db.select().from(campaignsTable).orderBy(desc(campaignsTable.updatedAt));
  res.json(rows);
});

const leadPickerQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(1000).default(25),
}).strict();
const leadPickerResolveSchema = z.object({
  ids: z.array(z.number().int().positive()).max(1000)
    .refine((ids) => new Set(ids).size === ids.length, "ids must be unique"),
}).strict();
const compactLeadSelection = {
  id: leadsTable.id,
  firstName: leadsTable.firstName,
  lastName: leadsTable.lastName,
  companyName: leadsTable.companyName,
  email: leadsTable.email,
  leadSource: leadsTable.leadSource,
};

router.get("/campaigns/lead-picker", async (req, res): Promise<void> => {
  const user = await requireCampaignManager(req, res);
  if (!user) return;
  const parsed = leadPickerQuerySchema.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Invalid lead picker query", details: parsed.error.flatten() }); return; }
  const { search, page, limit } = parsed.data;
  const pattern = search ? `%${sanitizeLikeInput(search)}%` : "";
  const searchCondition = search
    ? or(
      ilike(leadsTable.firstName, pattern),
      ilike(leadsTable.lastName, pattern),
      sql`concat_ws(' ', ${leadsTable.firstName}, ${leadsTable.lastName}) ilike ${pattern}`,
      ilike(leadsTable.companyName, pattern),
      ilike(leadsTable.email, pattern),
      ilike(leadsTable.leadSource, pattern),
    )
    : undefined;
  const [totalRow] = await db.select({ total: count() }).from(leadsTable).where(searchCondition);
  const leads = await db.select(compactLeadSelection).from(leadsTable)
    .where(searchCondition).orderBy(asc(leadsTable.id)).limit(limit).offset((page - 1) * limit);
  res.json({ leads, total: totalRow?.total ?? 0, page, limit });
});

router.post("/campaigns/lead-picker/resolve", async (req, res): Promise<void> => {
  const user = await requireCampaignManager(req, res);
  if (!user) return;
  const parsed = leadPickerResolveSchema.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: "Invalid lead IDs", details: parsed.error.flatten() }); return; }
  const leads = parsed.data.ids.length
    ? await db.select(compactLeadSelection).from(leadsTable)
      .where(inArray(leadsTable.id, parsed.data.ids)).orderBy(asc(leadsTable.id))
    : [];
  res.json(leads);
});

router.get("/campaign-flyers", async (req, res): Promise<void> => {
  const user = await requireCampaignManager(req, res);
  if (!user) return;
  const rows = await db.select({ flyer: campaignsTable.flyer }).from(campaignsTable).orderBy(desc(campaignsTable.updatedAt));
  const seen = new Set<string>();
  const flyers = rows.flatMap(({ flyer }) => {
    const parsed = flyerSchema.safeParse(flyer);
    if (!parsed.success || !parsed.data || parsed.data.source !== "uploaded") return [];
    const item = parsed.data;
    if (user.role !== "admin" && !item.objectPath.startsWith(`/objects/campaigns/${user.id}/`)) return [];
    if (seen.has(item.objectPath)) return [];
    seen.add(item.objectPath);
    return [item];
  });
  res.json(flyers);
});

router.get("/campaigns/:id", async (req, res): Promise<void> => {
  const user = await requireCampaignManager(req, res);
  if (!user) return;
  const campaignId = parseId(req);
  if (!campaignId) { res.status(400).json({ error: "Invalid campaign id" }); return; }
  const campaign = await getCampaign(campaignId);
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }
  const launches = await db.select().from(campaignLaunchesTable).where(eq(campaignLaunchesTable.campaignId, campaignId)).orderBy(desc(campaignLaunchesTable.createdAt));
  const [approval] = await db.select().from(campaignApprovalsTable).where(and(
    eq(campaignApprovalsTable.campaignId, campaignId), eq(campaignApprovalsTable.contentVersion, campaign.version),
  )).orderBy(desc(campaignApprovalsTable.approvedAt)).limit(1);
  res.json({ campaign, launches, approvedAudience: approvedAudienceSummary(campaign.status, campaign.version, approval) });
});

router.post("/campaigns", async (req, res): Promise<void> => {
  const user = await requireCampaignManager(req, res);
  if (!user) return;
  const parsed = campaignBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid campaign" }); return; }
  const data = parsed.data;
  const modeError = flyerModeError(data.flyer, data.flyerDeliveryMode ?? "link");
  if (modeError) { res.status(400).json({ error: modeError }); return; }
  const tokenError = await campaignTemplateTokenError(data.emailTemplateId, data.channel ?? "email");
  if (tokenError) { res.status(400).json({ error: tokenError }); return; }
  const flyerError = await validateUploadedFlyer(data.flyer, user);
  if (flyerError) { res.status(400).json({ error: flyerError }); return; }
  const [created] = await db.insert(campaignsTable).values({
    name: data.name,
    description: data.description ?? null,
    channel: data.channel ?? "email",
    emailTemplateId: data.emailTemplateId ?? null,
    smsBody: data.smsBody ?? null,
    flyer: data.flyer ?? null,
    flyerDeliveryMode: data.flyerDeliveryMode ?? "link",
    audienceRules: data.audienceRules ?? {},
    ownerId: data.ownerId ?? user.id,
    replyToEmail: data.replyToEmail ?? DEFAULT_REPLY_TO,
    createdBy: user.id,
  }).returning();
  await audit(created.id, user.id, "created", null, "draft");
  res.status(201).json(created);
});

router.patch("/campaigns/:id", async (req, res): Promise<void> => {
  const user = await requireCampaignManager(req, res);
  if (!user) return;
  const campaignId = parseId(req);
  if (!campaignId) { res.status(400).json({ error: "Invalid campaign id" }); return; }
  const campaign = await getCampaign(campaignId);
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }
  if (["running", "completed", "cancelled"].includes(campaign.status)) { res.status(409).json({ error: "Campaign cannot be edited in its current state" }); return; }
  const parsed = campaignBody.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid campaign" }); return; }
  const data = parsed.data;
  const modeError = flyerModeError(
    data.flyer === undefined ? flyerSchema.parse(campaign.flyer) : data.flyer,
    data.flyerDeliveryMode ?? campaign.flyerDeliveryMode,
  );
  if (modeError) { res.status(400).json({ error: modeError }); return; }
  if (data.emailTemplateId !== undefined || data.channel !== undefined) {
    const tokenError = await campaignTemplateTokenError(
      data.emailTemplateId === undefined ? campaign.emailTemplateId : data.emailTemplateId,
      data.channel === undefined ? campaign.channel : data.channel,
    );
    if (tokenError) { res.status(400).json({ error: tokenError }); return; }
  }
  const flyerError = await validateUploadedFlyer(data.flyer, user);
  if (flyerError) { res.status(flyerError.includes("belong") ? 403 : 400).json({ error: flyerError }); return; }
  const contentChanged = ["name", "channel", "emailTemplateId", "smsBody", "flyer", "flyerDeliveryMode", "audienceRules", "replyToEmail"].some((key) => key in data);
  const [updated] = await db.update(campaignsTable).set({
    ...(data.name === undefined ? {} : { name: data.name }),
    ...(data.description === undefined ? {} : { description: data.description }),
    ...(data.channel === undefined ? {} : { channel: data.channel }),
    ...(data.emailTemplateId === undefined ? {} : { emailTemplateId: data.emailTemplateId }),
    ...(data.smsBody === undefined ? {} : { smsBody: data.smsBody }),
    ...(data.flyer === undefined ? {} : { flyer: data.flyer }),
    ...(data.flyerDeliveryMode === undefined ? {} : { flyerDeliveryMode: data.flyerDeliveryMode }),
    ...(data.audienceRules === undefined ? {} : { audienceRules: data.audienceRules }),
    ...(data.ownerId === undefined ? {} : { ownerId: data.ownerId }),
    ...(data.replyToEmail === undefined ? {} : { replyToEmail: data.replyToEmail }),
    ...(contentChanged ? { version: campaign.version + 1, status: "draft" as const, scheduledAt: null } : {}),
    updatedAt: new Date(),
  }).where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.version, campaign.version), eq(campaignsTable.status, campaign.status))).returning();
  if (!updated) { res.status(409).json({ error: "Campaign changed while it was being edited" }); return; }
  if (contentChanged) {
    await db.update(campaignApprovalsTable).set({ invalidatedAt: new Date(), invalidatedReason: "Campaign content or audience changed" })
      .where(and(eq(campaignApprovalsTable.campaignId, campaignId), eq(campaignApprovalsTable.contentVersion, campaign.version)));
  }
  await audit(campaignId, user.id, contentChanged ? "updated_and_approval_invalidated" : "updated", campaign.status, updated.status);
  res.json(updated);
});

router.post("/campaigns/:id/duplicate", async (req, res): Promise<void> => {
  const user = await requireCampaignManager(req, res);
  if (!user) return;
  const campaignId = parseId(req);
  if (!campaignId) { res.status(400).json({ error: "Invalid campaign id" }); return; }
  const campaign = await getCampaign(campaignId);
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }
  const name = z.object({ name: z.string().trim().min(1).max(160).optional() }).parse(req.body ?? {}).name ?? `${campaign.name} Copy`;
  const [copy] = await db.insert(campaignsTable).values({
    name, description: campaign.description, channel: campaign.channel, status: "draft",
    emailTemplateId: campaign.emailTemplateId, smsBody: campaign.smsBody, flyer: campaign.flyer, flyerDeliveryMode: campaign.flyerDeliveryMode, audienceRules: campaign.audienceRules,
    ownerId: user.id, createdBy: user.id,
  }).returning();
  await audit(copy.id, user.id, "duplicated", null, "draft", { sourceCampaignId: campaign.id });
  res.status(201).json(copy);
});

router.post("/campaigns/:id/preview", async (req, res): Promise<void> => {
  const user = await requireCampaignManager(req, res);
  if (!user) return;
  const campaignId = parseId(req);
  if (!campaignId) { res.status(400).json({ error: "Invalid campaign id" }); return; }
  const campaign = await getCampaign(campaignId);
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }
  let preview: Awaited<ReturnType<typeof audiencePreview>>;
  try {
    preview = await audiencePreview(campaign);
  } catch (error) {
    const statusCode = Number((error as { statusCode?: number }).statusCode);
    if (statusCode === 400) { res.status(400).json({ error: (error as Error).message }); return; }
    throw error;
  }
  const content = await campaignContent(campaign);
  const modeError = flyerModeError(flyerSchema.parse(campaign.flyer), campaign.flyerDeliveryMode);
  if (modeError) { res.status(409).json({ error: modeError }); return; }
  const contentHash = campaignContentHash(content);
  const [stored] = await db.insert(campaignAudiencePreviewsTable).values({
    previewToken: randomUUID(), campaignId, campaignVersion: campaign.version,
    requestedBy: user.id, contentHash, counts: preview.counts,
    recipientsSnapshot: [
      ...preview.eligible.map((entry) => ({ leadId: entry.leadId, channel: entry.channel, target: entry.target, origin: entry.origin })),
      ...preview.exclusions.map((entry) => ({ leadId: entry.leadId, channel: entry.channel, reason: entry.reason, origin: entry.origin })),
    ],
  }).returning();
  res.json({ ...preview, previewToken: stored.previewToken, previewId: stored.id, contentHash });
});

router.get("/campaign-audience-presets", async (req, res): Promise<void> => {
  const user = await requireCampaignManager(req, res);
  if (!user) return;
  res.json(await db.select().from(campaignAudiencePresetsTable).where(eq(campaignAudiencePresetsTable.ownerId, user.id)).orderBy(asc(campaignAudiencePresetsTable.name)));
});

router.post("/campaign-audience-presets", async (req, res): Promise<void> => {
  const user = await requireCampaignManager(req, res);
  if (!user) return;
  const parsed = presetBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid preset" }); return; }
  const [preset] = await db.insert(campaignAudiencePresetsTable).values({ ...parsed.data, ownerId: user.id }).returning();
  res.status(201).json(preset);
});

router.patch("/campaign-audience-presets/:id", async (req, res): Promise<void> => {
  const user = await requireCampaignManager(req, res);
  if (!user) return;
  const presetId = parseId(req);
  if (!presetId) { res.status(400).json({ error: "Invalid preset id" }); return; }
  const parsed = presetBody.partial().refine((value) => Object.keys(value).length > 0).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid preset" }); return; }
  const predicate = user.role === "admin"
    ? eq(campaignAudiencePresetsTable.id, presetId)
    : and(eq(campaignAudiencePresetsTable.id, presetId), eq(campaignAudiencePresetsTable.ownerId, user.id));
  const [updated] = await db.update(campaignAudiencePresetsTable).set({
    ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
    ...(parsed.data.rules === undefined ? {} : { rules: parsed.data.rules }),
    updatedAt: new Date(),
  }).where(predicate).returning();
  if (!updated) { res.status(404).json({ error: "Preset not found" }); return; }
  res.json(updated);
});

router.delete("/campaign-audience-presets/:id", async (req, res): Promise<void> => {
  const user = await requireCampaignManager(req, res);
  if (!user) return;
  const presetId = parseId(req);
  if (!presetId) { res.status(400).json({ error: "Invalid preset id" }); return; }
  const predicate = user.role === "admin"
    ? eq(campaignAudiencePresetsTable.id, presetId)
    : and(eq(campaignAudiencePresetsTable.id, presetId), eq(campaignAudiencePresetsTable.ownerId, user.id));
  const [deleted] = await db.delete(campaignAudiencePresetsTable).where(predicate).returning({ id: campaignAudiencePresetsTable.id });
  if (!deleted) { res.status(404).json({ error: "Preset not found" }); return; }
  res.sendStatus(204);
});

router.post("/campaigns/:id/approve", async (req, res): Promise<void> => {
  const user = await requireCampaignManager(req, res);
  if (!user) return;
  const campaignId = parseId(req);
  if (!campaignId) { res.status(400).json({ error: "Invalid campaign id" }); return; }
  const campaign = await getCampaign(campaignId);
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }
  if (campaign.status !== "draft") { res.status(409).json({ error: "Only draft campaigns can be approved" }); return; }
  const body = z.object({
    approvalType: z.string().trim().min(1).max(80).default("content_and_audience"),
    previewToken: z.string().trim().min(10),
    claimsAffirmed: z.literal(true),
  }).safeParse(req.body ?? {});
  if (!body.success) { res.status(400).json({ error: "A current previewToken and claimsAffirmed=true are required" }); return; }
  const content = await campaignContent(campaign);
  const modeError = flyerModeError(flyerSchema.parse(campaign.flyer), campaign.flyerDeliveryMode);
  if (modeError) { res.status(409).json({ error: modeError }); return; }
  if (["email", "email_sms"].includes(campaign.channel) && (!content.emailTemplate || !content.emailTemplate.isActive)) {
    res.status(409).json({ error: "An active email template is required before approval" }); return;
  }
  const tokenError = ["email", "email_sms"].includes(campaign.channel)
    ? validateCampaignMergeTokens(content.emailTemplate)
    : null;
  if (tokenError) { res.status(409).json({ error: tokenError }); return; }
  const contentHash = campaignContentHash(content);
  const [preview] = await db.select().from(campaignAudiencePreviewsTable).where(and(
    eq(campaignAudiencePreviewsTable.previewToken, body.data.previewToken),
    eq(campaignAudiencePreviewsTable.campaignId, campaignId),
    eq(campaignAudiencePreviewsTable.campaignVersion, campaign.version),
    eq(campaignAudiencePreviewsTable.requestedBy, user.id),
  )).limit(1);
  if (!preview || preview.contentHash !== contentHash) {
    res.status(409).json({ error: "Preview is missing, expired, or no longer matches campaign content" }); return;
  }
  if (!hasEligibleCampaignAudience(preview.counts)) {
    res.status(409).json({ error: "Campaign cannot be approved because the current preview has no eligible recipients" }); return;
  }
  const [updated] = await db.transaction(async (tx) => {
    const [claimed] = await tx.update(campaignsTable).set({ status: "approved", updatedAt: new Date() })
      .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.version, campaign.version), eq(campaignsTable.status, "draft"))).returning();
    if (!claimed) return [];
    await tx.insert(campaignApprovalsTable).values({
      campaignId, approvalType: body.data.approvalType, contentVersion: campaign.version,
      approvedBy: user.id, contentHash, previewId: preview.id, claimsAffirmed: true,
      snapshot: {
        campaign: { channel: campaign.channel, replyToEmail: campaign.replyToEmail ?? DEFAULT_REPLY_TO, audienceRules: campaign.audienceRules, smsBody: campaign.smsBody, flyer: content.flyer, flyerDeliveryMode: campaign.flyerDeliveryMode },
        template: content.emailTemplate, counts: preview.counts, recipients: preview.recipientsSnapshot,
      },
    });
    return [{ campaign: claimed }];
  });
  if (!updated?.campaign) { res.status(409).json({ error: "Campaign changed while approval was being recorded" }); return; }
  await audit(campaignId, user.id, "approved", campaign.status, "approved", { approvalType: body.data.approvalType, contentVersion: campaign.version });
  res.json(updated.campaign);
});

router.post("/campaigns/:id/test", async (req, res): Promise<void> => {
  const user = await requireCampaignManager(req, res);
  if (!user) return;
  const campaignId = parseId(req);
  if (!campaignId) { res.status(400).json({ error: "Invalid campaign id" }); return; }
  const campaign = await getCampaign(campaignId);
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }
  const body = z.object({ toEmail: z.string().trim().email() }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "A valid internal test email is required" }); return; }
  if (isSmsLaunchUnsupported(campaign.channel)) { res.status(422).json({ error: "Provider-free email validation requires an email-only campaign" }); return; }
  let content: Awaited<ReturnType<typeof campaignContent>>;
  try {
    content = await campaignContent(campaign);
  } catch {
    res.status(409).json({ error: "Campaign creative is unavailable for validation" }); return;
  }
  const variables = buildVariables({ email: body.data.toEmail }, null);
  const error = validateCampaignRender(content.emailTemplate, (value) => renderTemplate(value, variables));
  if (error) { res.status(409).json({ error }); return; }
  const preview = await audiencePreview(campaign);
  await audit(campaignId, user.id, "test_dry_run", campaign.status, campaign.status, { toEmail: body.data.toEmail });
  res.json(buildCampaignValidationResult({ toEmail: body.data.toEmail, eligibleCount: preview.counts.eligible }));
});

router.post("/campaigns/:id/launch", async (req, res): Promise<void> => {
  const user = await requireCampaignManager(req, res);
  if (!user) return;
  const campaignId = parseId(req);
  if (!campaignId) { res.status(400).json({ error: "Invalid campaign id" }); return; }
  const campaign = await getCampaign(campaignId);
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }
  const parsed = launchBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid launch" }); return; }
  const input = parsed.data;
  if (isFutureCampaignSchedule(input.scheduledAt)) {
    res.status(422).json({ error: "Scheduled campaigns are not delivered automatically — launch manually at send time." }); return;
  }
  const existing = await db.select().from(campaignLaunchesTable).where(eq(campaignLaunchesTable.idempotencyKey, input.idempotencyKey)).limit(1);
  let launch = existing[0];
  const resuming = Boolean(launch && launch.campaignId === campaignId &&
    ["queued", "running"].includes(launch.status));
  if (existing[0]) {
    if (existing[0].campaignId !== campaignId) {
      res.status(409).json({ error: "Idempotency key already belongs to another campaign" }); return;
    }
    if (!resuming || campaign.status !== "running" || input.mode === "dry_run") {
      res.status(200).json(existing[0]); return;
    }
  }
  const [priorLaunch] = await db.select({ id: campaignLaunchesTable.id })
    .from(campaignLaunchesTable).where(eq(campaignLaunchesTable.campaignId, campaignId)).limit(1);
  if (priorLaunch && !resuming) { res.status(409).json({ error: "Campaign already has a launch; use its original idempotency key" }); return; }
  if (!resuming && campaign.status !== "approved") { res.status(409).json({ error: "Only an approved campaign can be launched" }); return; }
  if (isSmsLaunchUnsupported(campaign.channel)) { res.status(422).json({ error: "SMS campaign launch is not supported yet; use email-only until SMS bulk infrastructure is enabled" }); return; }
  const approval = await db.select().from(campaignApprovalsTable).where(and(eq(campaignApprovalsTable.campaignId, campaignId), eq(campaignApprovalsTable.contentVersion, campaign.version))).orderBy(desc(campaignApprovalsTable.approvedAt)).limit(1);
  let resolvedFlyer: ResolvedCampaignFlyer | null;
  let currentHash: string;
  try {
    resolvedFlyer = await resolveCampaignFlyer(campaign.flyer);
    currentHash = campaignContentHash(await campaignContent(campaign));
  } catch (error) {
    const reason = error instanceof Error && error.message === "APPROVED_FLYER_CHANGED"
      ? "Campaign flyer changed after it was selected; save, preview, and approve again"
      : "Approved campaign flyer is unavailable";
    res.status(409).json({ error: reason }); return;
  }
  if (!hasCurrentApproval(approval[0], campaign.version, currentHash)) { res.status(409).json({ error: "Campaign requires approval for its current content and audience" }); return; }
  const approvalSnapshot = (approval[0]?.snapshot ?? {}) as any;
  const modeError = flyerModeError(flyerSchema.parse(campaign.flyer), campaign.flyerDeliveryMode);
  if (modeError) { res.status(409).json({ error: modeError }); return; }
  const approvedFlyer = approvalSnapshot?.campaign?.flyer;
  if (!approvedFlyerMatches(approvedFlyer, flyerSnapshot(resolvedFlyer))) {
    res.status(409).json({ error: "Campaign flyer no longer matches the approved creative" }); return;
  }
  const attachments = campaignFlyerAttachments(resolvedFlyer, campaign.flyerDeliveryMode);
  const snapshotRecipients = approvalSnapshot.recipients;
  const snapshotCounts = approvalSnapshot.counts;
  if (!Array.isArray(snapshotRecipients) || !snapshotCounts ||
      typeof snapshotCounts.eligible !== "number" || typeof snapshotCounts.excluded !== "number" ||
      snapshotRecipients.some((entry: any) => !entry || !Number.isInteger(entry.leadId) ||
        (entry.channel !== "email" && entry.channel !== "sms") ||
        (entry.reason == null && (typeof entry.target !== "string" || !entry.target)))) {
    res.status(409).json({ error: "Approved recipient snapshot is malformed; preview and approve again" }); return;
  }
  const snapshotEligible = snapshotRecipients.filter((entry: any) => entry.target);
  const snapshotExcluded = snapshotRecipients.filter((entry: any) => entry.reason != null);
  if (!hasEligibleCampaignAudience(snapshotCounts) || snapshotEligible.length <= 0) {
    res.status(409).json({ error: "Campaign cannot be launched because its approved audience has no eligible recipients" }); return;
  }
  const scheduled = false;
  const leaseToken = input.mode === "live" && !scheduled ? randomUUID() : null;
  const leaseExpiresAt = leaseToken ? new Date(Date.now() + 10 * 60 * 1000) : null;
  if (resuming) {
    const [acquired] = await db.update(campaignLaunchesTable).set({
      executionLeaseToken: leaseToken, executionLeaseExpiresAt: leaseExpiresAt,
    }).where(and(eq(campaignLaunchesTable.id, launch.id), eq(campaignLaunchesTable.status, "running"),
      eq(campaignLaunchesTable.campaignId, campaignId),
      or(isNull(campaignLaunchesTable.executionLeaseToken), lte(campaignLaunchesTable.executionLeaseExpiresAt, new Date())))).returning();
    if (!acquired) { res.status(200).json(launch); return; }
    launch = acquired;
  }
  try {
    if (resuming) {
      // Existing launch is resumed below; never recreate its ledger rows.
      if (!launch) throw new Error("RESUME_LAUNCH_MISSING");
    } else {
    [launch] = await db.transaction(async (tx) => {
      const [created] = await tx.insert(campaignLaunchesTable).values({
        campaignId, idempotencyKey: input.idempotencyKey, requestedBy: user.id, mode: input.mode,
        status: scheduled ? "scheduled" : (input.mode === "dry_run" ? "queued" : "running"),
        eligibleCount: snapshotCounts.eligible, excludedCount: snapshotCounts.excluded, scheduledAt: input.scheduledAt ?? null,
        ...(input.mode === "dry_run" ? {} : { startedAt: scheduled ? null : new Date(), executionLeaseToken: leaseToken, executionLeaseExpiresAt: leaseExpiresAt }),
      }).returning();
      if (input.mode !== "dry_run") {
        const targetStatus = scheduled ? "scheduled" : "running";
        const [claimed] = await tx.update(campaignsTable).set({
          status: targetStatus, ...(scheduled ? {} : { launchedAt: new Date() }), updatedAt: new Date(),
        }).where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.status, "approved"), eq(campaignsTable.version, campaign.version))).returning();
        if (!claimed) throw new Error("CAMPAIGN_CLAIM_FAILED");
      }
      await tx.insert(campaignRecipientsTable).values([
        ...snapshotEligible.map((entry: any) => ({ launchId: created.id, campaignId, leadId: entry.leadId, channel: entry.channel, status: "eligible" as const })),
        ...snapshotExcluded.map((entry: any) => ({ launchId: created.id, campaignId, leadId: entry.leadId, channel: entry.channel, status: "excluded" as const, exclusionReason: entry.reason })),
      ]);
      return [created];
    });
    }
  } catch (error: any) {
    // A concurrent retry can pass the read above and race on the unique key.
    // Return the winning launch rather than creating a second recipient snapshot.
    if (String(error?.code) === "23505") {
      const [winner] = await db.select().from(campaignLaunchesTable)
        .where(eq(campaignLaunchesTable.idempotencyKey, input.idempotencyKey)).limit(1);
      if (winner) { res.status(200).json(winner); return; }
    }
    if (error instanceof Error && error.message === "CAMPAIGN_CLAIM_FAILED") {
      res.status(409).json({ error: "Campaign could not be claimed for launch" }); return;
    }
    throw error;
  }
  if (scheduled || input.mode === "dry_run") {
    if (scheduled) {
      const nextStatus = campaignStatusAfterLaunch(campaign.status, scheduled);
      await db.update(campaignsTable).set({ scheduledAt: input.scheduledAt ?? null, updatedAt: new Date() })
        .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.status, "scheduled"), eq(campaignsTable.version, campaign.version)));
      await audit(campaignId, user.id, "scheduled", campaign.status, nextStatus, {
        launchId: launch.id,
        scheduledAt: input.scheduledAt?.toISOString(),
        mode: input.mode,
      });
    } else {
      await db.update(campaignsTable).set({ status: "approved", updatedAt: new Date() })
        .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.status, "running"), eq(campaignsTable.version, campaign.version)));
      await audit(campaignId, user.id, "dry_run_launched", campaign.status, campaign.status, { launchId: launch.id });
    }
    res.status(201).json({ launch, preview: { totalMatching: snapshotRecipients.length, eligible: snapshotEligible, exclusions: snapshotExcluded, counts: snapshotCounts } });
    return;
  }
  await db.update(campaignLaunchesTable).set({ status: "running", startedAt: new Date() }).where(eq(campaignLaunchesTable.id, launch.id));
  const template = approvalSnapshot.template;
  if (!template || !template.isActive) {
    const failure = campaignFailureState();
    await db.update(campaignLaunchesTable).set({ status: failure.launch, completedAt: new Date(), failedCount: snapshotCounts.eligible }).where(eq(campaignLaunchesTable.id, launch.id));
    await db.update(campaignsTable).set({ status: failure.campaign, completedAt: new Date(), updatedAt: new Date() }).where(eq(campaignsTable.id, campaignId));
    await audit(campaignId, user.id, "launch_failed", "running", "failed", { launchId: launch.id, reason: "missing_active_template" });
    res.status(409).json({ error: "Active email template is required before launch" });
    return;
  }
  let sent = 0;
  let failed = 0;
  for (const recipient of snapshotEligible) {
    const capacity = await getDailyMarketingEmailCapacity();
    if (capacity.remaining <= 0) {
      const availableAt = nextBusinessDay();
      await db.update(campaignRecipientsTable).set({ status: "deferred", availableAt })
        .where(and(eq(campaignRecipientsTable.launchId, launch.id), eq(campaignRecipientsTable.status, "eligible")));
      await db.update(campaignLaunchesTable).set({
        executionLeaseToken: null, executionLeaseExpiresAt: null,
      }).where(eq(campaignLaunchesTable.id, launch.id));
      res.status(200).json({ launch, sent, failed, deferred: snapshotEligible.length - sent - failed, availableAt, resume: "Manually relaunch with the same idempotency key on or after availableAt." });
      return;
    }
    const claimResult = await db.transaction(async (tx): Promise<{ outcome: "claimed" | "already_processed" | "lease_lost"; recipient?: typeof campaignRecipientsTable.$inferSelect }> => {
      const [heartbeat] = await tx.update(campaignLaunchesTable).set({
        executionLeaseExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      }).where(and(eq(campaignLaunchesTable.id, launch.id), eq(campaignLaunchesTable.status, "running"),
        eq(campaignLaunchesTable.executionLeaseToken, leaseToken!))).returning({ id: campaignLaunchesTable.id });
      if (!heartbeat) return { outcome: "lease_lost" };
      const [state] = await tx.select({ status: campaignsTable.status }).from(campaignsTable)
        .where(eq(campaignsTable.id, campaignId)).limit(1);
      if (!state || state.status !== "running") return { outcome: "lease_lost" };
      const [claimed] = await tx.update(campaignRecipientsTable).set({ status: "queued" })
        .where(and(eq(campaignRecipientsTable.launchId, launch.id), eq(campaignRecipientsTable.leadId, recipient.leadId),
          eq(campaignRecipientsTable.channel, recipient.channel), inArray(campaignRecipientsTable.status, ["eligible", "deferred"]),
          or(isNull(campaignRecipientsTable.availableAt), lte(campaignRecipientsTable.availableAt, new Date())))).returning();
      if (claimed) return { outcome: "claimed", recipient: claimed };
      const [existingRecipient] = await tx.select({ status: campaignRecipientsTable.status, availableAt: campaignRecipientsTable.availableAt })
        .from(campaignRecipientsTable).where(and(eq(campaignRecipientsTable.launchId, launch.id),
          eq(campaignRecipientsTable.leadId, recipient.leadId), eq(campaignRecipientsTable.channel, recipient.channel))).limit(1);
      return existingRecipient && (existingRecipient.status !== "eligible" || existingRecipient.availableAt)
        ? { outcome: "already_processed" } : { outcome: "lease_lost" };
    });
    if (claimResult.outcome === "lease_lost") {
      const [latest] = await db.select().from(campaignLaunchesTable).where(eq(campaignLaunchesTable.id, launch.id)).limit(1);
      res.status(200).json({ launch: latest ?? launch, sent, failed }); return;
    }
    if (claimResult.outcome === "already_processed") continue;
    const claimedRecipient = claimResult.recipient!;
    const [beforeSend] = await db.select({ launchStatus: campaignLaunchesTable.status, campaignStatus: campaignsTable.status })
      .from(campaignLaunchesTable).innerJoin(campaignsTable, eq(campaignLaunchesTable.campaignId, campaignsTable.id))
      .where(eq(campaignLaunchesTable.id, launch.id)).limit(1);
    if (!beforeSend || beforeSend.launchStatus !== "running" || beforeSend.campaignStatus !== "running") {
      // Leave queued when ownership/state was lost; it is uncertain and must
      // never be retried by a takeover.
      break;
    }
    const lead = (await db.select().from(leadsTable).where(eq(leadsTable.id, recipient.leadId)).limit(1))[0];
    const target = recipient.target as string;
    const currentEmail = lead?.email?.trim().toLowerCase();
    const invalidEmail = !currentEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(currentEmail) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target);
    const emailChanged = !invalidEmail && currentEmail !== target.toLowerCase();
    if (invalidEmail || emailChanged || lead?.isUnsubscribed || await isEmailSuppressed(target)) {
      failed++;
      const reason = invalidEmail ? "invalid_email" : emailChanged ? "email_changed" :
        lead?.isUnsubscribed ? "unsubscribed" : "email_suppressed";
      const reconciled = await reconcileCampaignRecipient({ launchId: launch.id, campaignId, recipientId: claimedRecipient.id, leaseToken: leaseToken!, status: "excluded", reason });
      if (!reconciled) break;
      continue;
    }
    const rep = lead.assignedRepId ? (await db.select().from(usersTable).where(eq(usersTable.id, lead.assignedRepId)).limit(1))[0] : null;
    const vars = buildVariables(lead, rep);
    // Campaign copy should address an unknown first name naturally.
    if (!vars.lead_first_name.trim()) vars.lead_first_name = "there";
    const [company] = await db.select({ industry: companiesTable.industry }).from(companiesTable)
      .where(eq(companiesTable.leadId, lead.id)).limit(1);
    vars.first_name = lead.firstName?.trim() || "";
    vars.company = lead.companyName?.trim() || "";
    vars.vertical = vendorVertical(lead.vertical, company?.industry);
    vars.flyer_link = campaignFlyerLinkMarker();
    const linkUrl = campaign.flyerDeliveryMode === "link" && resolvedFlyer?.source === "library"
      ? buildSignedCampaignFlyerUrl({
        templateId: resolvedFlyer.templateId!, objectPath: resolvedFlyer.objectPath!,
        digest: resolvedFlyer.digest, generation: resolvedFlyer.generation,
        name: resolvedFlyer.name, contentType: resolvedFlyer.contentType as "image/png" | "application/pdf",
      }, 7 * 24 * 60 * 60)
      : null;
    const renderedBody = renderTemplate(template.bodyHtml, vars);
    const { bodyText, bodyHtml } = renderCampaignFlyerLink(renderedBody, linkUrl);
    const withoutAttachment = !resolvedFlyer;
    let result;
    try {
       result = await doSendEmail({
      leadId: lead.id, userId: user.id, templateId: template.id,
      subject: renderTemplate(template.subject, vars),
      bodyHtml,
      bodyText,
      toEmail: target, baseUrl: getPublicBaseUrl(), senderMode: template.senderMode as "default" | "assigned_rep",
      deliveryKind: "bulk", campaignId, campaignLaunchId: launch.id, rep: rep ?? undefined,
        replyToEmail: campaign.replyToEmail ?? DEFAULT_REPLY_TO,
       attachments,
        minimalNoImages: withoutAttachment,
      });
    } catch (error) {
      failed++;
      const reconciled = await reconcileCampaignRecipient({ launchId: launch.id, campaignId, recipientId: claimedRecipient.id, leaseToken: leaseToken!, status: "failed", reason: error instanceof Error ? error.message : "send_failed" });
      if (!reconciled) break;
      continue;
    }
    if (result.send && !result.error) {
      sent++;
      const reconciled = await reconcileCampaignRecipient({ launchId: launch.id, campaignId, recipientId: claimedRecipient.id, leaseToken: leaseToken!, status: "sent", emailSendId: result.send.id });
      if (!reconciled) break;
    } else {
      if (result.error?.toLowerCase().includes("daily") && result.error.toLowerCase().includes("allowance")) {
        const availableAt = nextBusinessDay();
        await db.update(campaignRecipientsTable).set({ status: "deferred", availableAt })
          .where(eq(campaignRecipientsTable.id, claimedRecipient.id));
        await db.update(campaignRecipientsTable).set({ status: "deferred", availableAt })
          .where(and(eq(campaignRecipientsTable.launchId, launch.id), eq(campaignRecipientsTable.status, "eligible")));
        await db.update(campaignLaunchesTable).set({ executionLeaseToken: null, executionLeaseExpiresAt: null })
          .where(eq(campaignLaunchesTable.id, launch.id));
        res.status(200).json({ launch, sent, failed, deferred: true, availableAt, resume: "Manually relaunch with the same idempotency key on or after availableAt." });
        return;
      }
      failed++;
      const reconciled = await reconcileCampaignRecipient({ launchId: launch.id, campaignId, recipientId: claimedRecipient.id, leaseToken: leaseToken!, status: "failed", reason: result.error ?? "send_failed" });
      if (!reconciled) break;
    }
  }
  const [deferred] = await db.select({ availableAt: campaignRecipientsTable.availableAt })
    .from(campaignRecipientsTable)
    .where(and(eq(campaignRecipientsTable.launchId, launch.id), eq(campaignRecipientsTable.status, "deferred"), isNotNull(campaignRecipientsTable.availableAt)))
    .orderBy(asc(campaignRecipientsTable.availableAt)).limit(1);
  if (deferred?.availableAt && deferred.availableAt > new Date()) {
    await db.update(campaignLaunchesTable).set({ executionLeaseToken: null, executionLeaseExpiresAt: null })
      .where(eq(campaignLaunchesTable.id, launch.id));
    res.status(200).json({ launch, sent, failed, deferred: true, availableAt: deferred.availableAt, resume: "Manually relaunch with the same idempotency key on or after availableAt." });
    return;
  }
  const ledger = await db.select({
    status: campaignRecipientsTable.status,
    exclusionReason: campaignRecipientsTable.exclusionReason,
  }).from(campaignRecipientsTable).where(eq(campaignRecipientsTable.launchId, launch.id));
  const cumulativeSent = ledger.filter((row) => row.status === "sent").length;
  const cumulativeEligible = ledger.filter((row) => row.status === "eligible").length;
  const uncertain = ledger.filter((row) => row.status === "queued").length;
  const cumulativeFailed = ledger.filter((row) => row.status === "failed" ||
    (row.status === "excluded" && ["unsubscribed", "email_suppressed", "invalid_email", "email_changed"].includes(row.exclusionReason ?? ""))).length;
  const [currentLaunch] = await db.select().from(campaignLaunchesTable).where(eq(campaignLaunchesTable.id, launch.id)).limit(1);
  const finalStatus = uncertain > 0 || cumulativeEligible > 0 || (cumulativeFailed > 0 && cumulativeSent === 0) ? "failed" : "completed";
  const [completed] = await db.update(campaignLaunchesTable)
    .set({ status: finalStatus, sentCount: cumulativeSent, failedCount: cumulativeFailed, completedAt: new Date(), executionLeaseToken: null, executionLeaseExpiresAt: null })
    .where(and(eq(campaignLaunchesTable.id, launch.id), eq(campaignLaunchesTable.status, "running"), eq(campaignLaunchesTable.executionLeaseToken, leaseToken!)))
    .returning();
  if (!completed) {
    const [latest] = await db.select().from(campaignLaunchesTable).where(eq(campaignLaunchesTable.id, launch.id)).limit(1);
    res.status(200).json({ launch: latest ?? currentLaunch, sent: cumulativeSent, failed: cumulativeFailed });
    return;
  }
  await db.update(campaignsTable).set({ status: finalStatus, completedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.status, "running")));
  const finalLaunch = completed ?? currentLaunch;
  await audit(campaignId, user.id, "launched", "running", finalStatus, { launchId: launch.id, sent: cumulativeSent, failed: cumulativeFailed });
  res.status(201).json({ launch: finalLaunch, sent: cumulativeSent, failed: cumulativeFailed });
});

async function transition(req: Request, res: Response, target: "paused" | "cancelled"): Promise<void> {
  const user = await requireCampaignManager(req, res);
  if (!user) return;
  const campaignId = parseId(req);
  if (!campaignId) { res.status(400).json({ error: "Invalid campaign id" }); return; }
  const campaign = await getCampaign(campaignId);
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }
  if (!canTransitionCampaign(campaign.status, target)) { res.status(409).json({ error: "Campaign cannot be transitioned from its current state" }); return; }
  const [updated] = await db.update(campaignsTable).set({ status: target, updatedAt: new Date() })
    .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.status, campaign.status))).returning();
  if (!updated) { res.status(409).json({ error: "Campaign changed while transitioning" }); return; }
  await db.update(campaignLaunchesTable).set({ status: target, executionLeaseToken: null, executionLeaseExpiresAt: null }).where(and(eq(campaignLaunchesTable.campaignId, campaignId), inArray(campaignLaunchesTable.status, ["queued", "scheduled", "running"])));
  await audit(campaignId, user.id, target, campaign.status, target);
  res.json(updated);
}

router.post("/campaigns/:id/pause", (req, res) => { void transition(req, res, "paused"); });
router.post("/campaigns/:id/cancel", (req, res) => { void transition(req, res, "cancelled"); });

router.get("/campaigns/:id/results", async (req, res): Promise<void> => {
  const user = await requireCampaignManager(req, res);
  if (!user) return;
  const campaignId = parseId(req);
  if (!campaignId) { res.status(400).json({ error: "Invalid campaign id" }); return; }
  const launches = await db.select().from(campaignLaunchesTable).where(eq(campaignLaunchesTable.campaignId, campaignId)).orderBy(desc(campaignLaunchesTable.createdAt));
  const recipients = await db.select().from(campaignRecipientsTable).where(eq(campaignRecipientsTable.campaignId, campaignId));
  const deferred = recipients.filter((row) => row.status === "deferred");
  const nextAvailableAt = deferred.map((row) => row.availableAt).filter((value): value is Date => Boolean(value))
    .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  res.json({ launches, counts: {
    eligible: recipients.filter((row) => row.status !== "excluded").length,
    excluded: recipients.filter((row) => row.status === "excluded").length,
    sent: recipients.filter((row) => row.status === "sent").length,
    failed: recipients.filter((row) => row.status === "failed").length,
    deferred: deferred.length,
    nextAvailableAt,
  }});
});

export default router;