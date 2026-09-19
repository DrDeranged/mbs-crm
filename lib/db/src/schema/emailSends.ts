import { sql } from "drizzle-orm";
import { pgTable, serial, integer, text, timestamp, index, check } from "drizzle-orm/pg-core";
import { leadsTable } from "./leads";
import { usersTable } from "./users";
import { emailTemplatesTable } from "./emailTemplates";

export const EMAIL_SEND_STATUSES = [
  "queued",
  "failed",
  "sent",
  "delivered",
  "opened",
  "clicked",
  "bounced",
  "unsubscribed",
] as const;

export const emailSendsTable = pgTable(
  "email_sends",
  {
    id: serial("id").primaryKey(),
    leadId: integer("lead_id").references(() => leadsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
    templateId: integer("template_id").references(() => emailTemplatesTable.id, { onDelete: "set null" }),
    subject: text("subject").notNull(),
    toEmail: text("to_email").notNull(),
    fromEmail: text("from_email").notNull(),
    status: text("status", { enum: EMAIL_SEND_STATUSES }).notNull().default("queued"),
    failureReason: text("failure_reason"),
    deliveryKind: text("delivery_kind", { enum: ["direct", "bulk", "drip", "test"] })
      .notNull()
      .default("direct"),
    sendgridMessageId: text("sendgrid_message_id"),
    sentAt: timestamp("sent_at"),
    openedAt: timestamp("opened_at"),
    clickedAt: timestamp("clicked_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("email_sends_lead_idx").on(t.leadId),
    index("email_sends_sgid_idx").on(t.sendgridMessageId),
    index("email_sends_status_idx").on(t.status),
    index("email_sends_daily_marketing_idx").on(t.deliveryKind, t.createdAt),
    check(
      "email_sends_delivery_kind_check",
      sql`${t.deliveryKind} IN ('direct', 'bulk', 'drip', 'test')`,
    ),
  ],
);

export type EmailSend = typeof emailSendsTable.$inferSelect;
