import { sql } from "drizzle-orm";
import { pgTable, serial, text, integer, timestamp, boolean, check } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const companySettingsTable = pgTable(
  "company_settings",
  {
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
     * Marketing email delivery is an explicit operational opt-in. Keeping this
     * in the database makes the disabled default apply to every API process.
     */
    emailSendingEnabled: boolean("email_sending_enabled").notNull().default(false),
    partnerTextingEnabled: boolean("partner_texting_enabled").notNull().default(true),
    bulkEmailPerMinute: integer("bulk_email_per_minute").notNull().default(60),
    /** Shared daily allowance for marketing bulk and drip delivery attempts. */
    bulkEmailPerDay: integer("bulk_email_per_day").notNull().default(60),
    usfaSheetId: text("usfa_sheet_id"),
    usfaSheetTab: text("usfa_sheet_tab").notNull().default("Sheet1"),
    usfaConsentConfirmed: boolean("usfa_consent_confirmed").notNull().default(false),
    usfaWebhookEnabled: boolean("usfa_webhook_enabled").notNull().default(false),
    voiceCallerId: text("voice_caller_id").default("+19088608507"),
    smsSenderNumber: text("sms_sender_number").default("+19088608507"),
    voiceHoursStart: text("voice_hours_start").notNull().default("08:00"),
    voiceHoursEnd: text("voice_hours_end").notNull().default("18:00"),
    voiceBusinessDays: integer("voice_business_days").array().notNull().default([1, 2, 3, 4, 5]),
    voiceHolidays: text("voice_holidays").array().notNull().default([]),
    voiceGreeting: text("voice_greeting").notNull().default("Thanks for calling My Business Solutions. Please leave your name, business name, and phone number, and a representative will call you back within one business day."),
    voiceAfterHoursGreeting: text("voice_after_hours_greeting").notNull().default("Thanks for calling My Business Solutions. Our office is currently closed. Please leave your name, business name, and phone number, and we'll return your call the next business day."),
    voiceGreetingAudioPath: text("voice_greeting_audio_path"),
    voiceAfterHoursGreetingAudioPath: text("voice_after_hours_greeting_audio_path"),
    voiceRoutingMode: text("voice_routing_mode", { enum: ["assigned-rep-first", "ring-all", "priority-list"] }).notNull().default("assigned-rep-first"),
    voicePriorityRepIds: integer("voice_priority_rep_ids").array().notNull().default([]),
    missedCallTextBackEnabled: boolean("missed_call_text_back_enabled").notNull().default(false),
    voicemailRecipients: text("voicemail_recipients").array().notNull().default(["funding@my-business-solutions.com"]),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "company_settings_routing_mode_check",
      sql`${t.routingMode} IN ('manual', 'round_robin')`,
    ),
    check(
      "company_settings_routing_stale_days_check",
      sql`${t.routingStaleDays} BETWEEN 1 AND 365`,
    ),
    check(
      "company_settings_bulk_email_per_minute_check",
      sql`${t.bulkEmailPerMinute} BETWEEN 1 AND 1000`,
    ),
    check(
      "company_settings_bulk_email_per_day_check",
      sql`${t.bulkEmailPerDay} BETWEEN 1 AND 100000`,
    ),
  ],
);

export const upsertCompanySettingsSchema = createInsertSchema(companySettingsTable).omit({ id: true, updatedAt: true }).partial();
export type CompanySettings = typeof companySettingsTable.$inferSelect;
export type UpsertCompanySettings = z.infer<typeof upsertCompanySettingsSchema>;
