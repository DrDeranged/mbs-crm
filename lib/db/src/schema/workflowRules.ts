import { pgTable, serial, integer, text, boolean, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const workflowRulesTable = pgTable(
  "workflow_rules",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    triggerStatus: text("trigger_status").notNull(),
    actionType: text("action_type", { enum: ["create_task", "send_notification"] }).notNull(),
    actionConfig: jsonb("action_config").notNull().default({}),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("workflow_rules_trigger_status_idx").on(t.triggerStatus),
    index("workflow_rules_is_active_idx").on(t.isActive),
  ],
);

export type WorkflowRule = typeof workflowRulesTable.$inferSelect;
export type InsertWorkflowRule = typeof workflowRulesTable.$inferInsert;
