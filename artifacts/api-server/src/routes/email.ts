import { Router, type Request, type Response } from "express";
import sgMail from "@sendgrid/mail";
import { createHmac } from "crypto";
import { db } from "@workspace/db";
import {
  emailTemplatesTable,
  emailSendsTable,
  leadsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, isNotNull } from "drizzle-orm";
import { requireUser } from "../lib/authHelpers";
import { logActivity } from "../lib/activityHelper";

const UNSUB_SECRET = process.env["UNSUB_SECRET"] || "mbs-unsub-dev-secret-change-in-prod";

function makeUnsubToken(sendId: number, email: string): string {
  return createHmac("sha256", UNSUB_SECRET).update(`${sendId}:${email}`).digest("hex");
}

function verifyUnsubToken(sendId: number, email: string, token: string): boolean {
  const expected = makeUnsubToken(sendId, email);
  // Constant-time compare via Buffer
  if (expected.length !== token.length) return false;
  return createHmac("sha256", UNSUB_SECRET).update(expected).digest("hex") ===
         createHmac("sha256", UNSUB_SECRET).update(token).digest("hex");
}

const router = Router();

const SENDGRID_API_KEY = process.env["SENDGRID_API_KEY"];
const FROM_EMAIL = process.env["SENDGRID_FROM_EMAIL"] || "noreply@mybusinesssolutions.com";
const FROM_NAME = process.env["SENDGRID_FROM_NAME"] || "MBS CRM";

if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

// 1×1 transparent GIF bytes
const TRACKING_PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

function getBaseUrl(req: Request): string {
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host = (req.headers["x-forwarded-host"] as string) || req.headers["host"] || "";
  // Strip the /api prefix to get the root so tracking URLs are correct
  return `${proto}://${host}`;
}

const SAMPLE_VARS: Record<string, string> = {
  lead_first_name: "Jane",
  lead_last_name: "Smith",
  lead_company: "Acme Corp",
  lead_email: "jane@acme.com",
  lead_phone: "+15551234567",
  rep_name: "Your Rep",
  rep_email: "rep@company.com",
};

function buildVariables(lead: any, rep: any): Record<string, string> {
  return {
    lead_first_name: lead?.firstName || "",
    lead_last_name: lead?.lastName || "",
    lead_company: lead?.companyName || "",
    lead_email: lead?.email || "",
    lead_phone: lead?.phone || "",
    rep_name: rep?.name || "",
    rep_email: rep?.email || "",
  };
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

function injectTracking(bodyHtml: string, sendId: number, baseUrl: string, toEmail: string): string {
  // Wrap hrefs in click-tracking redirect
  const withClicks = bodyHtml.replace(
    /href="([^"#][^"]*)"/gi,
    (_, url) => {
      const encoded = encodeURIComponent(url);
      return `href="${baseUrl}/api/email/track/click/${sendId}?url=${encoded}"`;
    }
  );
  // Signed unsubscribe link — token is HMAC-SHA256(secret, sendId:email)
  const token = makeUnsubToken(sendId, toEmail);
  const pixel = `<img src="${baseUrl}/api/email/track/open/${sendId}" width="1" height="1" alt="" style="display:none" />`;
  const unsubLink = `<p style="font-size:11px;color:#999;margin-top:24px;text-align:center">
    <a href="${baseUrl}/api/email/unsubscribe?id=${sendId}&email=${encodeURIComponent(toEmail)}&token=${token}" style="color:#999">Unsubscribe</a>
  </p>`;
  return `${withClicks}${unsubLink}${pixel}`;
}

async function doSendEmail(params: {
  leadId: number;
  userId: number | null;
  templateId: number | null;
  subject: string;
  bodyHtml: string;
  toEmail: string;
  baseUrl: string;
}): Promise<{ send: any; error?: string }> {
  // Create a placeholder record first to get the ID for tracking URLs
  const [placeholder] = await db.insert(emailSendsTable).values({
    leadId: params.leadId,
    userId: params.userId,
    templateId: params.templateId,
    subject: params.subject,
    toEmail: params.toEmail,
    fromEmail: FROM_EMAIL,
    status: "queued",
  }).returning();

  const trackedHtml = injectTracking(params.bodyHtml, placeholder.id, params.baseUrl, params.toEmail);

  if (!SENDGRID_API_KEY) {
    // Dev mode — mark as sent without actual delivery
    const [updated] = await db.update(emailSendsTable)
      .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
      .where(eq(emailSendsTable.id, placeholder.id))
      .returning();
    return { send: updated };
  }

  try {
    const [response] = await sgMail.send({
      from: { email: FROM_EMAIL, name: FROM_NAME },
      to: params.toEmail,
      subject: params.subject,
      html: trackedHtml,
    });

    const messageId = (response.headers?.["x-message-id"] as string) || null;

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
      .set({ status: "bounced", updatedAt: new Date() })
      .where(eq(emailSendsTable.id, placeholder.id));
    return { send: placeholder, error: err?.message || "Send failed" };
  }
}

// --- Open tracking pixel (no auth) ---
router.get("/email/track/open/:sendId", async (req, res) => {
  const sendId = parseInt(req.params["sendId"] as string, 10);
  if (!isNaN(sendId)) {
    const existing = await db.query.emailSendsTable.findFirst({ where: eq(emailSendsTable.id, sendId) });
    if (existing && existing.status !== "clicked") {
      await db.update(emailSendsTable)
        .set({ status: "opened", openedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(emailSendsTable.id, sendId)));
      if (existing.leadId) {
        await logActivity({
          userId: existing.userId,
          leadId: existing.leadId,
          action: "email_opened",
          entityType: "email_send",
          entityId: sendId,
          details: { subject: existing.subject },
        });
      }
    }
  }
  res.set("Content-Type", "image/gif").set("Cache-Control", "no-store").send(TRACKING_PIXEL);
});

// --- Click tracking redirect (no auth) ---
router.get("/email/track/click/:sendId", async (req, res) => {
  const sendId = parseInt(req.params["sendId"] as string, 10);
  const url = (req.query["url"] as string) || "/";
  if (!isNaN(sendId)) {
    const existing = await db.query.emailSendsTable.findFirst({ where: eq(emailSendsTable.id, sendId) });
    if (existing) {
      await db.update(emailSendsTable)
        .set({ status: "clicked", clickedAt: new Date(), updatedAt: new Date() })
        .where(eq(emailSendsTable.id, sendId));
      if (existing.leadId && existing.status !== "clicked") {
        await logActivity({
          userId: existing.userId,
          leadId: existing.leadId,
          action: "email_clicked",
          entityType: "email_send",
          entityId: sendId,
          details: { url },
        });
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

  await db.update(leadsTable)
    .set({ isUnsubscribed: true, updatedAt: new Date() })
    .where(and(isNotNull(leadsTable.email), eq(leadsTable.email, email)));

  res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px">
    <h2>You've been unsubscribed</h2>
    <p>You will no longer receive marketing emails from MBS.</p>
  </body></html>`);
});

// --- Send single email ---
router.post("/email/send", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const { leadId, templateId, subject, bodyHtml } = req.body as {
    leadId: number;
    templateId?: number;
    subject?: string;
    bodyHtml?: string;
  };

  if (!leadId) return void res.status(400).json({ error: "leadId is required" });

  const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, leadId) });
  if (!lead) return void res.status(404).json({ error: "Lead not found" });
  if (!lead.email) return void res.status(400).json({ error: "Lead has no email address" });
  if (lead.isUnsubscribed) return void res.status(409).json({ error: "Lead is unsubscribed" });

  const rep = await db.query.usersTable.findFirst({ where: eq(usersTable.id, user.id) });
  const vars = buildVariables(lead, rep);

  let finalSubject = subject || "";
  let finalBody = bodyHtml || "";

  if (templateId) {
    const template = await db.query.emailTemplatesTable.findFirst({ where: eq(emailTemplatesTable.id, templateId) });
    if (!template) return void res.status(404).json({ error: "Template not found" });
    finalSubject = renderTemplate(template.subject, vars);
    finalBody = renderTemplate(template.bodyHtml, vars);
  }

  if (!finalSubject.trim() || !finalBody.trim()) {
    return void res.status(400).json({ error: "subject and bodyHtml are required" });
  }

  const { send } = await doSendEmail({
    leadId: lead.id,
    userId: user.id,
    templateId: templateId ?? null,
    subject: finalSubject,
    bodyHtml: finalBody,
    toEmail: lead.email,
    baseUrl: getBaseUrl(req),
  });

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

  const { leadIds, templateId } = req.body as { leadIds: number[]; templateId: number };
  if (!Array.isArray(leadIds) || leadIds.length === 0) return void res.status(400).json({ error: "leadIds required" });
  if (!templateId) return void res.status(400).json({ error: "templateId required" });

  const template = await db.query.emailTemplatesTable.findFirst({ where: eq(emailTemplatesTable.id, templateId) });
  if (!template) return void res.status(404).json({ error: "Template not found" });

  const rep = await db.query.usersTable.findFirst({ where: eq(usersTable.id, user.id) });
  const baseUrl = getBaseUrl(req);

  let sent = 0;
  let failed = 0;
  const skipped: number[] = [];

  for (const leadId of leadIds) {
    const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, leadId) });
    if (!lead || !lead.email || lead.isUnsubscribed) {
      if (lead?.isUnsubscribed) skipped.push(leadId);
      failed++;
      continue;
    }
    const vars = buildVariables(lead, rep);
    const { error } = await doSendEmail({
      leadId: lead.id,
      userId: user.id,
      templateId,
      subject: renderTemplate(template.subject, vars),
      bodyHtml: renderTemplate(template.bodyHtml, vars),
      toEmail: lead.email,
      baseUrl,
    });
    if (error) failed++;
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

  res.json({ sent, failed, skipped });
});

// --- List templates ---
router.get("/email/templates", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const templates = await db.query.emailTemplatesTable.findMany({
    with: { creator: true },
    orderBy: (t, { desc }) => [desc(t.updatedAt)],
  });

  res.json(templates.map(templateToApi));
});

// --- Get single template ---
router.get("/email/templates/:id", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const id = parseInt(req.params["id"] as string, 10);
  const template = await db.query.emailTemplatesTable.findFirst({
    where: eq(emailTemplatesTable.id, id),
    with: { creator: true },
  });
  if (!template) return void res.status(404).json({ error: "Not found" });
  res.json(templateToApi(template));
});

// --- Create template ---
router.post("/email/templates", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role === "rep") return void res.status(403).json({ error: "Forbidden" });

  const { name, subject, bodyHtml, programType, isActive } = req.body as any;
  if (!name || !subject || !bodyHtml) return void res.status(400).json({ error: "name, subject, bodyHtml required" });

  const [template] = await db.insert(emailTemplatesTable).values({
    name,
    subject,
    bodyHtml,
    programType: programType || null,
    createdBy: user.id,
    isActive: isActive ?? true,
  }).returning();

  res.status(201).json(template);
});

// --- Update template ---
router.put("/email/templates/:id", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role === "rep") return void res.status(403).json({ error: "Forbidden" });

  const id = parseInt(req.params["id"] as string, 10);
  const { name, subject, bodyHtml, programType, isActive } = req.body as any;

  const existing = await db.query.emailTemplatesTable.findFirst({ where: eq(emailTemplatesTable.id, id) });
  if (!existing) return void res.status(404).json({ error: "Not found" });

  const [updated] = await db.update(emailTemplatesTable)
    .set({
      name: name ?? existing.name,
      subject: subject ?? existing.subject,
      bodyHtml: bodyHtml ?? existing.bodyHtml,
      programType: programType !== undefined ? programType : existing.programType,
      isActive: isActive ?? existing.isActive,
      updatedAt: new Date(),
    })
    .where(eq(emailTemplatesTable.id, id))
    .returning();

  res.json(updated);
});

// --- Preview template ---
router.post("/email/templates/:id/preview", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const id = parseInt(req.params["id"] as string, 10);
  const { leadId } = req.body as { leadId?: number };

  const template = await db.query.emailTemplatesTable.findFirst({ where: eq(emailTemplatesTable.id, id) });
  if (!template) return void res.status(404).json({ error: "Not found" });

  let vars = SAMPLE_VARS;
  if (leadId) {
    const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, leadId) });
    const rep = lead?.assignedRepId
      ? await db.query.usersTable.findFirst({ where: eq(usersTable.id, lead.assignedRepId) })
      : null;
    if (lead) vars = buildVariables(lead, rep);
  }

  res.json({
    subject: renderTemplate(template.subject, vars),
    bodyHtml: renderTemplate(template.bodyHtml, vars),
  });
});

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
    isActive: t.isActive,
    createdBy: t.createdBy ?? null,
    creator: t.creator ? { id: t.creator.id, name: t.creator.name, email: t.creator.email } : null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

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
    sendgridMessageId: s.sendgridMessageId ?? null,
    sentAt: s.sentAt?.toISOString() ?? null,
    openedAt: s.openedAt?.toISOString() ?? null,
    clickedAt: s.clickedAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export { doSendEmail, renderTemplate, buildVariables, sendToApi, FROM_EMAIL, FROM_NAME };
export default router;
