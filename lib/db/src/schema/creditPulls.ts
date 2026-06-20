import {
  pgTable, serial, integer, text, timestamp, jsonb, index,
} from "drizzle-orm/pg-core";
import { leadsTable } from "./leads";
import { usersTable } from "./users";

export const creditPullsTable = pgTable(
  "credit_pulls",
  {
    id: serial("id").primaryKey(),
    leadId: integer("lead_id").notNull().references(() => leadsTable.id, { onDelete: "cascade" }),
    pulledBy: integer("pulled_by").notNull().references(() => usersTable.id),
    pullType: text("pull_type", { enum: ["soft", "hard"] }).notNull(),
    consentCapturedAt: timestamp("consent_captured_at"),
    consentIp: text("consent_ip"),
    creditScore: integer("credit_score"),
    reportSummary: jsonb("report_summary"),
    requestPayloadEncrypted: text("request_payload_encrypted"),
    responsePayloadEncrypted: text("response_payload_encrypted"),
    status: text("status", { enum: ["pending", "completed", "error"] }).notNull().default("pending"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("credit_pulls_lead_idx").on(t.leadId)],
);

export const creditComplianceLogTable = pgTable(
  "credit_compliance_log",
  {
    id: serial("id").primaryKey(),
    creditPullId: integer("credit_pull_id").references(() => creditPullsTable.id),
    leadId: integer("lead_id").notNull().references(() => leadsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id").notNull().references(() => usersTable.id),
    action: text("action").notNull(),
    permissiblePurpose: text("permissible_purpose").notNull(),
    details: jsonb("details"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("credit_compliance_log_lead_idx").on(t.leadId), index("credit_compliance_log_user_idx").on(t.userId)],
);

export type CreditPull = typeof creditPullsTable.$inferSelect;
export type CreditComplianceLog = typeof creditComplianceLogTable.$inferSelect;
