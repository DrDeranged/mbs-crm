import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { leadsTable } from "./leads";

export const PII_FIELD_CATEGORIES = ["ssn", "credit", "application"] as const;
export const PII_ACCESS_ACTIONS = ["view", "export"] as const;

export const piiAccessLogTable = pgTable(
  "pii_access_log",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
    leadId: integer("lead_id").references(() => leadsTable.id, { onDelete: "set null" }),
    fieldCategory: text("field_category", { enum: PII_FIELD_CATEGORIES }).notNull(),
    action: text("action", { enum: PII_ACCESS_ACTIONS }).notNull(),
    ip: text("ip"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("pii_access_log_user_idx").on(t.userId),
    index("pii_access_log_lead_idx").on(t.leadId),
    index("pii_access_log_created_idx").on(t.createdAt),
  ],
);

export type PiiAccessLog = typeof piiAccessLogTable.$inferSelect;
