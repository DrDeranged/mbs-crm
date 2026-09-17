import { sql } from "drizzle-orm";
import { pgTable, serial, text, integer, boolean, timestamp, index, jsonb, check, uniqueIndex, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { leadsTable } from "./leads";
import { usersTable } from "./users";
import { dealsTable } from "./deals";

export const SUBMISSION_STATUSES = ["submitted", "approved", "declined", "funded", "withdrawn"] as const;
export const PARTNER_TYPES = ["direct_lender", "broker_out", "broker_in"] as const;
export const SUBMISSION_METHODS = ["email", "portal", "both"] as const;
export const PARTNER_CONTACT_ROLES = ["rep", "submissions", "credit", "docs", "funding", "other"] as const;
export type TruckingRule = {
  industry: "long_haul" | "local" | "any";
  prohibited?: boolean;
  minTrucks?: number;
  minTimeInBusinessMonths?: number;
  requiresNoFactoring?: boolean;
};
export type IndustryTimeInBusinessOverride = {
  industry: string;
  minTimeInBusinessMonths: number;
};
export type ProgramEligibilityRule = {
  programType: string;
  minMonthlyRevenue?: number;
  restrictedIndustryMinMonthlyRevenue?: number;
  restrictedIndustries?: string[];
  prohibitedIndustries?: string[];
  truckingRules?: TruckingRule[];
};

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
    restrictedIndustries: text("restricted_industries").array().notNull().default([]),
    prohibitedIndustries: text("prohibited_industries").array().notNull().default([]),
    minMonthlyRevenue: integer("min_monthly_revenue"),
    restrictedIndustryMinMonthlyRevenue: integer("restricted_industry_min_monthly_revenue"),
    startupMinCreditScore: integer("startup_min_credit_score"),
    startupMaxTimeInBusinessMonths: integer("startup_max_time_in_business_months"),
    startupMaxAmount: integer("startup_max_amount"),
    minIndustryExperienceMonths: integer("min_industry_experience_months"),
    requiresFinancialStatements: boolean("requires_financial_statements").notNull().default(false),
    truckingRules: jsonb("trucking_rules").$type<TruckingRule[] | null>(),
    industryTimeInBusinessOverrides: jsonb("industry_time_in_business_overrides")
      .$type<IndustryTimeInBusinessOverride[] | null>(),
    programEligibilityRules: jsonb("program_eligibility_rules")
      .$type<ProgramEligibilityRule[] | null>(),
    minTimeInBusinessMonths: integer("min_time_in_business_months").default(0),
    acceptedStates: text("accepted_states").array().notNull().default([]),
    maxExistingPositions: integer("max_existing_positions").notNull().default(10),
    priorityWeight: integer("priority_weight").notNull().default(5),
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    address: text("address"),
    phone: text("phone"),
    website: text("website"),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    partnerType: text("partner_type", { enum: PARTNER_TYPES }).notNull().default("direct_lender"),
    referralSplitPct: numeric("referral_split_pct", { precision: 5, scale: 2 }),
    submissionMethod: text("submission_method", { enum: SUBMISSION_METHODS }).notNull().default("email"),
    portalUrl: text("portal_url"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("lenders_active_idx").on(t.isActive),
    check("lenders_partner_type_check", sql`${t.partnerType} IN ('direct_lender', 'broker_out', 'broker_in')`),
    check("lenders_submission_method_check", sql`${t.submissionMethod} IN ('email', 'portal', 'both')`),
    check(
      "lenders_referral_split_check",
      sql`(${t.partnerType} = 'broker_in' AND ${t.referralSplitPct} BETWEEN 0 AND 100) OR (${t.partnerType} <> 'broker_in' AND ${t.referralSplitPct} IS NULL)`,
    ),
  ],
);

export const partnerContactsTable = pgTable(
  "partner_contacts",
  {
    id: serial("id").primaryKey(),
    partnerId: integer("partner_id").notNull().references(() => lendersTable.id, { onDelete: "cascade" }),
    role: text("role", { enum: PARTNER_CONTACT_ROLES }).notNull().default("rep"),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    isPrimary: boolean("is_primary").notNull().default(false),
    notes: text("notes"),
    smsOptedOut: boolean("sms_opted_out").notNull().default(false),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("partner_contacts_partner_idx").on(t.partnerId),
    index("partner_contacts_primary_idx").on(t.partnerId, t.isPrimary),
    check("partner_contacts_role_check", sql`${t.role} IN ('rep', 'submissions', 'credit', 'docs', 'funding', 'other')`),
  ],
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
    dealId: integer("deal_id").references(() => dealsTable.id, { onDelete: "set null" }),
    lenderId: integer("lender_id").notNull().references(() => lendersTable.id, { onDelete: "cascade" }),
    viaBrokerId: integer("via_broker_id").references(() => lendersTable.id, { onDelete: "set null" }),
    endLenderId: integer("end_lender_id").references(() => lendersTable.id, { onDelete: "set null" }),
    sentBy: integer("sent_by").references(() => usersTable.id, { onDelete: "set null" }),
    messageId: text("message_id"),
    packageConfigSnapshot: jsonb("package_config_snapshot"),
    exactPackageKey: text("exact_package_key"),
    exactPackageSha256: text("exact_package_sha256"),
    exactPackageBytes: integer("exact_package_bytes"),
    status: text("status", { enum: SUBMISSION_STATUSES }).notNull().default("submitted"),
    source: text("source", { enum: ["crm", "manual"] as const }).notNull().default("crm"),
    notes: text("notes"),
    decisionDate: timestamp("decision_date"),
    approvalAttachmentKey: text("approval_attachment_key"),
    sentAt: timestamp("sent_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("lender_submissions_lead_idx").on(t.leadId),
    index("lender_submissions_deal_idx").on(t.dealId),
    index("lender_submissions_lender_idx").on(t.lenderId),
    index("lender_submissions_sent_at_idx").on(t.sentAt),
    index("lender_submissions_source_idx").on(t.source),
    check("lender_submissions_status_check", sql`${t.status} IN ('submitted', 'approved', 'declined', 'funded', 'withdrawn')`),
    check("lender_submissions_source_check", sql`${t.source} IN ('crm', 'manual')`),
  ],
);

/** Provider-delivery receipt; intentionally separate from lender submission business statuses. */
export const lenderSubmissionDeliveriesTable = pgTable(
  "lender_submission_deliveries",
  {
    id: serial("id").primaryKey(),
    leadId: integer("lead_id").notNull().references(() => leadsTable.id, { onDelete: "cascade" }),
    lenderId: integer("lender_id").notNull().references(() => lendersTable.id, { onDelete: "cascade" }),
    sentBy: integer("sent_by").references(() => usersTable.id, { onDelete: "set null" }),
    packageConfigSnapshot: jsonb("package_config_snapshot"),
    exactPackageKey: text("exact_package_key").notNull(),
    exactPackageSha256: text("exact_package_sha256").notNull(),
    exactPackageBytes: integer("exact_package_bytes").notNull(),
    state: text("state", { enum: ["pending", "sent", "submitted", "failed", "uncertain"] as const }).notNull(),
    messageId: text("message_id"),
    failureMessage: text("failure_message"),
    windowStartedAt: timestamp("window_started_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("lender_submission_deliveries_lead_lender_idx").on(t.leadId, t.lenderId, t.createdAt.desc()),
    uniqueIndex("lender_submission_deliveries_active_idx")
      .on(t.leadId, t.lenderId)
      .where(sql`${t.state} IN ('pending', 'sent', 'uncertain')`),
    check(
      "lender_submission_deliveries_state_check",
      sql`${t.state} IN ('pending', 'sent', 'submitted', 'failed', 'uncertain')`,
    ),
  ],
);

export const insertLenderSchema = createInsertSchema(lendersTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertPartnerContactSchema = createInsertSchema(partnerContactsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertLender = z.infer<typeof insertLenderSchema>;
export type Lender = typeof lendersTable.$inferSelect;
export type LenderMatch = typeof lenderMatchesTable.$inferSelect;
export type LenderSubmission = typeof lenderSubmissionsTable.$inferSelect;
export type PartnerContact = typeof partnerContactsTable.$inferSelect;
export type InsertPartnerContact = z.infer<typeof insertPartnerContactSchema>;
