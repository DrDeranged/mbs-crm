import { sql } from "drizzle-orm";
import { pgTable, serial, integer, text, timestamp, index, uniqueIndex, check, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { campaignsTable, campaignLaunchesTable } from "./campaigns";
import { leadsTable } from "./leads";
import { emailSendsTable } from "./emailSends";

export const campaignEngagementTable = pgTable("campaign_engagement", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull().references(() => campaignsTable.id, { onDelete: "cascade" }),
  launchId: integer("launch_id").references(() => campaignLaunchesTable.id, { onDelete: "set null" }),
  leadId: integer("lead_id").notNull().references(() => leadsTable.id, { onDelete: "cascade" }),
  emailSendId: integer("email_send_id").references(() => emailSendsTable.id, { onDelete: "set null" }),
  kind: text("kind").notNull(),
  sourceKey: text("source_key"),
  evidence: jsonb("evidence"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("campaign_engagement_source_uq").on(t.sourceKey),
  index("campaign_engagement_campaign_lead_idx").on(t.campaignId, t.leadId, t.occurredAt),
  check("campaign_engagement_kind_check", sql`${t.kind} IN ('flyer_click', 'inbound_call', 'referral')`),
]);

export const campaignRepliesTable = pgTable("campaign_replies", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull().references(() => campaignsTable.id, { onDelete: "cascade" }),
  leadId: integer("lead_id").notNull().references(() => leadsTable.id, { onDelete: "cascade" }),
  emailSendId: integer("email_send_id").notNull().references(() => emailSendsTable.id, { onDelete: "cascade" }),
  dedupeKey: text("dedupe_key").notNull(),
  fromEmail: text("from_email").notNull(),
  subject: text("subject").notNull(),
  bodyText: text("body_text").notNull(),
  attachments: jsonb("attachments").$type<Array<{ path: string; filename: string; contentType: string }>>().notNull().default([]),
  forwardTo: text("forward_to").notNull(),
  forwardStatus: text("forward_status").notNull().default("pending"),
  failureReason: text("failure_reason"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  forwardedAt: timestamp("forwarded_at", { withTimezone: true }),
}, t => [
  uniqueIndex("campaign_replies_dedupe_uq").on(t.dedupeKey),
  index("campaign_replies_campaign_idx").on(t.campaignId, t.leadId),
  check("campaign_replies_forward_check", sql`${t.forwardStatus} IN ('pending', 'dispatching', 'forwarded', 'failed', 'uncertain')`),
]);
export const insertCampaignEngagementSchema = createInsertSchema(campaignEngagementTable).omit({ id: true });
export const campaignCallAttributionsTable = pgTable("campaign_call_attributions", {
  id: serial("id").primaryKey(),
  callSid: text("call_sid").notNull(),
  leadId: integer("lead_id").references(() => leadsTable.id, { onDelete: "set null" }),
  campaignId: integer("campaign_id").references(() => campaignsTable.id, { onDelete: "set null" }),
  originalAt: timestamp("original_at", { withTimezone: true }).notNull(),
  reason: text("reason").notNull(),
}, t => [uniqueIndex("campaign_call_attributions_sid_uq").on(t.callSid)]);
export const insertCampaignReplySchema = createInsertSchema(campaignRepliesTable).omit({ id: true });
export type CampaignEngagement = typeof campaignEngagementTable.$inferSelect;
export type CampaignReply = typeof campaignRepliesTable.$inferSelect;
