import { pgTable, serial, text, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const LEAD_STATUSES = [
  "new_lead",
  "contacted",
  "application_received",
  "submitted_to_underwriting",
  "approved",
  "funded",
  "declined",
  "follow_up",
] as const;

export const APPLICATION_TYPES = ["equipment", "working_capital"] as const;
export const LEAD_SOURCES = ["website", "referral", "import", "manual"] as const;

export const leadsTable = pgTable(
  "leads",
  {
    id: serial("id").primaryKey(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    email: text("email"),
    phone: text("phone"),
    companyName: text("company_name"),
    ein: text("ein"),
    applicationType: text("application_type", { enum: APPLICATION_TYPES }).notNull().default("working_capital"),
    status: text("status", { enum: LEAD_STATUSES }).notNull().default("new_lead"),
    assignedRepId: integer("assigned_rep_id").references(() => usersTable.id, { onDelete: "set null" }),
    leadSource: text("lead_source", { enum: LEAD_SOURCES }).notNull().default("manual"),
    isUnsubscribed: boolean("is_unsubscribed").notNull().default(false),
    requestedAmount: integer("requested_amount"),
    creditScore: integer("credit_score"),
    existingPositions: integer("existing_positions"),
    lastActivityAt: timestamp("last_activity_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("leads_email_idx").on(t.email),
    index("leads_phone_idx").on(t.phone),
    index("leads_ein_idx").on(t.ein),
    index("leads_status_idx").on(t.status),
    index("leads_rep_idx").on(t.assignedRepId),
  ],
);

export const insertLeadSchema = createInsertSchema(leadsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leadsTable.$inferSelect;
