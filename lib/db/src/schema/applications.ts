import {
  pgTable, serial, integer, text, boolean, timestamp, numeric, index, jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { leadsTable } from "./leads";
import { documentsTable } from "./documents";

export const EQUIPMENT_CONDITIONS = ["new", "used"] as const;

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
    timeInBusinessMonths: integer("time_in_business_months"),
    monthlyRevenueStated: integer("monthly_revenue_stated"),
    requestedAmount: integer("requested_amount"),
    useOfFunds: text("use_of_funds"),
    // Equipment-only fields
    equipmentDescription: text("equipment_description"),
    vendorName: text("vendor_name"),
    vendorQuoteAmount: numeric("vendor_quote_amount"),
    equipmentCondition: text("equipment_condition", { enum: EQUIPMENT_CONDITIONS }),
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
    // Consent & signature
    consentCreditPull: boolean("consent_credit_pull").notNull().default(false),
    consentTerms: boolean("consent_terms").notNull().default(false),
    signatureData: text("signature_data"),
    signatureIp: text("signature_ip"),
    signedDocumentKey: text("signed_document_key"),
    submittedAt: timestamp("submitted_at").notNull().defaultNow(),
  },
  (t) => [index("applications_lead_idx").on(t.leadId)],
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
