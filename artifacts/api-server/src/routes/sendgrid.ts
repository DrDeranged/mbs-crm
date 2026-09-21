import { Router, type Request, type Response } from "express";
import { EventWebhook } from "@sendgrid/eventwebhook";
import { createHash } from "crypto";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import {
  emailSendsTable,
  emailWebhookEventsTable,
  activityLogTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { logActivity } from "../lib/activityHelper";
import { suppressEmail } from "../lib/emailSafety";
import { canAdvanceEmailStatus, classifySendGridEvent, webhookSuppressionEffects } from "../lib/emailSafetyPredicates";
import { logger } from "../lib/logger";

const router = Router();
const sendGridEvent = z.object({
  event: z.string().optional(),
  sg_message_id: z.unknown().optional(),
  "smtp-id": z.unknown().optional(),
  message_id: z.unknown().optional(),
  sg_event_id: z.unknown().optional(),
  event_id: z.unknown().optional(),
  timestamp: z.union([z.number().finite(), z.string().regex(/^\d+(?:\.\d+)?$/)]).optional(),
  email: z.string().email().optional(),
}).passthrough();
const sendGridWebhookBody = z.union([sendGridEvent, z.array(sendGridEvent).min(1)]);

function verifySendGridSignature(req: Request): boolean {
  // A webhook without the public verification key cannot be authenticated.
  // Fail closed in every environment so a staging/test configuration can
  // never normalize an unsigned request as a valid provider callback.
  const verificationKey = process.env["SENDGRID_WEBHOOK_VERIFICATION_KEY"];
  const signature = req.headers["x-twilio-email-event-webhook-signature"] as string;
  const timestamp = req.headers["x-twilio-email-event-webhook-timestamp"] as string;
  const rawBody: Buffer | undefined = (req as any).rawBody;
  if (!verificationKey || !signature || !timestamp || !rawBody) {
    logger.warn({
      route: "/api/sendgrid/webhook",
      reason: !verificationKey
        ? "verification_key_missing"
        : !signature
          ? "signature_header_missing"
          : !timestamp
            ? "timestamp_header_missing"
            : "raw_body_missing",
      hasSignatureHeader: !!signature,
      hasTimestampHeader: !!timestamp,
      hasRawBody: !!rawBody,
      rawBodyBytes: rawBody?.length ?? 0,
    }, "SendGrid webhook signature rejected");
    return false;
  }
  try {
    const ew = new EventWebhook();
    const publicKey = ew.convertPublicKeyToECDSA(verificationKey);
    const valid = ew.verifySignature(publicKey, rawBody, signature, timestamp);
    if (!valid) {
      const alternatePayloads: Array<[string, string | Buffer]> = [
        ["json_reserialized", JSON.stringify(req.body)],
        ["trailing_lf_added", Buffer.concat([rawBody, Buffer.from("\n")])],
        ["trailing_crlf_added", Buffer.concat([rawBody, Buffer.from("\r\n")])],
      ];
      const matchedPayloadVariant = alternatePayloads.find(([, payload]) => {
        try {
          return ew.verifySignature(publicKey, payload, signature, timestamp);
        } catch {
          return false;
        }
      })?.[0] ?? "none";
      logger.warn({
        route: "/api/sendgrid/webhook",
        reason: "signature_mismatch",
        rawBodyBytes: rawBody.length,
        contentLengthHeader: req.headers["content-length"] ?? null,
        contentEncodingHeader: req.headers["content-encoding"] ?? null,
        verificationKeyFingerprint: createHash("sha256").update(verificationKey.trim()).digest("hex").slice(0, 16),
        matchedPayloadVariant,
      }, "SendGrid webhook signature rejected");
    }
    return valid;
  } catch {
    logger.warn({
      route: "/api/sendgrid/webhook",
      reason: "verification_error",
      rawBodyBytes: rawBody.length,
    }, "SendGrid webhook signature rejected");
    return false;
  }
}

function normalizeMessageId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/^<|>$/g, "");
  if (!cleaned) return null;
  // SendGrid webhook IDs may include a filter suffix.
  return cleaned.split(".")[0].trim() || null;
}

type WebhookSend = {
  id: number;
  leadId: number | null;
  userId: number | null;
  subject: string;
  toEmail: string;
  status: typeof emailSendsTable.$inferSelect["status"];
  openedAt?: Date | null;
  clickedAt?: Date | null;
};
type WebhookRepository = {
  insertEvent: (event: { eventId: string; eventType: string; messageId: string | null }) => Promise<boolean>;
  findSend: (messageId: string | null) => Promise<WebhookSend | undefined>;
  suppressRecipient: (email: string) => Promise<void>;
  updateSend: (send: WebhookSend, updates: Record<string, unknown>) => Promise<void>;
  hasActivity: (send: WebhookSend, action: string) => Promise<boolean>;
  logActivity: (send: WebhookSend, action: string, details: Record<string, unknown>) => Promise<void>;
};

const productionRepository: WebhookRepository = {
  async insertEvent({ eventId, eventType, messageId }) {
    const inserted = await db.insert(emailWebhookEventsTable)
      .values({ eventId, eventType, messageId })
      .onConflictDoNothing({ target: emailWebhookEventsTable.eventId })
      .returning({ id: emailWebhookEventsTable.id });
    return inserted.length > 0;
  },
  async findSend(messageId) {
    if (!messageId) return undefined;
    const candidates = [messageId, `<${messageId}>`, `${messageId}.filter`, `<${messageId}.filter>`];
    return db.query.emailSendsTable.findFirst({
      where: inArray(emailSendsTable.sendgridMessageId, candidates),
    });
  },
  async suppressRecipient(email) {
    await suppressEmail(email);
  },
  async updateSend(send, updates) {
    await db.update(emailSendsTable)
      .set(updates)
      .where(and(eq(emailSendsTable.id, send.id), eq(emailSendsTable.status, send.status)));
  },
  async hasActivity(send, action) {
    if (!send.leadId) return true;
    return !!await db.query.activityLogTable.findFirst({
      where: and(
        eq(activityLogTable.action, action),
        eq(activityLogTable.entityType, "email_send"),
        eq(activityLogTable.entityId, String(send.id)),
      ),
    });
  },
  async logActivity(send, action, details) {
    if (!send.leadId) return;
    await logActivity({
      userId: send.userId,
      leadId: send.leadId,
      action,
      entityType: "email_send",
      entityId: send.id,
      details: { subject: send.subject, ...details },
    });
  },
};

export async function processSendGridWebhookEvents(
  events: Array<z.infer<typeof sendGridEvent>>,
  repository: WebhookRepository = productionRepository,
): Promise<{ processed: number; ignored: number }> {
  let processed = 0;
  let ignored = 0;
  for (const event of events) {
    const eventType = typeof event.event === "string" ? event.event : "";
    if (!eventType) {
      ignored++;
      continue;
    }
    const messageId = normalizeMessageId(event.sg_message_id ?? event["smtp-id"] ?? event.message_id);
    const eventId = String(
      event.sg_event_id ??
      event.event_id ??
      createHash("sha256").update(JSON.stringify({ eventType, messageId, event })).digest("hex"),
    );
    if (!await repository.insertEvent({ eventId, eventType, messageId })) {
      ignored++;
      continue;
    }
    const send = await repository.findSend(messageId);
    const eventAt = event.timestamp ? new Date(Number(event.timestamp) * 1000) : new Date();
    const classification = (
      eventType === "bounce" || eventType === "dropped" || eventType === "spamreport" || eventType === "unsubscribe"
        ? webhookSuppressionEffects(eventType)
        : classifySendGridEvent(eventType)
    );
    // Once the provider message ID is correlated, the persisted recipient is
    // authoritative. A signed event with a mismatched email must never
    // suppress an unrelated address/lead.
    const recipient = send?.toEmail ?? (typeof event.email === "string" ? event.email : undefined);
    if (classification.suppress && recipient) await repository.suppressRecipient(recipient);
    if (!send || !classification.status || !classification.action) {
      ignored++;
      continue;
    }
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (eventType === "open" && !send.openedAt && !["bounced", "unsubscribed", "failed"].includes(send.status)) {
      updates.openedAt = eventAt;
    }
    if (eventType === "click" && !send.clickedAt && !["bounced", "unsubscribed", "failed"].includes(send.status)) {
      updates.clickedAt = eventAt;
    }
    if (canAdvanceEmailStatus(send.status, classification.status) || updates.openedAt || updates.clickedAt) {
      updates.status = canAdvanceEmailStatus(send.status, classification.status) ? classification.status : send.status;
      await repository.updateSend(send, updates);
    }
    const firstEngagement = eventType === "open" ? !send.openedAt : eventType === "click" ? !send.clickedAt : true;
    if (firstEngagement && !await repository.hasActivity(send, classification.action)) {
      await repository.logActivity(send, classification.action, eventType === "open" || eventType === "click"
        ? { event: eventType, at: eventAt.toISOString() }
        : { event: eventType });
    }
    processed++;
  }
  return { processed, ignored };
}

export function createSendGridWebhookHandler({
  verifySignature = verifySendGridSignature,
  processEvents = processSendGridWebhookEvents,
}: {
  verifySignature?: (req: Request) => boolean;
  processEvents?: (events: Array<z.infer<typeof sendGridEvent>>) => Promise<{ processed: number; ignored: number }>;
} = {}) {
  return async (req: Request, res: Response) => {
  if (!verifySignature(req)) {
    return void res.status(401).json({ error: "Invalid webhook signature" });
  }
  const body = sendGridWebhookBody.safeParse(req.body);
  if (!body.success) {
    const field = body.error.issues[0]?.path.join(".") || "body";
    return void res.status(400).json({ error: `Invalid ${field}` });
  }
  const events = Array.isArray(body.data) ? body.data : [body.data];
  const result = await processEvents(events);
  res.json({ ok: true, ...result });
  };
}

router.post("/sendgrid/webhook", createSendGridWebhookHandler());

export default router;
