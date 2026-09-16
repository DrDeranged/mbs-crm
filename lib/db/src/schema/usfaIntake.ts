import { pgTable, serial, integer, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { leadsTable } from "./leads";
import { usersTable } from "./users";

export const USFA_INTAKE_STATUSES = ["ok", "dup", "error"] as const;

/** One durable receipt per vendor row. The external id is the idempotency key. */
export const usfaIntakeLogTable = pgTable(
  "usfa_intake_log",
  {
    id: serial("id").primaryKey(),
    externalId: text("external_id").notNull().unique(),
    rowNumber: integer("row_number").notNull(),
    ingestedAt: timestamp("ingested_at").notNull().defaultNow(),
    leadId: integer("lead_id").references(() => leadsTable.id, { onDelete: "set null" }),
    status: text("status", { enum: USFA_INTAKE_STATUSES }).notNull(),
    error: text("error"),
    metadata: jsonb("metadata"),
  },
  (t) => [
    index("usfa_intake_log_status_idx").on(t.status),
    index("usfa_intake_log_ingested_idx").on(t.ingestedAt),
  ],
);

/**
 * SSN/DOB are encrypted before this table is written. Keeping a single JSON
 * ciphertext allows the mapper to remain pure while the persistence boundary
 * uses the same AES-256-GCM helper as applications.ownerSsnEncrypted.
 */
export const usfaIntakePrefillTable = pgTable(
  "usfa_intake_prefill",
  {
    id: serial("id").primaryKey(),
    leadId: integer("lead_id").notNull().references(() => leadsTable.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    encryptedPayload: text("encrypted_payload").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("usfa_intake_prefill_lead_idx").on(t.leadId), index("usfa_intake_prefill_external_idx").on(t.externalId)],
);

export const insertUsfaIntakeLogSchema = createInsertSchema(usfaIntakeLogTable).omit({ id: true, ingestedAt: true });
export type InsertUsfaIntakeLog = z.infer<typeof insertUsfaIntakeLogSchema>;
export type UsfaIntakeLog = typeof usfaIntakeLogTable.$inferSelect;
export const insertUsfaIntakePrefillSchema = createInsertSchema(usfaIntakePrefillTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUsfaIntakePrefill = z.infer<typeof insertUsfaIntakePrefillSchema>;
export type UsfaIntakePrefill = typeof usfaIntakePrefillTable.$inferSelect;

export const usfaPrefillInvitesTable = pgTable(
  "usfa_prefill_invites",
  {
    id: serial("id").primaryKey(),
    tokenHash: text("token_hash").notNull().unique(),
    leadId: integer("lead_id").notNull().references(() => leadsTable.id, { onDelete: "cascade" }),
    repUserId: integer("rep_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    repSlug: text("rep_slug").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    revokedAt: timestamp("revoked_at"),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("usfa_prefill_invites_lead_idx").on(t.leadId), index("usfa_prefill_invites_expiry_idx").on(t.expiresAt)],
);
export const insertUsfaPrefillInviteSchema = createInsertSchema(usfaPrefillInvitesTable).omit({ id: true, createdAt: true });
export type InsertUsfaPrefillInvite = z.infer<typeof insertUsfaPrefillInviteSchema>;
export type UsfaPrefillInvite = typeof usfaPrefillInvitesTable.$inferSelect;

export const USFA_APPLICATION_EMAIL_STATUSES = ["attached", "pending", "processing", "expired", "error"] as const;
export const usfaApplicationEmailLogTable = pgTable(
  "usfa_application_email_log",
  {
    id: serial("id").primaryKey(),
    gmailMessageId: text("gmail_message_id").notNull().unique(),
    leadId: integer("lead_id").references(() => leadsTable.id, { onDelete: "set null" }),
    status: text("status", { enum: USFA_APPLICATION_EMAIL_STATUSES }).notNull(),
    receivedAt: timestamp("received_at"),
    attemptedAt: timestamp("attempted_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at").notNull(),
    error: text("error"),
    metadata: jsonb("metadata"),
  },
  (t) => [index("usfa_application_email_status_idx").on(t.status), index("usfa_application_email_expires_idx").on(t.expiresAt)],
);
export const insertUsfaApplicationEmailLogSchema = createInsertSchema(usfaApplicationEmailLogTable).omit({ id: true, attemptedAt: true });
export type InsertUsfaApplicationEmailLog = z.infer<typeof insertUsfaApplicationEmailLogSchema>;
export type UsfaApplicationEmailLog = typeof usfaApplicationEmailLogTable.$inferSelect;