import { pgTable, serial, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";
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
  includeAdminsInRoundRobin: boolean("include_admins_in_round_robin").notNull().default(false),
  roundRobinCursor: integer("round_robin_cursor").notNull().default(0),
  staleThresholdDays: integer("stale_threshold_days").notNull().default(7),
  routingMode: text("routing_mode", { enum: ["manual", "round_robin"] }).notNull().default("manual"),
  routingStaleDays: integer("routing_stale_days").notNull().default(7),
  routingAutoReassignStale: boolean("routing_auto_reassign_stale").notNull().default(false),
  /**
   * Marketing email delivery is an explicit operational opt-in.  Keeping this
   * in the database (rather than an environment variable) makes the disabled
   * default apply consistently to every API process and worker.
   */
  emailSendingEnabled: boolean("email_sending_enabled").notNull().default(false),
  bulkEmailPerMinute: integer("bulk_email_per_minute").notNull().default(60),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const upsertCompanySettingsSchema = createInsertSchema(companySettingsTable).omit({ id: true, updatedAt: true }).partial();
export type CompanySettings = typeof companySettingsTable.$inferSelect;
export type UpsertCompanySettings = z.infer<typeof upsertCompanySettingsSchema>;
