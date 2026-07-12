import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const companySettingsTable = pgTable("company_settings", {
  id: serial("id").primaryKey(),
  companyName: text("company_name"),
  companyEmail: text("company_email"),
  companyPhone: text("company_phone"),
  companyWebsite: text("company_website"),
  companyAddress: text("company_address"),
  companyCity: text("company_city"),
  companyState: text("company_state"),
  companyZip: text("company_zip"),
  retentionMonths: integer("retention_months").default(36),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const upsertCompanySettingsSchema = createInsertSchema(companySettingsTable).omit({ id: true, updatedAt: true }).partial();
export type CompanySettings = typeof companySettingsTable.$inferSelect;
export type UpsertCompanySettings = z.infer<typeof upsertCompanySettingsSchema>;
