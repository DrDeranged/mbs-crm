import { sql } from "drizzle-orm";
import { pgTable, serial, text, integer, boolean, timestamp, index, jsonb, uniqueIndex, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { lendersTable } from "./lenders";

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
export const LEAD_SOURCES = ["website", "referral", "import", "manual", "qr-card", "usfundadvisor", "inbound-call"] as const;

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
    consentCreditPullAt: timestamp("consent_credit_pull_at"),
    consentIp: text("consent_ip"),
    lastActivityAt: timestamp("last_activity_at"),
    leadScore: integer("lead_score"),
    leadScoreBreakdown: jsonb("lead_score_breakdown"),
    aiSummary: jsonb("ai_summary"),
    aiSummaryGeneratedAt: timestamp("ai_summary_generated_at"),
    packageConfig: jsonb("package_config"),
    fundedAt: timestamp("funded_at"),
    fundedAmount: integer("funded_amount"),
    estimatedTermMonths: integer("estimated_term_months"),
    renewalFlaggedAt: timestamp("renewal_flagged_at"),
    trackingToken: text("tracking_token").unique(),
    referredByPartnerId: integer("referred_by_partner_id").references(
      () => lendersTable.id,
      { onDelete: "set null" },
    ),
    referralSplitPct: numeric("referral_split_pct", { precision: 5, scale: 2 }),
    externalId: text("external_id"),
    creditScoreBand: text("credit_score_band"),
    monthlyRevenueBand: text("monthly_revenue_band"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("leads_email_idx").on(t.email),
    index("leads_phone_idx").on(t.phone),
    index("leads_ein_idx").on(t.ein),
    index("leads_status_idx").on(t.status),
    index("leads_rep_idx").on(t.assignedRepId),
    index("leads_renewal_flagged_idx").on(t.renewalFlaggedAt),
    uniqueIndex("leads_external_id_unique_idx")
      .on(t.externalId)
      .where(sql`${t.externalId} IS NOT NULL`),
    index("leads_normalized_email_idx").on(sql`lower(trim(${t.email}))`),
  ],
);

export const insertLeadSchema = createInsertSchema(leadsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leadsTable.$inferSelect;
