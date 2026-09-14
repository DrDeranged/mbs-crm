import { serial, pgTable, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

/** Durable idempotency ledger for SendGrid webhook deliveries. */
export const emailWebhookEventsTable = pgTable(
  "email_webhook_events",
  {
    id: serial("id").primaryKey(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    messageId: text("message_id"),
    receivedAt: timestamp("received_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("email_webhook_events_event_id_uq").on(t.eventId),
    index("email_webhook_events_message_idx").on(t.messageId),
  ],
);

export type EmailWebhookEvent = typeof emailWebhookEventsTable.$inferSelect;