import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { leadsTable } from "./leads";
import { usersTable } from "./users";

export const leadStatusHistoryTable = pgTable(
  "lead_status_history",
  {
    id: serial("id").primaryKey(),
    leadId: integer("lead_id").notNull().references(() => leadsTable.id, { onDelete: "cascade" }),
    changedByUserId: integer("changed_by_user_id").references(() => usersTable.id),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("status_history_lead_idx").on(t.leadId)],
);

export type LeadStatusHistory = typeof leadStatusHistoryTable.$inferSelect;
