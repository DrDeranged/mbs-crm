import { pgTable, serial, integer, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { leadsTable } from "./leads";

export const notificationsTable = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: [
        "lead_assigned",
        "task_due",
        "sms_received",
        "status_changed",
        "credit_pulled",
        "application_received",
        "call_received",
        "renewal_opportunity",
      ],
    }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    leadId: integer("lead_id").references(() => leadsTable.id, { onDelete: "cascade" }),
    isRead: boolean("is_read").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("notifications_user_idx").on(t.userId),
    index("notifications_user_read_idx").on(t.userId, t.isRead),
  ],
);

export type Notification = typeof notificationsTable.$inferSelect;
