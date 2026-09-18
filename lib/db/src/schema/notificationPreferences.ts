import { pgTable, integer, text, boolean, primaryKey, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const notificationPreferenceEvents = [
  "new_application",
  "new_lead_assigned",
  "lead_replied",
  "submission_status_changed",
  "task_due",
  "stale_lead",
] as const;
export type NotificationPreferenceEvent = typeof notificationPreferenceEvents[number];

export const notificationSettingsTable = pgTable("notification_settings", {
  userId: integer("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  pushEnabled: boolean("push_enabled").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notificationPreferencesTable = pgTable("notification_preferences", {
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  event: text("event", { enum: notificationPreferenceEvents }).notNull(),
  enabled: boolean("enabled").notNull().default(false),
}, (t) => [primaryKey({ columns: [t.userId, t.event] })]);

export const insertNotificationPreferenceSchema = createInsertSchema(notificationPreferencesTable);
export type InsertNotificationPreference = z.infer<typeof insertNotificationPreferenceSchema>;
export type NotificationPreference = typeof notificationPreferencesTable.$inferSelect;
