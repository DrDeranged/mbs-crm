import { pgTable, serial, text, integer, boolean, timestamp, index, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { leadsTable } from "./leads";
import { usersTable } from "./users";

export const SUBMISSION_STATUSES = ["submitted", "pending", "approved", "declined", "withdrawn"] as const;

export const lendersTable = pgTable(
  "lenders",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    programTypes: text("program_types").array().notNull().default([]),
    minAmount: integer("min_amount"),
    maxAmount: integer("max_amount"),
    minCreditScore: integer("min_credit_score"),
    acceptedIndustries: text("accepted_industries").array().notNull().default([]),
    minTimeInBusinessMonths: integer("min_time_in_business_months").notNull().default(0),
    acceptedStates: text("accepted_states").array().notNull().default([]),
    maxExistingPositions: integer("max_existing_positions").notNull().default(10),
    priorityWeight: integer("priority_weight").notNull().default(5),
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("lenders_active_idx").on(t.isActive)],
);

export const lenderMatchesTable = pgTable(
  "lender_matches",
  {
    id: serial("id").primaryKey(),
    leadId: integer("lead_id").notNull().references(() => leadsTable.id, { onDelete: "cascade" }),
    lenderId: integer("lender_id").notNull().references(() => lendersTable.id, { onDelete: "cascade" }),
    matchScore: integer("match_score").notNull(),
    criteriaBreakdown: jsonb("criteria_breakdown").notNull().default([]),
    matchedAt: timestamp("matched_at").notNull().defaultNow(),
  },
  (t) => [
    index("lender_matches_lead_idx").on(t.leadId),
    index("lender_matches_lender_idx").on(t.lenderId),
  ],
);

export const lenderSubmissionsTable = pgTable(
  "lender_submissions",
  {
    id: serial("id").primaryKey(),
    leadId: integer("lead_id").notNull().references(() => leadsTable.id, { onDelete: "cascade" }),
    lenderId: integer("lender_id").notNull().references(() => lendersTable.id, { onDelete: "cascade" }),
    submittedBy: integer("submitted_by").references(() => usersTable.id, { onDelete: "set null" }),
    status: text("status", { enum: SUBMISSION_STATUSES }).notNull().default("submitted"),
    responseNotes: text("response_notes"),
    submittedAt: timestamp("submitted_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("lender_submissions_lead_idx").on(t.leadId),
    index("lender_submissions_lender_idx").on(t.lenderId),
  ],
);

export const insertLenderSchema = createInsertSchema(lendersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLender = z.infer<typeof insertLenderSchema>;
export type Lender = typeof lendersTable.$inferSelect;
export type LenderMatch = typeof lenderMatchesTable.$inferSelect;
export type LenderSubmission = typeof lenderSubmissionsTable.$inferSelect;
