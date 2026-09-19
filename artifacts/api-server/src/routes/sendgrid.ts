import { Router, type Request, type Response } from "express";
import { EventWebhook } from "@sendgrid/eventwebhook";
import { createHash } from "crypto";
import { db } from "@workspace/db";
import {
  emailSendsTable,
  emailWebhookEventsTable,
  activityLogTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { logActivity } from "../lib/activityHelper";
import { suppressEmail } from "../lib/emailSafety";
import { canAdvanceEmailStatus, classifySendGridEvent } from "../lib/emailSafetyPredicates";

const router = Router();

function verifySendGridSignature(req: Request): boolean {
  // A webhook without the public verification key cannot be authenticated.
  // Fail closed in every environment so a staging/test configuration can
  // never normalize an unsigned request as a valid provider callback.
  const verificationKey = process.env["SENDGRID_WEBHOOK_VERIFICATION_KEY"];
  if (!verificationKey) return false;
  const signature = req.headers["x-twilio-email-event-webhook-signature"] as string;
  const timestamp = req.headers["x-twilio-email-event-webhook-timestamp"] as string;
  const rawBody: Buffer | undefined = (req as any).rawBody;
  if (!signature || !timestamp || !rawBody) return false;
  try {
    const ew = new EventWebhook();
    const publicKey = ew.convertPublicKeyToECDSA(verificationKey);
    return ew.verifySignature(publicKey, rawBody, signature, timestamp);
  } catch {
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

async function logOnce(send: any, action: string, details: Record<string, unknown>): Promise<void> {
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

async function findSend(messageId: string | null): Promise<any | undefined> {
  if (!messageId) return undefined;
  const candidates = [messageId, `<${messageId}>`, `${messageId}.filter`, `<${messageId}.filter>`];
  return db.query.emailSendsTable.findFirst({
    where: inArray(emailSendsTable.sendgridMessageId, candidates),
  });
}

router.post("/sendgrid/webhook", async (req: Request, res: Response) => {
  if (!verifySendGridSignature(req)) {
    return void res.status(403).json({ error: "Invalid webhook signature" });
  }
  const events: any[] = Array.isArray(req.body) ? req.body : [req.body];
  let processed = 0;
  let ignored = 0;

  for (const event of events) {
    const eventType = typeof event?.event === "string" ? event.event : "";
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
    // The unique index makes retries and duplicate entries in one batch safe.
    const inserted = await db.insert(emailWebhookEventsTable)
      .values({ eventId, eventType, messageId })
      .onConflictDoNothing({ target: emailWebhookEventsTable.eventId })
      .returning({ id: emailWebhookEventsTable.id });
    if (!inserted.length) {
      ignored++;
      continue;
    }

    const send = await findSend(messageId);
    const eventAt = event.timestamp ? new Date(Number(event.timestamp) * 1000) : new Date();
    const classification = classifySendGridEvent(eventType);
    const suppressingEvent = classification.suppress;
    const recipient = typeof event.email === "string" ? event.email : send?.toEmail;
    if (suppressingEvent && recipient) await suppressEmail(recipient);
    if (!send) {
      // Suppression is still applied when message correlation is unavailable.
      ignored++;
      continue;
    }

    let nextStatus: string | null = classification.status;
    let action: string | null = classification.action;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (!nextStatus || !action) {
      ignored++;
      continue;
    }
    if (eventType === "open" && !send.openedAt && !["bounced", "unsubscribed", "failed"].includes(send.status)) {
      updates.openedAt = eventAt;
    }
    if (eventType === "click" && !send.clickedAt && !["bounced", "unsubscribed", "failed"].includes(send.status)) {
      updates.clickedAt = eventAt;
    }

    if (nextStatus && (canAdvanceEmailStatus(send.status, nextStatus) || updates.openedAt || updates.clickedAt)) {
      updates.status = canAdvanceEmailStatus(send.status, nextStatus) ? nextStatus : send.status;
      await db.update(emailSendsTable)
        .set(updates)
        .where(and(eq(emailSendsTable.id, send.id), eq(emailSendsTable.status, send.status)));
    }
    if (action && (eventType === "open" || eventType === "click")) {
      // openedAt/clickedAt and the activity key together make provider/custom
      // tracking idempotent; duplicate provider callbacks do not add logs.
      const firstEvent = eventType === "open" ? !send.openedAt : !send.clickedAt;
      if (firstEvent) await logOnce(send, action, { event: eventType, at: eventAt.toISOString() });
    } else if (action) {
      await logOnce(send, action, { event: eventType });
    }
    processed++;
  }
  res.json({ ok: true, processed, ignored });
});

export default router;
