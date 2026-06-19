import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { emailSendsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logActivity } from "../lib/activityHelper";

const router = Router();

const SENDGRID_WEBHOOK_KEY = process.env["SENDGRID_WEBHOOK_KEY"];

// POST /api/sendgrid/webhook — receives SendGrid event payloads
// Events: delivered, opened, clicked, bounce, unsubscribe, spamreport
router.post("/sendgrid/webhook", async (req: Request, res: Response) => {
  // Basic validation: only process if signature key is set and matches
  if (SENDGRID_WEBHOOK_KEY) {
    const sig = req.headers["x-twilio-email-event-webhook-signature"] as string;
    const ts = req.headers["x-twilio-email-event-webhook-timestamp"] as string;
    if (!sig || !ts) {
      return void res.status(403).json({ error: "Missing signature" });
    }
    // Full ECDSA verification would go here (requires @sendgrid/eventwebhook)
    // For now, just verify timestamp freshness (within 5 minutes)
    const age = Date.now() - parseInt(ts, 10) * 1000;
    if (age > 5 * 60 * 1000) {
      return void res.status(403).json({ error: "Stale webhook" });
    }
  }

  const events: any[] = Array.isArray(req.body) ? req.body : [req.body];

  for (const event of events) {
    const { event: eventType, sg_message_id, timestamp } = event as {
      event: string;
      sg_message_id?: string;
      timestamp?: number;
    };

    if (!sg_message_id) continue;

    // SendGrid appends a filter ID to the message ID; strip it
    const messageId = sg_message_id.split(".")[0];

    const send = await db.query.emailSendsTable.findFirst({
      where: eq(emailSendsTable.sendgridMessageId, messageId!),
    });

    if (!send) continue;

    const eventAt = timestamp ? new Date(timestamp * 1000) : new Date();

    let status: string | undefined;
    let updates: Partial<typeof emailSendsTable.$inferSelect> & Record<string, any> = { updatedAt: new Date() };

    switch (eventType) {
      case "delivered":
        status = "delivered";
        updates.status = "delivered";
        break;
      case "open":
        status = "opened";
        updates.status = "opened";
        updates.openedAt = eventAt;
        break;
      case "click":
        status = "clicked";
        updates.status = "clicked";
        updates.clickedAt = eventAt;
        break;
      case "bounce":
      case "blocked":
        status = "bounced";
        updates.status = "bounced";
        break;
      case "unsubscribe":
      case "group_unsubscribe":
        status = "unsubscribed";
        updates.status = "unsubscribed";
        // Mark lead unsubscribed
        if (send.leadId) {
          const { leadsTable } = await import("@workspace/db");
          await db.update(leadsTable)
            .set({ isUnsubscribed: true, updatedAt: new Date() })
            .where(eq(leadsTable.id, send.leadId));
        }
        break;
      default:
        continue;
    }

    await db.update(emailSendsTable).set(updates as any).where(eq(emailSendsTable.id, send.id));

    if (send.leadId && (eventType === "open" || eventType === "click")) {
      await logActivity({
        userId: send.userId,
        leadId: send.leadId,
        action: eventType === "open" ? "email_opened" : "email_clicked",
        entityType: "email_send",
        entityId: send.id,
        details: { subject: send.subject, event: eventType },
      });
    }
  }

  res.json({ ok: true });
});

export default router;
