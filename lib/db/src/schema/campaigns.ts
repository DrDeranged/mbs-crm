import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, jsonb, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { emailTemplatesTable } from "./emailTemplates";
import { leadsTable } from "./leads";
import { emailSendsTable } from "./emailSends";

export const CAMPAIGN_CHANNELS = ["email", "sms", "email_sms"] as const;
export const CAMPAIGN_STATUSES = ["draft", "approved", "scheduled", "running", "paused", "completed", "cancelled", "failed"] as const;
export const CAMPAIGN_RECIPIENT_STATUSES = ["eligible", "excluded", "queued", "sent", "failed", "deferred"] as const;

export const campaignsTable = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  channel: text("channel", { enum: CAMPAIGN_CHANNELS }).notNull().default("email"),
  status: text("status", { enum: CAMPAIGN_STATUSES }).notNull().default("draft"),
  emailTemplateId: integer("email_template_id"),
  replyToEmail: text("reply_to_email").notNull().default("nate@my-business-solutions.com"),
  smsBody: text("sms_body"),
  flyer: jsonb("flyer"),
  flyerDeliveryMode: text("flyer_delivery_mode", { enum: ["attach", "link"] }).notNull().default("link"),
  audienceRules: jsonb("audience_rules").notNull().default({}),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  launchedAt: timestamp("launched_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  ownerId: integer("owner_id").notNull(),
  createdBy: integer("created_by").notNull(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("campaigns_status_idx").on(t.status),
  index("campaigns_owner_idx").on(t.ownerId),
  check("campaigns_channel_check", sql`${t.channel} IN ('email', 'sms', 'email_sms')`),
  check("campaigns_status_check", sql`${t.status} IN ('draft', 'approved', 'scheduled', 'running', 'paused', 'completed', 'cancelled', 'failed')`),
  check("campaigns_flyer_delivery_mode_check", sql`${t.flyerDeliveryMode} IN ('attach', 'link')`),
  foreignKey({ columns: [t.emailTemplateId], foreignColumns: [emailTemplatesTable.id], name: "campaigns_email_template_id_fkey" }).onDelete("set null"),
  foreignKey({ columns: [t.ownerId], foreignColumns: [usersTable.id], name: "campaigns_owner_id_fkey" }).onDelete("restrict"),
  foreignKey({ columns: [t.createdBy], foreignColumns: [usersTable.id], name: "campaigns_created_by_fkey" }).onDelete("restrict"),
]);

export const campaignAudiencePresetsTable = pgTable("campaign_audience_presets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  rules: jsonb("rules").notNull().default({}),
  ownerId: integer("owner_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("campaign_audience_presets_owner_id_name_key").on(t.ownerId, t.name),
  foreignKey({ columns: [t.ownerId], foreignColumns: [usersTable.id], name: "campaign_audience_presets_owner_id_fkey" }).onDelete("cascade"),
]);

export const campaignApprovalsTable = pgTable("campaign_approvals", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull(),
  approvalType: text("approval_type").notNull(),
  contentVersion: integer("content_version").notNull(),
  approvedBy: integer("approved_by").notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
  invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
  invalidatedReason: text("invalidated_reason"),
  contentHash: text("content_hash").notNull().default(""),
  previewId: integer("preview_id"),
  claimsAffirmed: boolean("claims_affirmed").notNull().default(false),
  snapshot: jsonb("snapshot").notNull().default({}),
}, (t) => [
  index("campaign_approvals_campaign_idx").on(t.campaignId),
  foreignKey({ columns: [t.campaignId], foreignColumns: [campaignsTable.id], name: "campaign_approvals_campaign_id_fkey" }).onDelete("cascade"),
  foreignKey({ columns: [t.approvedBy], foreignColumns: [usersTable.id], name: "campaign_approvals_approved_by_fkey" }).onDelete("restrict"),
  foreignKey({ columns: [t.previewId], foreignColumns: [campaignAudiencePreviewsTable.id], name: "campaign_approvals_preview_id_fkey" }).onDelete("restrict"),
]);

export const campaignAudiencePreviewsTable = pgTable("campaign_audience_previews", {
  id: serial("id").primaryKey(),
  previewToken: text("preview_token").notNull(),
  campaignId: integer("campaign_id").notNull(),
  campaignVersion: integer("campaign_version").notNull(),
  requestedBy: integer("requested_by").notNull(),
  contentHash: text("content_hash").notNull(),
  counts: jsonb("counts").notNull().default({}),
  recipientsSnapshot: jsonb("recipients_snapshot").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("campaign_audience_previews_preview_token_key").on(t.previewToken),
  index("campaign_audience_previews_campaign_idx").on(t.campaignId, t.campaignVersion),
  check("campaign_audience_previews_token_nonempty", sql`length(${t.previewToken}) >= 10`),
  foreignKey({ columns: [t.campaignId], foreignColumns: [campaignsTable.id], name: "campaign_audience_previews_campaign_id_fkey" }).onDelete("cascade"),
  foreignKey({ columns: [t.requestedBy], foreignColumns: [usersTable.id], name: "campaign_audience_previews_requested_by_fkey" }).onDelete("restrict"),
]);

export const campaignLaunchesTable = pgTable("campaign_launches", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  requestedBy: integer("requested_by").notNull(),
  mode: text("mode").notNull().default("live"),
  status: text("status").notNull().default("queued"),
  eligibleCount: integer("eligible_count").notNull().default(0),
  excludedCount: integer("excluded_count").notNull().default(0),
  sentCount: integer("sent_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  executionLeaseToken: text("execution_lease_token"),
  executionLeaseExpiresAt: timestamp("execution_lease_expires_at", { withTimezone: true }),
}, (t) => [
  unique("campaign_launches_idempotency_key_key").on(t.idempotencyKey),
  index("campaign_launches_campaign_idx").on(t.campaignId),
  index("campaign_launches_execution_lease_idx").on(t.id, t.executionLeaseExpiresAt),
  foreignKey({ columns: [t.campaignId], foreignColumns: [campaignsTable.id], name: "campaign_launches_campaign_id_fkey" }).onDelete("cascade"),
  foreignKey({ columns: [t.requestedBy], foreignColumns: [usersTable.id], name: "campaign_launches_requested_by_fkey" }).onDelete("restrict"),
]);

export const campaignRecipientsTable = pgTable("campaign_recipients", {
  id: serial("id").primaryKey(),
  launchId: integer("launch_id").notNull(),
  campaignId: integer("campaign_id").notNull(),
  leadId: integer("lead_id").notNull(),
  channel: text("channel").notNull(),
  status: text("status", { enum: CAMPAIGN_RECIPIENT_STATUSES }).notNull().default("eligible"),
  exclusionReason: text("exclusion_reason"),
  availableAt: timestamp("available_at", { withTimezone: true }),
  emailSendId: integer("email_send_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("campaign_recipients_launch_id_lead_id_channel_key").on(t.launchId, t.leadId, t.channel),
  index("campaign_recipients_campaign_idx").on(t.campaignId),
  index("campaign_recipients_status_idx").on(t.status),
  check("campaign_recipients_channel_check", sql`${t.channel} IN ('email', 'sms')`),
  check("campaign_recipients_status_check", sql`${t.status} IN ('eligible', 'excluded', 'queued', 'sent', 'failed', 'deferred')`),
  foreignKey({ columns: [t.launchId], foreignColumns: [campaignLaunchesTable.id], name: "campaign_recipients_launch_id_fkey" }).onDelete("cascade"),
  foreignKey({ columns: [t.campaignId], foreignColumns: [campaignsTable.id], name: "campaign_recipients_campaign_id_fkey" }).onDelete("cascade"),
  foreignKey({ columns: [t.leadId], foreignColumns: [leadsTable.id], name: "campaign_recipients_lead_id_fkey" }).onDelete("cascade"),
  foreignKey({ columns: [t.emailSendId], foreignColumns: [emailSendsTable.id], name: "campaign_recipients_email_send_id_fkey" }).onDelete("set null"),
]);

export const campaignAuditEventsTable = pgTable("campaign_audit_events", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull(),
  actorUserId: integer("actor_user_id"),
  action: text("action").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  details: jsonb("details"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("campaign_audit_campaign_idx").on(t.campaignId, t.createdAt),
  foreignKey({ columns: [t.campaignId], foreignColumns: [campaignsTable.id], name: "campaign_audit_events_campaign_id_fkey" }).onDelete("cascade"),
  foreignKey({ columns: [t.actorUserId], foreignColumns: [usersTable.id], name: "campaign_audit_events_actor_user_id_fkey" }).onDelete("set null"),
]);

export type Campaign = typeof campaignsTable.$inferSelect;
export type CampaignAudiencePreset = typeof campaignAudiencePresetsTable.$inferSelect;
export type CampaignApproval = typeof campaignApprovalsTable.$inferSelect;
export type CampaignAudiencePreview = typeof campaignAudiencePreviewsTable.$inferSelect;
export type CampaignLaunch = typeof campaignLaunchesTable.$inferSelect;
export type CampaignRecipient = typeof campaignRecipientsTable.$inferSelect;