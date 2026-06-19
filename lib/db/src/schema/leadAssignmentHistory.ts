import { pgTable, serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { leadsTable } from "./leads";
import { usersTable } from "./users";

export const leadAssignmentHistoryTable = pgTable(
  "lead_assignment_history",
  {
    id: serial("id").primaryKey(),
    leadId: integer("lead_id").notNull().references(() => leadsTable.id, { onDelete: "cascade" }),
    changedByUserId: integer("changed_by_user_id").references(() => usersTable.id),
    fromRepId: integer("from_rep_id").references(() => usersTable.id),
    toRepId: integer("to_rep_id").references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("assignment_history_lead_idx").on(t.leadId)],
);

export type LeadAssignmentHistory = typeof leadAssignmentHistoryTable.$inferSelect;
