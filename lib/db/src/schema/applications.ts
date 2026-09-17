import {
  pgTable, serial, integer, text, boolean, timestamp, numeric, index, jsonb, check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { leadsTable } from "./leads";
import { documentsTable } from "./documents";

export const EQUIPMENT_CONDITIONS = ["new", "used"] as const;
export const BUSINESS_TYPES = ["LLC", "Corp", "Sole Prop", "Partnership", "Other"] as const;
export const ESTIMATED_CREDIT_SCORE_BANDS = [
  "below_500",
  "500_549",
  "550_599",
  "600_649",
  "650_699",
  "700_plus",
] as const;

export const applicationsTable = pgTable(
  "applications",
  {
    id: serial("id").primaryKey(),
    leadId: integer("lead_id").notNull().references(() => leadsTable.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["equipment", "working_capital"] }).notNull(),
    // Business info
    businessName: text("business_name").notNull(),
    dba: text("dba"),
    ein: text("ein"),
    businessAddress: text("business_address"),
    businessCity: text("business_city"),
    businessState: text("business_state"),
    businessZip: text("business_zip"),
    industry: text("industry"),
    businessType: text("business_type", { enum: BUSINESS_TYPES }),
    annualRevenue: numeric("annual_revenue", { precision: 15, scale: 2 }),
    businessStartDate: text("business_start_date"),
    yearsUnderCurrentOwnership: integer("years_under_current_ownership"),
    businessDescription: text("business_description"),
    estCreditScore: text("est_credit_score", { enum: ESTIMATED_CREDIT_SCORE_BANDS }),
    timelineFundsNeeded: text("timeline_funds_needed"),
    timeInBusinessMonths: integer("time_in_business_months"),
    monthlyRevenueStated: integer("monthly_revenue_stated"),
    requestedAmount: integer("requested_amount"),
    useOfFunds: text("use_of_funds"),
    // Equipment-only fields
    equipmentDescription: text("equipment_description"),
    vendorName: text("vendor_name"),
    vendorQuoteAmount: numeric("vendor_quote_amount"),
    equipmentCondition: text("equipment_condition", { enum: EQUIPMENT_CONDITIONS }),
    yearMakeModel: text("year_make_model"),
    trucksInFleet: integer("trucks_in_fleet"),
    downPaymentAmount: numeric("down_payment_amount", { precision: 15, scale: 2 }),
    hasFinancialStatements: boolean("has_financial_statements"),
    hasFactoring: boolean("has_factoring"),
     hasCollateral: boolean("has_collateral").notNull().default(false),
    industryExperienceMonths: integer("industry_experience_months"),
    // Owner info
    ownerFirstName: text("owner_first_name").notNull(),
    ownerLastName: text("owner_last_name").notNull(),
    ownerSsnEncrypted: text("owner_ssn_encrypted"),
    ownerDob: text("owner_dob"),
    ownerHomeAddress: text("owner_home_address"),
    ownerHomeCity: text("owner_home_city"),
    ownerHomeState: text("owner_home_state"),
    ownerHomeZip: text("owner_home_zip"),
    ownershipPct: integer("ownership_pct"),
    // Secondary owner (optional; SSN is encrypted with the same application key).
    secondaryOwnerName: text("secondary_owner_name"),
    secondaryOwnerEmail: text("secondary_owner_email"),
    secondaryOwnerAddress: text("secondary_owner_address"),
    secondaryOwnerSsnEncrypted: text("secondary_owner_ssn_encrypted"),
    secondaryOwnerDob: text("secondary_owner_dob"),
    secondaryOwnerOwnershipPct: integer("secondary_owner_ownership_pct"),
    secondaryOwnerCell: text("secondary_owner_cell"),
    secondaryOwnerEstCreditScore: text("secondary_owner_est_credit_score", { enum: ESTIMATED_CREDIT_SCORE_BANDS }),
    // Consent & signature
    consentCreditPull: boolean("consent_credit_pull").notNull().default(false),
    consentTerms: boolean("consent_terms").notNull().default(false),
    smsConsent: boolean("sms_consent").notNull().default(false),
    smsConsentAt: timestamp("sms_consent_at"),
    smsConsentIp: text("sms_consent_ip"),
    consentTextVersion: text("consent_text_version"),
    signatureMethod: text("signature_method", { enum: ["typed", "drawn"] }),
    signatureData: text("signature_data"),
    signatureIp: text("signature_ip"),
    signatureSignedAt: timestamp("signature_signed_at"),
    signedDocumentKey: text("signed_document_key"),
    submittedAt: timestamp("submitted_at").notNull().defaultNow(),
  },
  (t) => [
    index("applications_lead_idx").on(t.leadId),
    check(
      "applications_sms_consent_evidence_check",
      sql`(${t.smsConsent} = false AND ${t.smsConsentAt} IS NULL AND ${t.smsConsentIp} IS NULL)
        OR (${t.smsConsent} = true AND ${t.smsConsentAt} IS NOT NULL AND ${t.smsConsentIp} IS NOT NULL)`,
    ),
  ],
);

export const bankStatementExtractionsTable = pgTable(
  "bank_statement_extractions",
  {
    id: serial("id").primaryKey(),
    leadId: integer("lead_id").notNull().references(() => leadsTable.id, { onDelete: "cascade" }),
    documentId: integer("document_id").references(() => documentsTable.id, { onDelete: "set null" }),
    statementMonth: integer("statement_month"),
    statementYear: integer("statement_year"),
    totalDeposits: numeric("total_deposits"),
    averageDailyBalance: numeric("average_daily_balance"),
    nsfCount: integer("nsf_count").notNull().default(0),
    negativeBalanceDays: integer("negative_balance_days").notNull().default(0),
    existingPositionsJson: jsonb("existing_positions_json"),
    rawExtractionJson: jsonb("raw_extraction_json"),
    extractedAt: timestamp("extracted_at").notNull().defaultNow(),
  },
  (t) => [index("bse_lead_idx").on(t.leadId)],
);

export const insertApplicationSchema = createInsertSchema(applicationsTable).omit({ id: true, submittedAt: true });
export type InsertApplication = z.infer<typeof insertApplicationSchema>;
export type Application = typeof applicationsTable.$inferSelect;

export const insertBankStatementExtractionSchema = createInsertSchema(bankStatementExtractionsTable).omit({ id: true, extractedAt: true });
export type InsertBankStatementExtraction = z.infer<typeof insertBankStatementExtractionSchema>;
export type BankStatementExtraction = typeof bankStatementExtractionsTable.$inferSelect;
