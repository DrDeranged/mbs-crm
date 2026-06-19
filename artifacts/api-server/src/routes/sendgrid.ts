import { Router, type Request, type Response } from "express";
import { EventWebhook } from "@sendgrid/eventwebhook";
import { db } from "@workspace/db";
import { emailSendsTable, leadsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logActivity } from "../lib/activityHelper";

const router = Router();

const SENDGRID_WEBHOOK_VERIFICATION_KEY = process.env["SENDGRID_WEBHOOK_VERIFICATION_KEY"];

const IS_PROD = process.env["NODE_ENV"] === "production";

function verifySendGridSignature(req: Request): boolean {
  if (!SENDGRID_WEBHOOK_VERIFICATION_KEY) {
    // In production, fail closed — require the key to be set
    if (IS_PROD) return false;
    // In dev, skip verification so local testing works without real keys
    return true;
  }

  const signature = req.headers["x-twilio-email-event-webhook-signature"] as string;
  const timestamp = req.headers["x-twilio-email-event-webhook-timestamp"] as string;

  if (!signature || !timestamp) return false;

  const rawBody: Buffer | undefined = (req as any).rawBody;
  if (!rawBody) return false;

  try {
    const ew = new EventWebhook();
    const ecPublicKey = ew.convertPublicKeyToECDSA(SENDGRID_WEBHOOK_VERIFICATION_KEY);
    return ew.verifySignature(ecPublicKey, rawBody, signature, timestamp);
  } catch {
    return false;
  }
}

// POST /api/sendgrid/webhook — receives SendGrid event payloads
router.post("/sendgrid/webhook", async (req: Request, res: Response) => {
  if (!verifySendGridSignature(req)) {
    return void res.status(403).json({ error: "Invalid webhook signature" });
  }

  const events: any[] = Array.isArray(req.body) ? req.body : [req.body];

  for (const event of events) {
    const { event: eventType, sg_message_id, timestamp } = event as {
      event: string;
      sg_message_id?: string;
      timestamp?: number;
    };

    if (!sg_message_id || !eventType) continue;

    // SendGrid appends a filter ID after a dot — strip it
    const messageId = sg_message_id.split(".")[0];

    const send = await db.query.emailSendsTable.findFirst({
      where: eq(emailSendsTable.sendgridMessageId, messageId!),
    });

    if (!send) continue;

    const eventAt = timestamp ? new Date(timestamp * 1000) : new Date();

    let updates: Record<string, any> = { updatedAt: new Date() };
    let activityAction: string | null = null;

    switch (eventType) {
      case "delivered":
        updates.status = "delivered";
        activityAction = "email_delivered";
        break;
      case "open":
        // Only upgrade if not already at a higher-engagement state
        if (send.status !== "clicked") {
          updates.status = "opened";
          updates.openedAt = eventAt;
        }
        activityAction = "email_opened";
        break;
      case "click":
        updates.status = "clicked";
        updates.clickedAt = eventAt;
        activityAction = "email_clicked";
        break;
      case "bounce":
      case "blocked":
        updates.status = "bounced";
        activityAction = "email_bounced";
        break;
      case "unsubscribe":
      case "group_unsubscribe":
        updates.status = "unsubscribed";
        activityAction = "email_unsubscribed";
        // Mark lead as unsubscribed
        if (send.leadId) {
          await db.update(leadsTable)
            .set({ isUnsubscribed: true, updatedAt: new Date() })
            .where(eq(leadsTable.id, send.leadId));
        }
        break;
      case "spamreport":
        updates.status = "bounced";
        activityAction = "email_spam_reported";
        // Also mark lead unsubscribed on spam report
        if (send.leadId) {
          await db.update(leadsTable)
            .set({ isUnsubscribed: true, updatedAt: new Date() })
            .where(eq(leadsTable.id, send.leadId));
        }
        break;
      default:
        continue;
    }

    await db.update(emailSendsTable).set(updates).where(eq(emailSendsTable.id, send.id));

    if (activityAction && send.leadId) {
      await logActivity({
        userId: send.userId,
        leadId: send.leadId,
        action: activityAction,
        entityType: "email_send",
        entityId: send.id,
        details: { subject: send.subject, event: eventType },
      });
    }
  }

  res.json({ ok: true });
});

export default router;
