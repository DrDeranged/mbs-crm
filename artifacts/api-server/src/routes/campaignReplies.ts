import { Router } from "express";
import multer from "multer";
import { randomUUID, createHash } from "node:crypto";
import sgMail from "@sendgrid/mail";
import { and, eq, sql } from "drizzle-orm";
import { db as defaultDb, campaignRepliesTable, emailSendsTable, campaignLaunchesTable, activityLogTable, companySettingsTable } from "@workspace/db";
import { objectStorageClient as defaultStorage } from "../lib/objectStorage";
import { logActivity } from "../lib/activityHelper";
import { digestReplyToken, replyCaptureConfigured, REPLY_DOMAIN } from "../lib/campaignAttribution";
import { authenticateInboundParse, parseMailHeaders, automatedReply, safeMailbox, replyAddressToken, replyDedupeKey, safeReplyText } from "../lib/campaignReplyPolicy";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 8, fields: 24, fieldSize: 1024 * 1024, parts: 32 } });
const supported = new Set(["application/pdf", "image/png", "image/jpeg", "text/plain"]);

export function createCampaignRepliesRouter(dependencies: {
  database?: any; provider?: Pick<typeof sgMail, "send">; storage?: typeof defaultStorage;
  inboundSecret?: string; captureEnabled?: boolean; forwardingEnabled?: () => boolean; privateObjectDir?: string;
} = {}) {
const db = dependencies.database ?? defaultDb;
const provider = dependencies.provider ?? sgMail;
const objectStorageClient = dependencies.storage ?? defaultStorage;
const router = Router();
router.post("/sendgrid/inbound-parse", (req, res, next) => {
  if (!authenticateInboundParse(req.header("authorization"), dependencies.inboundSecret ?? process.env.SENDGRID_INBOUND_PARSE_SECRET)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  upload.any()(req, res, err => {
    if (err) { res.status(413).json({ error: "Inbound mail exceeds supported limits" }); return; }
    next();
  });
}, async (req, res) => {
  if (!(dependencies.captureEnabled ?? replyCaptureConfigured())) return void res.status(503).json({ error: "Reply capture is disabled" });
  try {
    const headers = parseMailHeaders(String(req.body?.headers ?? ""));
    const from = safeMailbox(String(req.body?.from ?? ""));
    const token = replyAddressToken(String(req.body?.envelope ?? ""));
    if (!from || !token) return void res.status(202).json({ ignored: true });
    if (automatedReply(headers, from)) return void res.status(202).json({ ignored: true });
    const [send] = await db.select().from(emailSendsTable).where(eq(emailSendsTable.replyTokenDigest, digestReplyToken(token))).limit(1);
    if (!send?.campaignId || !send.leadId || !send.originalReplyTo || !send.sentAt || send.deliveryKind === "test") {
      return void res.status(202).json({ ignored: true });
    }
    const [launch] = await db.select().from(campaignLaunchesTable).where(eq(campaignLaunchesTable.id, send.campaignLaunchId ?? -1)).limit(1);
    if (!launch || launch.mode !== "live" || launch.campaignId !== send.campaignId || from === send.fromEmail.toLowerCase()) return void res.status(202).json({ ignored: true });
    const forwardTo = safeMailbox(send.originalReplyTo);
    if (!forwardTo || forwardTo.endsWith(`@${REPLY_DOMAIN}`)) return void res.status(422).json({ error: "Unsafe stored forwarding destination" });
    const subject = String(req.body?.subject ?? "").replace(/[\r\n\0]/g, " ").slice(0, 500);
    const bodyText = safeReplyText(String(req.body?.text ?? ""), String(req.body?.html ?? ""));
    const files = (req.files as Express.Multer.File[]) ?? [];
    if (files.reduce((n, f) => n + f.size, 0) > 10 * 1024 * 1024) return void res.status(413).json({ error: "Attachments exceed 10 MB total" });
    if (files.some(f => !supported.has(f.mimetype))) return void res.status(415).json({ error: "Unsupported reply attachment; only PDF, PNG, JPEG and plain text are accepted" });
    const dedupeKey = replyDedupeKey(send.id, headers, from, subject, bodyText, files.map(f => createHash("sha256").update(f.buffer).digest("hex")));
    const reply = await db.transaction(async (tx: any) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`campaign-reply:${dedupeKey}`}))`);
      const [existing] = await tx.select().from(campaignRepliesTable).where(eq(campaignRepliesTable.dedupeKey, dedupeKey)).limit(1);
      if (existing) return existing;
      const attachments = [];
      if (files.length) {
        const dir = dependencies.privateObjectDir ?? process.env.PRIVATE_OBJECT_DIR;
        if (!dir || !/^\/[^/]+\/.+/.test(dir)) throw new Error("Private reply storage unavailable");
        const [bucket, ...prefix] = dir.replace(/^\/+/, "").split("/");
        for (const f of files) {
          const path = `${prefix.join("/")}/campaign-replies/${randomUUID()}`;
          const filename = f.originalname.replace(/[^a-z0-9._ -]/gi, "_").slice(0, 120) || "attachment";
          await objectStorageClient.bucket(bucket).file(path).save(f.buffer, { resumable: false, contentType: f.mimetype, preconditionOpts: { ifGenerationMatch: 0 } });
          attachments.push({ path: `/${bucket}/${path}`, filename, contentType: f.mimetype });
        }
      }
      const [created] = await tx.insert(campaignRepliesTable).values({
        campaignId: send.campaignId!, leadId: send.leadId!, emailSendId: send.id,
        dedupeKey, fromEmail: from, subject, bodyText, attachments, forwardTo,
      }).returning();
      await logActivity({ userId: null, leadId: send.leadId!, action: "campaign_reply_received", entityType: "lead", entityId: send.leadId!,
        details: { replyId: created.id, campaignId: send.campaignId, fromEmail: from, subject, bodyText, forwardStatus: "pending" } }, tx);
      return created;
    });
    // A committed lease is also an uncertainty barrier. Redelivery may resume
    // pending/definite-failure work, but NEVER a dispatching/uncertain forward.
    if (["dispatching", "uncertain", "forwarded"].includes(reply.forwardStatus)) {
      return void res.status(202).json({ recorded: true, forwardStatus: reply.forwardStatus });
    }
    const [settings] = await db.select({ enabled: companySettingsTable.emailSendingEnabled }).from(companySettingsTable).limit(1);
    if (!(dependencies.forwardingEnabled ? dependencies.forwardingEnabled() : settings?.enabled && process.env.SENDGRID_API_KEY)) {
      await db.update(campaignRepliesTable).set({ forwardStatus: "failed", failureReason: "Forwarding is disabled or SendGrid is not configured" })
        .where(and(eq(campaignRepliesTable.id, reply.id), sql`${campaignRepliesTable.forwardStatus} IN ('pending','failed')`));
      return void res.status(503).json({ error: "Reply recorded; forwarding unavailable" });
    }
    const [claimed] = await db.update(campaignRepliesTable).set({ forwardStatus: "dispatching", failureReason: null })
      .where(and(eq(campaignRepliesTable.id, reply.id), sql`${campaignRepliesTable.forwardStatus} IN ('pending','failed')`)).returning();
    if (!claimed) return void res.status(202).json({ recorded: true, forwardStatus: reply.forwardStatus });
    let status: "forwarded" | "failed" | "uncertain" = "uncertain";
    let failureReason: string | null = null;
    try {
      if (!dependencies.provider) sgMail.setApiKey(process.env.SENDGRID_API_KEY!);
      const attachments = await Promise.all(claimed.attachments.map(async (a: { path: string; filename: string; contentType: string }) => {
        const [bucket, ...path] = a.path.slice(1).split("/");
        const [bytes] = await objectStorageClient.bucket(bucket).file(path.join("/")).download();
        return { content: bytes.toString("base64"), filename: a.filename, type: a.contentType, disposition: "attachment" as const };
      }));
      await provider.send({
        from: { email: send.fromEmail, name: "MBS campaign reply" }, to: claimed.forwardTo,
        replyTo: { email: claimed.fromEmail, name: claimed.fromEmail },
        subject: `Campaign reply: ${claimed.subject}`,
        text: `From: ${claimed.fromEmail}\nSubject: ${claimed.subject}\n\n${claimed.bodyText}`,
        ...(attachments.length ? { attachments } : {}),
        headers: { "X-MBS-Forwarded-Reply": String(claimed.id), "Auto-Submitted": "auto-generated" },
        trackingSettings: { clickTracking: { enable: false, enableText: false }, openTracking: { enable: false } },
      });
      status = "forwarded";
    } catch (error) {
      const code = Number((error as any)?.response?.statusCode ?? (error as any)?.code);
      status = Number.isInteger(code) && code >= 400 && code < 500 ? "failed" : "uncertain";
      failureReason = status === "failed" ? "Provider rejected the forward; safe to retry on redelivery" : "Forward outcome is uncertain; automatic retry is blocked";
    }
    await db.transaction(async (tx: any) => {
      await tx.update(campaignRepliesTable).set({ forwardStatus: status, failureReason, ...(status === "forwarded" ? { forwardedAt: new Date() } : {}) }).where(eq(campaignRepliesTable.id, claimed.id));
      await tx.update(activityLogTable).set({
        details: { replyId: claimed.id, campaignId: claimed.campaignId, fromEmail: claimed.fromEmail, subject: claimed.subject, bodyText: claimed.bodyText, forwardStatus: status, failureReason },
      }).where(and(eq(activityLogTable.action, "campaign_reply_received"), sql`${activityLogTable.details}->>'replyId' = ${String(claimed.id)}`));
    });
    res.status(status === "failed" ? 503 : 202).json({ recorded: true, forwardStatus: status });
  } catch (error) {
    req.log.error({ err: error }, "Inbound campaign reply processing failed");
    res.status(503).json({ error: "Reply processing unavailable; safe to redeliver" });
  }
});
return router;
}
export default createCampaignRepliesRouter();
