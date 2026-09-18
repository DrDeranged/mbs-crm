import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { pushSubscriptionsTable } from "./pushSubscriptions";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const pushDeliveryAttemptsTable = pgTable("push_delivery_attempts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  subscriptionId: integer("subscription_id").references(() => pushSubscriptionsTable.id, { onDelete: "set null" }),
  status: text("status").notNull(),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  errorMessage: text("error_message"),
}, (t) => [
  index("push_delivery_attempts_status_time_idx").on(t.status, t.attemptedAt),
  index("push_delivery_attempts_user_idx").on(t.userId),
]);

export const insertPushDeliveryAttemptSchema = createInsertSchema(pushDeliveryAttemptsTable)
  .omit({ id: true, attemptedAt: true });
export type InsertPushDeliveryAttempt = z.infer<typeof insertPushDeliveryAttemptSchema>;
export type PushDeliveryAttempt = typeof pushDeliveryAttemptsTable.$inferSelect;