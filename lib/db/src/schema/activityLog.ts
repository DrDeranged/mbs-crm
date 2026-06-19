import { pgTable, serial, integer, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { leadsTable } from "./leads";

export const activityLogTable = pgTable(
  "activity_log",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => usersTable.id),
    leadId: integer("lead_id").references(() => leadsTable.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    details: jsonb("details"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("activity_lead_idx").on(t.leadId),
    index("activity_user_idx").on(t.userId),
    index("activity_created_idx").on(t.createdAt),
  ],
);

export type ActivityLog = typeof activityLogTable.$inferSelect;
