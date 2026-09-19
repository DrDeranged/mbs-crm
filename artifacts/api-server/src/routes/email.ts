import { Router, type Request, type Response } from "express";
import sgMail from "@sendgrid/mail";
import { createHmac } from "crypto";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import {
  emailTemplatesTable,
  emailSendsTable,
  leadsTable,
  usersTable,
  dripSequencesTable,
  dripSequenceStepsTable,
  companySettingsTable,
  activityLogTable,
} from "@workspace/db";
import { eq, and, inArray, gte, sql } from "drizzle-orm";
import {
  canManageMarketingResource,
  canReadMarketingResource,
  requireUser,
} from "../lib/authHelpers";
import { logActivity } from "../lib/activityHelper";
import { ensureBrandEmailHeader, getBrandLogoPng, getPublicBaseUrl } from "../lib/brand";
import { isEmailSuppressed, normalizeEmail, suppressEmail } from "../lib/emailSafety";
import { reserveEmailRateSlot, EMAIL_RATE_RETRY_MS } from "../lib/emailRateLimiter";
import { seedStarterEmailData } from "../lib/productionMaintenance";
import { logger } from "../lib/logger";

const UNSUB_SECRET = process.env["UNSUB_SECRET"];
const SESSION_SECRET = process.env["SESSION_SECRET"];
// A dedicated key is preferred, but deployments that already protect sessions
// need not provision a second secret. Domains below prevent cross-purpose
// token reuse.
const EMAIL_SIGNING_SECRET = UNSUB_SECRET || SESSION_SECRET;
const IS_PROD_EMAIL = process.env["NODE_ENV"] === "production";
const positiveId = z.coerce.number().int().positive();
const templateBody = z.object({
  name: z.string().trim().min(1),
  subject: z.string().trim().min(1),
  bodyHtml: z.string().trim().min(1),
  programType: z.enum(["equipment", "working_capital"]).nullable().optional(),
  senderMode: z.enum(["default", "assigned_rep"]).optional(),
  isActive: z.boolean().optional(),
});
const templateUpdateBody = templateBody.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: "At least one template field is required" },
);
const singleEmailBody = z.object({
  leadId: positiveId,
  templateId: positiveId.optional(),
  subject: z.string().optional(),
  bodyHtml: z.string().optional(),
});
const bulkEmailBody = z.object({
  leadIds: z.array(positiveId).min(1),
  templateId: positiveId,
});
const previewTemplateBody = z.object({ leadId: positiveId.optional() });
const testSendBody = z.object({
  templateId: positiveId.optional(),
  toEmail: z.string().trim().email(),
});

function invalidInput(res: Response, parsed: z.ZodSafeParseError<unknown>): void {
  const field = parsed.error.issues[0]?.path.join(".") || "body";
  res.status(400).json({ error: `Invalid ${field}` });
}

function makeUnsubToken(sendId: number, email: string): string {
  if (!EMAIL_SIGNING_SECRET) {
    if (IS_PROD_EMAIL) throw new Error("UNSUB_SECRET or SESSION_SECRET must be set in production");
    return createHmac("sha256", "dev-only-not-for-prod").update(`mbs-email-unsubscribe:v1:${sendId}:${normalizeEmail(email)}`).digest("hex");
  }
  return createHmac("sha256", EMAIL_SIGNING_SECRET)
    .update(`mbs-email-unsubscribe:v1:${sendId}:${normalizeEmail(email)}`)
    .digest("hex");
}

function verifyUnsubToken(sendId: number, email: string, token: string): boolean {
  if (!EMAIL_SIGNING_SECRET && IS_PROD_EMAIL) return false;
  try {
    const expected = makeUnsubToken(sendId, normalizeEmail(email));
    // Constant-time compare using timingSafeEqual
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(token, "hex");
    if (a.length !== b.length) return false;
    return require("crypto").timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function makeTrackingToken(sendId: number, kind: "open" | "click", destination = ""): string {
  const payload = `mbs-email-tracking:${kind}:v1:${sendId}:${destination}`;
  if (!EMAIL_SIGNING_SECRET) {
    if (IS_PROD_EMAIL) throw new Error("UNSUB_SECRET or SESSION_SECRET must be set in production");
    return createHmac("sha256", "dev-only-not-for-prod")
      .update(payload)
      .digest("hex");
  }
  return createHmac("sha256", EMAIL_SIGNING_SECRET)
    .update(payload)
    .digest("hex");
}

function verifyTrackingToken(sendId: number, kind: "open" | "click", destination: string, token: string): boolean {
  if (!token || (!EMAIL_SIGNING_SECRET && IS_PROD_EMAIL)) return false;
  try {
    const expected = makeTrackingToken(sendId, kind, destination);
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(token, "hex");
    if (a.length !== b.length) return false;
    return require("crypto").timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

const STATUS_RANK: Record<string, number> = {
  queued: 0,
  failed: 1,
  sent: 2,
  delivered: 3,
  opened: 4,
  clicked: 5,
  bounced: 100,
  unsubscribed: 100,
};

function canAdvanceStatus(current: string, next: string): boolean {
  if (current === next) return true;
  // Delivery failures and suppressions are terminal and must not be replaced
  // by a late provider open/click callback.
  if (current === "bounced" || current === "unsubscribed" || current === "failed") return false;
  return (STATUS_RANK[next] ?? 0) > (STATUS_RANK[current] ?? 0);
}

async function logEmailEngagementOnce(send: any, action: "email_opened" | "email_clicked", details: Record<string, unknown>) {
  if (!send.leadId) return;
  const existing = await db.query.activityLogTable.findFirst({
    where: and(
      eq(activityLogTable.action, action),
      eq(activityLogTable.entityType, "email_send"),
      eq(activityLogTable.entityId, String(send.id)),
    ),
  });
  if (existing) return;
  await logActivity({
    userId: send.userId,
    leadId: send.leadId,
    action,
    entityType: "email_send",
    entityId: send.id,
    details: { subject: send.subject, ...details },
  });
}

const router = Router();

const SENDGRID_API_KEY = process.env["SENDGRID_API_KEY"];
const FROM_EMAIL = "funding@my-business-solutions.com";
const FROM_NAME = "My Business Solutions";
const VALID_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const EMAIL_COMPLIANCE_ADDRESS =
  "My Business Solutions LLC · 617 Palisade Ave Unit 2, Jersey City, NJ 07307";
export const DAILY_MARKETING_KINDS = ["bulk", "drip"] as const;

if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

// 1×1 transparent GIF bytes
const TRACKING_PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SAMPLE_VARS: Record<string, string> = {
  lead_first_name: "Jane",
  lead_last_name: "Smith",
  lead_company: "Acme Corp",
  lead_email: "jane@acme.com",
  lead_phone: "+15551234567",
  rep_name: "Your Rep",
  rep_phone: "+15559876543",
  rep_email: "rep@company.com",
};

function buildVariables(lead: any, rep: any, extras: Record<string, unknown> = {}): Record<string, string> {
  return {
    lead_first_name: lead?.firstName || "",
    lead_last_name: lead?.lastName || "",
    lead_company: lead?.companyName || "",
    lead_email: lead?.email || "",
    lead_phone: lead?.phone || "",
    rep_name: rep?.name || "",
    rep_phone: rep?.mobileNumber || "",
    rep_email: rep?.email || "",
    ...Object.fromEntries(Object.entries(extras).map(([key, value]) => [key, String(value ?? "")])),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (key === "brand_email_header") return "__MBS_BRAND_EMAIL_HEADER__";
    const raw = vars[key];
    return raw == null ? "" : escapeHtml(String(raw));
  });
}

function injectTracking(bodyHtml: string, sendId: number, baseUrl: string, toEmail: string): string {
  // Wrap hrefs in click-tracking redirect
  const withClicks = bodyHtml.replace(
    /href="([^"#][^"]*)"/gi,
    (_, url) => {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return `href="#"`;
      }
      if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) {
        return `href="#"`;
      }
      const destination = parsed.toString();
      const encoded = encodeURIComponent(destination);
      const token = makeTrackingToken(sendId, "click", destination);
      return `href="${baseUrl}/api/email/track/click/${sendId}?url=${encoded}&token=${token}"`;
    }
  );
  // Signed unsubscribe link — token is HMAC-SHA256(secret, sendId:email)
  const token = makeUnsubToken(sendId, toEmail);
  const openToken = makeTrackingToken(sendId, "open");
  const pixel = `<img src="${baseUrl}/api/email/track/open/${sendId}?token=${openToken}" width="1" height="1" alt="" style="display:none" />`;
  const unsubLink = `<p style="font-size:11px;color:#999;margin-top:24px;text-align:center">
    <a href="${baseUrl}/api/email/unsubscribe?id=${sendId}&email=${encodeURIComponent(toEmail)}&token=${token}" style="color:#999">Unsubscribe</a>
    <br><span>${EMAIL_COMPLIANCE_ADDRESS}</span>
  </p>`;
  return `${withClicks}${unsubLink}${pixel}`;
}

function startOfUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function getDailyMarketingEmailCapacity(): Promise<{
  limit: number;
  used: number;
  remaining: number;
}> {
  const [settings] = await db.select({
    bulkEmailPerDay: companySettingsTable.bulkEmailPerDay,
  }).from(companySettingsTable).limit(1);
  const limit = Math.max(1, Math.min(100_000, settings?.bulkEmailPerDay ?? 75));
  const [row] = await db.select({ count: sql<number>`count(*)` })
    .from(emailSendsTable)
    .where(and(
      inArray(emailSendsTable.deliveryKind, DAILY_MARKETING_KINDS),
      gte(emailSendsTable.createdAt, startOfUtcDay()),
    ));
  const used = Number(row?.count ?? 0);
  return { limit, used, remaining: Math.max(0, limit - used) };
}

export type DailyMarketingReservationRepository<Context, Created> = {
  withLock: <T>(work: (context: Context) => Promise<T>) => Promise<T>;
  getLimit: (context: Context) => Promise<number>;
  getUsed: (context: Context) => Promise<number>;
  create: (context: Context) => Promise<Created>;
};

/** Shared bulk/drip reservation boundary; the repository owns its transaction lock. */
export async function reserveDailyMarketingEmail<Context, Created>(
  repository: DailyMarketingReservationRepository<Context, Created>,
): Promise<Created | null> {
  return repository.withLock(async (context) => {
    const limit = Math.max(1, Math.min(100_000, await repository.getLimit(context)));
    if (await repository.getUsed(context) >= limit) return null;
    return repository.create(context);
  });
}

/** The single provider dispatch sink for all outbound HTML email. */
export async function sendTrackedEmailToProvider({
  provider,
  from,
  replyTo,
  toEmail,
  ccEmail,
  subject,
  bodyHtml,
  sendId,
  baseUrl,
  attachments,
}: {
  provider: Pick<typeof sgMail, "send">;
  from: { email: string; name: string };
  replyTo?: { email: string; name: string };
  toEmail: string;
  ccEmail?: string | null;
  subject: string;
  bodyHtml: string;
  sendId: number;
  baseUrl: string;
  attachments?: Array<{
    content: string;
    filename: string;
    type?: string;
    disposition?: "attachment" | "inline";
  }>;
}) {
  const html = injectTracking(bodyHtml, sendId, baseUrl, toEmail);
  return provider.send({
    from,
    ...(replyTo ? { replyTo } : {}),
    to: toEmail,
    ...(ccEmail && VALID_EMAIL.test(ccEmail.trim()) ? { cc: ccEmail.trim() } : {}),
    subject,
    html,
    ...(attachments?.length ? { attachments } : {}),
    trackingSettings: {
      clickTracking: { enable: false, enableText: false },
      openTracking: { enable: false },
    },
  });
}

async function doSendEmail(params: {
  leadId: number | null;
  userId: number | null;
  templateId: number | null;
  subject: string;
  bodyHtml: string;
  toEmail: string;
  baseUrl: string;
  senderMode?: "default" | "assigned_rep";
  deliveryKind?: "direct" | "bulk" | "drip" | "test";
  rep?: { name?: string | null; email?: string | null } | null;
  ccEmail?: string | null;
  attachments?: Array<{
    content: string;
    filename: string;
    type?: string;
    disposition?: "attachment" | "inline";
  }>;
}): Promise<{ send: any; error?: string; configurationReason?: string; deliveryOutcome?: "definite_failure" | "uncertain" }> {
  const [emailSettings] = await db.select({
    emailSendingEnabled: companySettingsTable.emailSendingEnabled,
  }).from(companySettingsTable).limit(1);
  const emailSendingEnabled = emailSettings?.emailSendingEnabled ?? false;
  const repEmail = params.rep?.email?.trim() || "";
  const from = {
    email: FROM_EMAIL,
    name: FROM_NAME,
  };
  const replyTo = VALID_EMAIL.test(repEmail)
    ? { email: repEmail, name: params.rep?.name?.trim() || repEmail }
    : undefined;

  const deliveryKind = params.deliveryKind ?? "direct";
  const values = {
    leadId: params.leadId,
    userId: params.userId,
    templateId: params.templateId,
    subject: params.subject,
    toEmail: params.toEmail,
    fromEmail: from.email,
    deliveryKind,
    status: "queued" as const,
  };
  // The count and queued record are created under one cross-process advisory
  // lock. A failed provider attempt remains counted: otherwise a retry loop
  // could bypass the daily safety cap.
  const placeholder = DAILY_MARKETING_KINDS.includes(deliveryKind as typeof DAILY_MARKETING_KINDS[number])
    ? await reserveDailyMarketingEmail<any, any>({
      withLock: (work) => db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('mbs-email-daily-marketing-cap'))`);
        return work(tx);
      }),
      getLimit: async (tx) => {
        const [settings] = await tx.select({
          bulkEmailPerDay: companySettingsTable.bulkEmailPerDay,
        }).from(companySettingsTable).limit(1);
        return settings?.bulkEmailPerDay ?? 75;
      },
      getUsed: async (tx) => {
        const [row] = await tx.select({ count: sql<number>`count(*)` })
          .from(emailSendsTable)
          .where(and(
            inArray(emailSendsTable.deliveryKind, DAILY_MARKETING_KINDS),
            gte(emailSendsTable.createdAt, startOfUtcDay()),
          ));
        return Number(row?.count ?? 0);
      },
      create: async (tx) => {
        const [created] = await tx.insert(emailSendsTable).values(values).returning();
        return created;
      },
    })
    : (await db.insert(emailSendsTable).values(values).returning())[0];
  if (!placeholder) {
    return {
      send: null,
      error: "Daily bulk and drip email allowance has been reached",
      deliveryOutcome: "definite_failure",
    };
  }

  if (await isEmailSuppressed(params.toEmail)) {
    const reason = "Recipient is suppressed";
    const [failed] = await db.update(emailSendsTable)
      .set({ status: "unsubscribed", failureReason: reason, updatedAt: new Date() })
      .where(eq(emailSendsTable.id, placeholder.id))
      .returning();
    return { send: failed, error: reason, deliveryOutcome: "definite_failure" };
  }

  // Delivery is an explicit database-backed opt-in.  Persist a failed
  // attempt so callers and audit views never confuse a blocked send with a
  // delivered message.
  if (!emailSendingEnabled) {
    const reason = "Email sending is disabled in Settings";
    const [failed] = await db.update(emailSendsTable)
      .set({ status: "failed", failureReason: reason, updatedAt: new Date() })
      .where(eq(emailSendsTable.id, placeholder.id))
      .returning();
    return { send: failed, error: reason, deliveryOutcome: "definite_failure" };
  }

  let brandedHtml: string;
  try {
    brandedHtml = ensureBrandEmailHeader(params.bodyHtml, params.baseUrl);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unable to secure email tracking links";
    const [failed] = await db.update(emailSendsTable)
      .set({ status: "failed", failureReason: reason, updatedAt: new Date() })
      .where(eq(emailSendsTable.id, placeholder.id))
      .returning();
    return { send: failed, error: reason, deliveryOutcome: "definite_failure" };
  }

  if (!SENDGRID_API_KEY) {
    const reason = "SENDGRID_API_KEY is not configured; email was not sent";
    const [failed] = await db.update(emailSendsTable)
      .set({ status: "failed", failureReason: reason, updatedAt: new Date() })
      .where(eq(emailSendsTable.id, placeholder.id))
      .returning();
    return {
      send: failed,
      error: reason,
      configurationReason: "missing:SENDGRID_API_KEY",
      deliveryOutcome: "definite_failure",
    };
  }

  try {
    const [response] = await sendTrackedEmailToProvider({
      provider: sgMail,
      from,
      replyTo,
      toEmail: params.toEmail,
      ccEmail: params.ccEmail,
      subject: params.subject,
      bodyHtml: brandedHtml,
      sendId: placeholder.id,
      baseUrl: params.baseUrl,
      attachments: params.attachments,
    });

    const messageId = (
      response.headers?.["x-message-id"] ||
      response.headers?.["X-Message-Id"] ||
      (response as any).body?.["message_id"] ||
      null
    ) as string | null;

    const [updated] = await db.update(emailSendsTable)
      .set({
        status: "sent",
        sendgridMessageId: messageId,
        sentAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(emailSendsTable.id, placeholder.id))
      .returning();

    return { send: updated };
  } catch (err: any) {
    await db.update(emailSendsTable)
      .set({ status: "failed", failureReason: err?.message || "Send failed", updatedAt: new Date() })
      .where(eq(emailSendsTable.id, placeholder.id));
    // SendGrid may time out after accepting the message. Only a confirmed
    // provider 4xx rejection is safe to classify as retryable.
    const statusCode = Number(err?.response?.statusCode ?? err?.code);
    return {
      send: placeholder,
      error: err?.message || "Send failed",
      deliveryOutcome: Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 500
        ? "definite_failure"
        : "uncertain",
    };
  }
}

// --- Open tracking pixel (no auth) ---
router.get("/email/track/open/:sendId", async (req, res) => {
  const sendId = parseInt(req.params["sendId"] as string, 10);
  const token = (req.query["token"] as string) || "";
  if (isNaN(sendId) || !verifyTrackingToken(sendId, "open", "", token)) {
    return void res.status(404).send(TRACKING_PIXEL);
  }
  if (!isNaN(sendId)) {
    const existing = await db.query.emailSendsTable.findFirst({ where: eq(emailSendsTable.id, sendId) });
    if (existing && existing.status !== "bounced" && existing.status !== "unsubscribed" && existing.status !== "failed" && !existing.openedAt) {
      const [markedOpen] = await db.update(emailSendsTable)
        .set({ status: canAdvanceStatus(existing.status, "opened") ? "opened" : existing.status, openedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(emailSendsTable.id, sendId), eq(emailSendsTable.status, existing.status)))
        .returning({ id: emailSendsTable.id });
      if (existing.leadId && !existing.openedAt && markedOpen) {
        await logEmailEngagementOnce(existing, "email_opened", {});
      }
    }
  }
  res.set("Content-Type", "image/gif").set("Cache-Control", "no-store").send(TRACKING_PIXEL);
});

// Public and cacheable so it can be resolved by email clients and Puppeteer.
router.get("/brand/logo.png", (_req, res) => {
  res
    .type("png")
    .set("Cache-Control", "public, max-age=604800, immutable")
    .send(getBrandLogoPng());
});

// --- Click tracking redirect (no auth) ---
router.get("/email/track/click/:sendId", async (req, res) => {
  const sendId = parseInt(req.params["sendId"] as string, 10);
  const rawUrl = (req.query["url"] as string) || "";
  const token = (req.query["token"] as string) || "";
  // Only allow absolute http/https URLs — reject open redirects to other schemes
  let url = "/";
  try {
    const parsed = new URL(rawUrl);
    if ((parsed.protocol === "http:" || parsed.protocol === "https:") && !parsed.username && !parsed.password) {
      url = parsed.toString();
    }
  } catch {
    // Not a valid URL — fall back to root
  }
  if (!isNaN(sendId) && url !== "/" && verifyTrackingToken(sendId, "click", url, token)) {
    const existing = await db.query.emailSendsTable.findFirst({ where: eq(emailSendsTable.id, sendId) });
    if (existing) {
      const shouldRecord = existing.status !== "bounced" && existing.status !== "unsubscribed" &&
        existing.status !== "failed" && !existing.clickedAt;
      if (shouldRecord) {
        const [markedClick] = await db.update(emailSendsTable)
          .set({ status: "clicked", clickedAt: existing.clickedAt ?? new Date(), updatedAt: new Date() })
          .where(and(eq(emailSendsTable.id, sendId), eq(emailSendsTable.status, existing.status)))
          .returning({ id: emailSendsTable.id });
        if (!markedClick) {
          res.redirect(302, url);
          return;
        }
      }
      if (existing.leadId && shouldRecord) {
        await logEmailEngagementOnce(existing, "email_clicked", { url });
      }
    }
  }
  res.redirect(302, url);
});

// --- Unsubscribe (no auth, but HMAC-signed token required) ---
router.get("/email/unsubscribe", async (req, res) => {
  const sendIdStr = req.query["id"] as string;
  const email = req.query["email"] as string;
  const token = req.query["token"] as string;

  const sendId = parseInt(sendIdStr, 10);

  if (!email || !token || isNaN(sendId)) {
    return void res.status(400).send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px">
      <h2>Invalid unsubscribe link</h2>
      <p>This link appears to be malformed or expired. Please contact support.</p>
    </body></html>`);
  }

  if (!verifyUnsubToken(sendId, email, token)) {
    return void res.status(403).send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px">
      <h2>Invalid unsubscribe link</h2>
      <p>This unsubscribe link is invalid or has been tampered with.</p>
    </body></html>`);
  }

  // Bind to the persisted send record — verify sendId and email match
  const sendRecord = await db.query.emailSendsTable.findFirst({ where: eq(emailSendsTable.id, sendId) });
  if (!sendRecord || normalizeEmail(sendRecord.toEmail) !== normalizeEmail(email)) {
    return void res.status(403).send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px">
      <h2>Invalid unsubscribe link</h2>
      <p>This unsubscribe link is invalid.</p>
    </body></html>`);
  }

  // Unsubscribe by leadId (bound to the specific send record, not email string alone)
  await suppressEmail(sendRecord.toEmail);
  if (canAdvanceStatus(sendRecord.status, "unsubscribed")) {
    await db.update(emailSendsTable)
      .set({ status: "unsubscribed", updatedAt: new Date() })
      .where(and(eq(emailSendsTable.id, sendRecord.id), eq(emailSendsTable.status, sendRecord.status)));
  }

  res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px">
    <h2>You've been unsubscribed</h2>
    <p>You will no longer receive marketing emails from MBS.</p>
  </body></html>`);
});

// --- Send single email ---
router.post("/email/send", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const body = singleEmailBody.safeParse(req.body);
  if (!body.success) return invalidInput(res, body);
  const { leadId, templateId, subject, bodyHtml } = body.data;

  const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, leadId) });
  if (!lead) return void res.status(404).json({ error: "Lead not found" });
  if (user.role === "rep" && lead.assignedRepId !== user.id) return void res.status(403).json({ error: "Forbidden" });
  if (!lead.email) return void res.status(400).json({ error: "Lead has no email address" });
  if (lead.isUnsubscribed || await isEmailSuppressed(lead.email)) {
    return void res.status(409).json({ error: "Recipient is suppressed" });
  }

  const rep = lead.assignedRepId
    ? await db.query.usersTable.findFirst({ where: eq(usersTable.id, lead.assignedRepId) })
    : await db.query.usersTable.findFirst({ where: eq(usersTable.id, user.id) });
  const vars = buildVariables(lead, rep);

  let finalSubject = subject || "";
  let finalBody = bodyHtml || "";
  let senderMode: "default" | "assigned_rep" = "default";

  if (templateId) {
    const template = await db.query.emailTemplatesTable.findFirst({
      where: eq(emailTemplatesTable.id, templateId),
      with: { owner: true },
    });
    if (!template) return void res.status(404).json({ error: "Template not found" });
    if (!canReadMarketingResource(user, template.owner)) {
      return void res.status(403).json({ error: "Forbidden" });
    }
    if (!template.isActive) return void res.status(409).json({ error: "Template is inactive" });
    finalSubject = renderTemplate(template.subject, vars);
    finalBody = renderTemplate(template.bodyHtml, vars);
    senderMode = template.senderMode as "default" | "assigned_rep";
  }

  if (!finalSubject.trim() || !finalBody.trim()) {
    return void res.status(400).json({ error: "subject and bodyHtml are required" });
  }

  const { send, error: sendError, configurationReason } = await doSendEmail({
    leadId: lead.id,
    userId: user.id,
    templateId: templateId ?? null,
    subject: finalSubject,
    bodyHtml: finalBody,
    toEmail: lead.email,
    baseUrl: getPublicBaseUrl(),
    senderMode,
    rep,
  });

  if (sendError) {
    if (configurationReason) {
      logger.error({ route: "/api/email/send", reason: configurationReason }, "SendGrid unavailable");
      return void res.status(503).json({ error: "SendGrid unavailable", reason: configurationReason });
    }
    return void res.status(502).json({ error: `Email delivery failed: ${sendError}` });
  }

  await logActivity({
    userId: user.id,
    leadId: lead.id,
    action: "email_sent",
    entityType: "email_send",
    entityId: send.id,
    details: { subject: finalSubject, to: lead.email },
  });

  res.status(201).json(send);
});

// --- Bulk email ---
router.post("/email/bulk", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role === "rep") return void res.status(403).json({ error: "Forbidden" });

  const body = bulkEmailBody.safeParse(req.body);
  if (!body.success) return invalidInput(res, body);
  const { leadIds, templateId } = body.data;

  const template = await db.query.emailTemplatesTable.findFirst({ where: eq(emailTemplatesTable.id, templateId) });
  if (!template) return void res.status(404).json({ error: "Template not found" });
  if (!template.isActive) return void res.status(409).json({ error: "Template is inactive" });

  const baseUrl = getPublicBaseUrl();

  let sent = 0;
  let failed = 0;
  const skipped: number[] = [];
  const failures: Array<{ leadId: number; error: string }> = [];
  const [emailSettings] = await db.select({
    emailSendingEnabled: companySettingsTable.emailSendingEnabled,
    bulkEmailPerMinute: companySettingsTable.bulkEmailPerMinute,
  }).from(companySettingsTable).limit(1);
  const bulkCap = Math.max(1, Math.min(1000, emailSettings?.bulkEmailPerMinute ?? 60));
  if (emailSettings?.emailSendingEnabled !== true) {
    return void res.status(409).json({
      error: "Email sending is disabled in Settings",
      sent: 0,
      failed: leadIds.length,
      skipped: [],
      failures: leadIds.map((id) => ({ leadId: id, error: "Email sending is disabled in Settings" })),
      rateLimitPerMinute: bulkCap,
    });
  }
  for (const leadId of leadIds) {
    const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, leadId) });
    if (!lead || !lead.email || lead.isUnsubscribed || await isEmailSuppressed(lead?.email || "")) {
      if (lead?.isUnsubscribed) skipped.push(leadId);
      failed++;
      failures.push({ leadId, error: !lead ? "Lead not found" : !lead.email ? "Lead has no email address" : "Lead is unsubscribed" });
      continue;
    }
    const rep = lead.assignedRepId
      ? await db.query.usersTable.findFirst({ where: eq(usersTable.id, lead.assignedRepId) })
      : await db.query.usersTable.findFirst({ where: eq(usersTable.id, user.id) });
    const vars = buildVariables(lead, rep);
    // Reserve against the shared database limiter, not process-local pacing.
    // The reservation is made before creating the queued send record so a
    // saturated request cannot strand queued rows.
    while (!(await reserveEmailRateSlot(bulkCap))) {
      await wait(EMAIL_RATE_RETRY_MS);
    }
    const { error } = await doSendEmail({
      leadId: lead.id,
      userId: user.id,
      templateId,
      subject: renderTemplate(template.subject, vars),
      bodyHtml: renderTemplate(template.bodyHtml, vars),
      toEmail: lead.email,
      baseUrl,
      senderMode: template.senderMode as "default" | "assigned_rep",
      rep,
      deliveryKind: "bulk",
    });
    if (error) {
      failed++;
      failures.push({ leadId, error });
    }
    else {
      sent++;
      await logActivity({
        userId: user.id,
        leadId: lead.id,
        action: "email_sent",
        entityType: "email_template",
        entityId: templateId,
        details: { subject: template.subject, to: lead.email, bulk: true },
      });
    }
  }

  res.json({ sent, failed, skipped, failures, rateLimitPerMinute: bulkCap });
});

// This read-only value is shown before a bulk send. It reads exactly the
// shared bulk-and-drip counter enforced during placeholder creation.
router.get("/email/bulk-capacity", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role === "rep") return void res.status(403).json({ error: "Forbidden" });
  res.json(await getDailyMarketingEmailCapacity());
});

// --- List templates ---
router.get("/email/templates", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const templates = await db.query.emailTemplatesTable.findMany({
    with: { creator: true, owner: true },
    orderBy: (t, { desc }) => [desc(t.updatedAt)],
  });

  res.json(templates
    .filter((template) => canReadMarketingResource(user, template.owner))
    .map(templateToApi));
});

// --- Get single template ---
router.get("/email/templates/:id", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const id = positiveId.safeParse(req.params["id"]);
  if (!id.success) return invalidInput(res, id);
  const template = await db.query.emailTemplatesTable.findFirst({
    where: eq(emailTemplatesTable.id, id.data),
    with: { creator: true, owner: true },
  });
  if (!template) return void res.status(404).json({ error: "Not found" });
  if (!canReadMarketingResource(user, template.owner)) {
    return void res.status(403).json({ error: "Forbidden" });
  }
  res.json(templateToApi(template));
});

// --- Create template ---
router.post("/email/templates", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const body = templateBody.safeParse(req.body);
  if (!body.success) return invalidInput(res, body);
  const { name, subject, bodyHtml, programType, senderMode, isActive } = body.data;

  const [template] = await db.insert(emailTemplatesTable).values({
    name,
    subject,
    bodyHtml,
    programType: programType || null,
    senderMode: senderMode === "assigned_rep" ? "assigned_rep" : "default",
    createdBy: user.id,
    ownerId: user.id,
    isActive: isActive ?? true,
  }).returning();

  res.status(201).json(template);
});

// --- Update template ---
router.put("/email/templates/:id", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const id = positiveId.safeParse(req.params["id"]);
  if (!id.success) return invalidInput(res, id);
  const body = templateUpdateBody.safeParse(req.body);
  if (!body.success) return invalidInput(res, body);
  const { name, subject, bodyHtml, programType, senderMode, isActive } = body.data;

  const existing = await db.query.emailTemplatesTable.findFirst({ where: eq(emailTemplatesTable.id, id.data) });
  if (!existing) return void res.status(404).json({ error: "Not found" });
  if (!canManageMarketingResource(user, existing.ownerId)) {
    return void res.status(403).json({ error: "You can only edit templates you created" });
  }

  const [updated] = await db.update(emailTemplatesTable)
    .set({
      name: name ?? existing.name,
      subject: subject ?? existing.subject,
      bodyHtml: bodyHtml ?? existing.bodyHtml,
      programType: programType !== undefined ? programType : existing.programType,
      senderMode: senderMode === "assigned_rep" || senderMode === "default" ? senderMode : existing.senderMode,
      isActive: isActive ?? existing.isActive,
      updatedAt: new Date(),
    })
    .where(eq(emailTemplatesTable.id, id.data))
    .returning();

  res.json(updated);
});

// --- Delete template (reps may delete only their own; managers/admins may delete any) ---
router.delete("/email/templates/:id", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) return void res.status(400).json({ error: "Invalid ID" });

  const existing = await db.query.emailTemplatesTable.findFirst({ where: eq(emailTemplatesTable.id, id) });
  if (!existing) return void res.status(404).json({ error: "Not found" });
  if (!canManageMarketingResource(user, existing.ownerId)) {
    return void res.status(403).json({ error: "You can only delete templates you created" });
  }

  try {
    await db.delete(emailTemplatesTable).where(eq(emailTemplatesTable.id, id));
  } catch (error: any) {
    // Templates referenced by sequence steps use an intentional RESTRICT FK.
    if (error?.code === "23503") {
      return void res.status(409).json({ error: "Template is used by a drip sequence and cannot be deleted" });
    }
    throw error;
  }
  res.status(204).send();
});

// --- Preview template ---
router.post("/email/templates/:id/preview", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const id = positiveId.safeParse(req.params["id"]);
  if (!id.success) return invalidInput(res, id);
  const body = previewTemplateBody.safeParse(req.body);
  if (!body.success) return invalidInput(res, body);
  const { leadId } = body.data;

  const template = await db.query.emailTemplatesTable.findFirst({
    where: eq(emailTemplatesTable.id, id.data),
    with: { owner: true },
  });
  if (!template) return void res.status(404).json({ error: "Not found" });
  if (!canReadMarketingResource(user, template.owner)) {
    return void res.status(403).json({ error: "Forbidden" });
  }

  let vars = SAMPLE_VARS;
  if (leadId) {
    const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, leadId) });
    if (!lead) return void res.status(404).json({ error: "Lead not found" });
    if (user.role === "rep" && lead.assignedRepId !== user.id) {
      return void res.status(403).json({ error: "Forbidden" });
    }
    const rep = lead?.assignedRepId
      ? await db.query.usersTable.findFirst({ where: eq(usersTable.id, lead.assignedRepId) })
      : null;
    vars = buildVariables(lead, rep);
  }

  res.json({
    subject: renderTemplate(template.subject, vars),
    bodyHtml: ensureBrandEmailHeader(renderTemplate(template.bodyHtml, vars), getPublicBaseUrl()),
  });
});

type AdminTestSendDependencies = {
  requireAuthenticatedUser?: (req: Request, res: Response) => Promise<{ id: number; role: string } | undefined>;
  findTemplate?: (id: number) => Promise<{ id: number; subject: string; bodyHtml: string; senderMode: string; isActive: boolean } | undefined>;
  findRep?: (id: number) => Promise<{ name?: string | null; email?: string | null } | undefined>;
  send?: typeof doSendEmail;
  activity?: (params: {
    userId: number | null;
    leadId?: number | null;
    dealId?: number | null;
    action: string;
    entityType: string;
    entityId: string | number;
    details?: Record<string, unknown>;
  }) => Promise<unknown>;
};

// Exported factory keeps the actual HTTP endpoint testable with a mocked
// repository/provider; the default dependency set is the production path.
export function createAdminTestSendHandler(dependencies: AdminTestSendDependencies = {}) {
  const requireAuthenticatedUser = dependencies.requireAuthenticatedUser ?? requireUser;
  const findTemplate = dependencies.findTemplate ?? (async (id: number) =>
    db.query.emailTemplatesTable.findFirst({ where: eq(emailTemplatesTable.id, id) }));
  const findRep = dependencies.findRep ?? (async (id: number) =>
    db.query.usersTable.findFirst({ where: eq(usersTable.id, id) }));
  const sendEmail = dependencies.send ?? doSendEmail;
  const activity = dependencies.activity ?? logActivity;
  return async (req: Request, res: Response) => {
  const user = await requireAuthenticatedUser(req, res);
  if (!user) return;
  if (user.role !== "admin") return void res.status(403).json({ error: "Admins only" });

  const body = testSendBody.safeParse(req.body);
  if (!body.success) return invalidInput(res, body);
  const { templateId, toEmail } = body.data;
  // A fixed CEO delivery message makes an operational test independent of
  // mutable marketing templates. The optional ID remains compatible with the
  // former endpoint for administrators who explicitly want to test one.
  const CEO_TEST_TEMPLATE = {
    id: null,
    name: "CEO delivery test",
    subject: "My Business Solutions email delivery test",
    bodyHtml: "<p>This is a delivery test from My Business Solutions CEO.</p>",
    senderMode: "default",
    isActive: true,
  };
  const template = templateId
    ? await findTemplate(templateId)
    : CEO_TEST_TEMPLATE;
  if (!template) return void res.status(404).json({ error: "Template not found" });
  if (!template.isActive) return void res.status(409).json({ error: "Template is inactive" });

  const rep = await findRep(user.id);
  const recipientName = toEmail.split("@")[0] || "Test";
  const vars = buildVariables(
    {
      firstName: recipientName,
      lastName: "",
      companyName: "My Business Solutions",
      email: toEmail,
      phone: "",
    },
    rep,
  );
  const finalSubject = renderTemplate(template.subject, vars);
  const finalBody = renderTemplate(template.bodyHtml, vars);
  if (/\{\{\w+\}\}/.test(finalSubject) || /\{\{\w+\}\}/.test(finalBody)) {
    return void res.status(422).json({ error: "Template contains unresolved merge fields" });
  }

  const { send, error: sendError, configurationReason } = await sendEmail({
    leadId: null,
    userId: user.id,
    templateId: template.id,
    subject: finalSubject,
    bodyHtml: finalBody,
    toEmail: toEmail.trim(),
    baseUrl: getPublicBaseUrl(),
    senderMode: template.senderMode as "default" | "assigned_rep",
    rep,
    deliveryKind: "test",
  });
  if (sendError) {
    if (configurationReason) {
      logger.error({ route: "/api/email/test-send", reason: configurationReason }, "SendGrid unavailable");
      return void res.status(503).json({ error: "SendGrid unavailable", reason: configurationReason });
    }
    return void res.status(502).json({ error: `Email delivery failed: ${sendError}` });
  }

  await activity({
    userId: user.id,
    leadId: null,
    action: "email_test_sent",
    entityType: "email_send",
    entityId: send.id,
    details: {
      subject: finalSubject,
      to: toEmail.trim(),
      templateId: template.id,
      tracking: { open: true, click: true },
    },
  });

  res.status(201).json({ ...sendToApi(send), messageId: send.sendgridMessageId ?? null });
  };
}

// --- Admin-only test send; never associates with or sends to a lead ---
router.post("/email/test-send", createAdminTestSendHandler());

// --- List emails for a lead ---
router.get("/leads/:id/emails", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const leadId = parseInt(req.params["id"] as string, 10);
  if (isNaN(leadId)) return void res.status(400).json({ error: "Invalid ID" });

  const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, leadId) });
  if (!lead) return void res.status(404).json({ error: "Not found" });

  if (user.role === "rep" && lead.assignedRepId !== user.id) {
    return void res.status(403).json({ error: "Forbidden" });
  }

  const sends = await db.query.emailSendsTable.findMany({
    where: eq(emailSendsTable.leadId, leadId),
    with: { template: true, user: true },
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  });

  res.json(sends.map(sendToApi));
});

function templateToApi(t: any) {
  return {
    id: t.id,
    name: t.name,
    subject: t.subject,
    bodyHtml: t.bodyHtml,
    programType: t.programType ?? null,
    senderMode: t.senderMode ?? "default",
    isActive: t.isActive,
    createdBy: t.createdBy ?? null,
    ownerId: t.ownerId ?? null,
    creator: t.creator ? { id: t.creator.id, name: t.creator.name, email: t.creator.email } : null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

// Auth-independent starter seed used by both the legacy endpoint and the
// ordered production closeout.
export async function seedStarterEmail(actorId: number) {
  const STARTER_TEMPLATES = [
    {
      name: "Application Received",
      programType: null as string | null,
      subject: "We received your application, {{lead_first_name}}",
      bodyHtml: `{{brand_email_header}}<p>Hi {{lead_first_name}},</p>
<p>Thank you for submitting {{lead_company}}'s financing application to My Business Solutions. We're pleased to confirm that we have received everything and your file is now in review.</p>
<p>{{rep_name}} has been assigned as your dedicated specialist and will personally review your application and reach out within one business day to discuss next steps.</p>
<p>In the meantime, if you have any questions or need to provide additional information, please don't hesitate to reply to this email.</p>
<p>We look forward to working with you.</p>
<p>Warm regards,<br>{{rep_name}}<br>{{rep_email}}<br>My Business Solutions</p>`,
    },
    {
      name: "Initial Follow-Up",
      programType: null as string | null,
      subject: "Following up on {{lead_company}}'s financing",
      bodyHtml: `{{brand_email_header}}<p>Hi {{lead_first_name}},</p>
<p>I wanted to follow up on the financing application we received for {{lead_company}}. My name is {{rep_name}} and I'm your point of contact throughout this process.</p>
<p>I'm happy to answer any questions you may have and walk you through the next steps so everything moves forward smoothly. Whether you'd prefer to reply here or schedule a quick call, I'm available at your convenience.</p>
<p>Looking forward to hearing from you.</p>
<p>Best,<br>{{rep_name}}<br>{{rep_email}}<br>My Business Solutions</p>`,
    },
    {
      name: "Document Request",
      programType: null as string | null,
      subject: "Quick documents to move {{lead_company}} forward",
      bodyHtml: `{{brand_email_header}}<p>Hi {{lead_first_name}},</p>
<p>To keep your application moving forward as quickly as possible, we need a few standard documents for {{lead_company}}:</p>
<ul>
  <li>3–6 months of recent business bank statements</li>
</ul>
<p>If you've already provided any of these, no need to resend — we'll note what's already on file.</p>
<p>Submitting these documents helps our team complete the review and move toward a decision faster. Your information is handled securely and kept strictly confidential.</p>
<p>Please reply to this email with the documents attached, or let me know if you have any questions about what's needed.</p>
<p>Thank you,<br>{{rep_name}}<br>{{rep_email}}<br>My Business Solutions</p>`,
    },
    {
      name: "Working Capital Program",
      programType: "working_capital" as string | null,
      subject: "Working capital options for {{lead_company}}",
      bodyHtml: `{{brand_email_header}}<p>Hi {{lead_first_name}},</p>
<p>I wanted to share a quick overview of our working capital program, which may be a strong fit for {{lead_company}}.</p>
<p>Working capital financing is designed to give businesses fast access to the funds they need to cover day-to-day operations, manage cash flow, or seize growth opportunities. Key benefits include:</p>
<ul>
  <li><strong>Speed:</strong> Funding decisions typically happen quickly, without the lengthy timelines of traditional bank loans.</li>
  <li><strong>Flexibility:</strong> Funds can be used for virtually any business purpose.</li>
  <li><strong>Revenue-based:</strong> Repayment is structured around your business's cash flow, not a fixed monthly payment.</li>
</ul>
<p>I'd love to walk you through how this could work specifically for {{lead_company}}. Reply here or let me know a good time to connect.</p>
<p>Best,<br>{{rep_name}}<br>{{rep_email}}<br>My Business Solutions</p>`,
    },
    {
      name: "Equipment Financing Program",
      programType: "equipment" as string | null,
      subject: "Equipment financing for {{lead_company}}",
      bodyHtml: `{{brand_email_header}}<p>Hi {{lead_first_name}},</p>
<p>I wanted to share some information about our equipment financing program, which could be a great solution for {{lead_company}}.</p>
<p>Equipment financing allows businesses to acquire the tools and machinery they need without a large upfront capital outlay. Some of the key advantages include:</p>
<ul>
  <li><strong>Preserve cash flow:</strong> Keep your working capital available for other needs.</li>
  <li><strong>Fixed repayment structure:</strong> Predictable payments make budgeting straightforward.</li>
  <li><strong>Wide range of equipment:</strong> From vehicles and machinery to technology and fixtures.</li>
</ul>
<p>I'd be happy to discuss how this program could support your goals at {{lead_company}}. Feel free to reply or suggest a time to speak.</p>
<p>Warm regards,<br>{{rep_name}}<br>{{rep_email}}<br>My Business Solutions</p>`,
    },
    {
      name: "Status Update",
      programType: null as string | null,
      subject: "An update on your {{lead_company}} application",
      bodyHtml: `{{brand_email_header}}<p>Hi {{lead_first_name}},</p>
<p>I wanted to touch base with a brief update on {{lead_company}}'s application. Rest assured, your file is actively being worked on and our team is focused on moving things forward.</p>
<p>As always, {{rep_name}} is your dedicated point of contact and is here to help with any questions or concerns along the way. Please don't hesitate to reach out at {{rep_email}}.</p>
<p>We appreciate your patience and will be in touch with further updates shortly.</p>
<p>Best regards,<br>{{rep_name}}<br>{{rep_email}}<br>My Business Solutions</p>`,
    },
    {
      name: "Approved",
      programType: null as string | null,
      subject: "Great news for {{lead_company}}",
      bodyHtml: `{{brand_email_header}}<p>Hi {{lead_first_name}},</p>
<p>We have great news regarding {{lead_company}}'s application!</p>
<p>{{rep_name}} will be reaching out to you shortly to review the details and walk you through the next steps to finalize everything. Please keep an eye out for their call or email.</p>
<p>If you have any immediate questions in the meantime, feel free to reply to this email or contact {{rep_name}} directly at {{rep_email}}.</p>
<p>We're excited to support {{lead_company}} and look forward to getting things wrapped up quickly.</p>
<p>Congratulations and thank you for choosing My Business Solutions!</p>
<p>Warmly,<br>{{rep_name}}<br>{{rep_email}}<br>My Business Solutions</p>`,
    },
    {
      name: "Quick Question About Business Funding",
      programType: null as string | null,
      subject: "Quick Question About Business Funding",
      bodyHtml: `<p>Hello {{lead_first_name}},</p>
<p>I work with My Business Solutions (MBS) helping businesses secure fast capital from $4,000 to $20,000,000.</p>
<p>Programs include working capital, SBA loans, equipment financing, commercial real estate funding, and factoring.</p>
<p>Approvals are same day, and many deals fund within 24 hours.</p>
<p>All we need to review options:</p>
<ul>
<li>Short application</li>
<li>3–6 months of business bank statements</li>
</ul>
<p>Would you like me to send over the application to see what your business qualifies for?</p>
<p>Best,<br>{{rep_name}}</p>`,
    },
    {
      name: "Fast Business Funding Options – Same Day Approval",
      programType: null as string | null,
      subject: "Fast Business Funding Options – Same Day Approval",
      bodyHtml: `<p>Hello {{lead_first_name}},</p>
<p>My name is {{rep_name}} with My Business Solutions (MBS). We help businesses access fast and flexible funding when they need capital for growth, payroll, equipment, inventory, or cash flow.</p>
<p>We offer several commercial financing options including:</p>
<ul>
<li>Merchant Cash Advances</li>
<li>Business Loans</li>
<li>SBA Loan Programs</li>
<li>Equipment Financing</li>
<li>Commercial Real Estate Capital</li>
<li>Invoice Factoring</li>
</ul>
<p>Funding amounts range from $4,000 to $20,000,000, and we work with companies of all sizes and industries.</p>
<p>What makes MBS different:</p>
<ul>
<li>✔ Same Day Approvals</li>
<li>✔ Same Day Funding for Working Capital</li>
<li>✔ Next Day Funding on Titled Equipment</li>
<li>✔ Simple Application Process</li>
<li>✔ Flexible Programs for Most Credit Profiles</li>
</ul>
<p>What we need to get started:</p>
<ul>
<li>1 Short Application</li>
<li>3–6 Months of Business Bank Statements</li>
</ul>
<p>That's it.</p>
<p>If you'd like to see what your business qualifies for, simply reply to this email and I'll send the application over right away, or apply here:<br><a href="https://app.my-business-solutions.com/apply">https://app.my-business-solutions.com/apply</a></p>
<p>P.S. Many businesses receive approvals the same day and funding within 24 hours.</p>
<p>Best regards,<br>{{rep_name}}<br>My Business Solutions (MBS)<br>{{rep_phone}}<br>{{rep_email}}<br>www.my-business-solutions.com</p>`,
    },
    {
      name: "Lender Submission",
      programType: null as string | null,
      subject: "Lender submission for {{lead_company}}",
      bodyHtml: `{{brand_email_header}}<p>Hello {{lender_name}},</p>
<p>Please review the attached signed financing application package for <strong>{{lead_company}}</strong>.</p>
<p><strong>Requested amount:</strong> {{requested_amount}}<br>
<strong>Program:</strong> {{application_type}}<br>
<strong>Applicant:</strong> {{lead_first_name}} {{lead_last_name}}</p>
<p>Please let {{rep_name}} know if you need anything else to complete your review.</p>
<p>Regards,<br>{{rep_name}}<br>{{rep_email}}<br>My Business Solutions</p>`,
    },
  ];

  return seedStarterEmailData(actorId, STARTER_TEMPLATES);
}

// POST /email/seed-starter — admin only, idempotent
router.post("/email/seed-starter", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") {
    res.status(403).json({ error: "Admins only" });
    return;
  }
  res.json(await seedStarterEmail(user.id));
});

function sendToApi(s: any) {
  return {
    id: s.id,
    leadId: s.leadId ?? null,
    userId: s.userId ?? null,
    templateId: s.templateId ?? null,
    subject: s.subject,
    toEmail: s.toEmail,
    fromEmail: s.fromEmail,
    status: s.status,
    failureReason: s.failureReason ?? null,
    sendgridMessageId: s.sendgridMessageId ?? null,
    sentAt: s.sentAt?.toISOString() ?? null,
    openedAt: s.openedAt?.toISOString() ?? null,
    clickedAt: s.clickedAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export { doSendEmail, renderTemplate, buildVariables, sendToApi, injectTracking, FROM_EMAIL, FROM_NAME };
export default router;
