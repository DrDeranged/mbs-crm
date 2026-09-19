import { pgTable, serial, integer, text, timestamp, uniqueIndex, foreignKey } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { notificationsTable } from "./notifications";

/**
 * Durable idempotency keys for notifications whose delivery is scheduled or
 * retried.  The unique key is deliberately scoped to the recipient.
 */
export const notificationDeliveryClaimsTable = pgTable("notification_delivery_claims", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  event: text("event").notNull(),
  scopeKey: text("scope_key").notNull(),
  periodKey: text("period_key").notNull(),
  notificationId: integer("notification_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("notification_delivery_claims_unique").on(t.userId, t.event, t.scopeKey, t.periodKey),
  foreignKey({
    columns: [t.notificationId],
    foreignColumns: [notificationsTable.id],
    name: "notification_delivery_claims_notification_id_notifications_id_f",
  }).onDelete("set null"),
]);

export type NotificationDeliveryClaim = typeof notificationDeliveryClaimsTable.$inferSelect;