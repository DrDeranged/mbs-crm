import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  index,
  check,
  numeric,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { leadsTable } from "./leads";
import { usersTable } from "./users";

export const DEAL_STAGES = [
  "waiting_on_app",
  "information_needed",
  "submitted",
  "approved",
  "in_funding",
  "funded",
  "declined",
  "dead",
  "hold_on",
] as const;

export const dealsTable = pgTable(
  "deals",
  {
    id: serial("id").primaryKey(),
    leadId: integer("lead_id").references(() => leadsTable.id, {
      onDelete: "set null",
    }),
    dealName: text("deal_name").notNull(),
    stage: text("stage", { enum: DEAL_STAGES })
      .notNull()
      .default("waiting_on_app"),
    amount: integer("amount"),
    approxGm: integer("approx_gm"),
    actualGm: integer("actual_gm"),
    notes: text("notes"),
    gmSplitPct: integer("gm_split_pct").notNull().default(100),
    referredByPartnerId: integer("referred_by_partner_id"),
    referralSplitPct: numeric("referral_split_pct", { precision: 5, scale: 2 }),
    assignedTo: integer("assigned_to").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    intendedRepSlug: text("intended_rep_slug"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    fundedAt: timestamp("funded_at"),
    isArchived: boolean("is_archived").notNull().default(false),
  },
  (t) => [
    index("deals_lead_idx").on(t.leadId),
    index("deals_stage_idx").on(t.stage),
    index("deals_assigned_to_idx").on(t.assignedTo),
    index("deals_created_idx").on(t.createdAt),
    index("deals_archived_idx").on(t.isArchived),
    index("deals_intended_rep_slug_idx").on(t.intendedRepSlug),
    check("deals_gm_split_pct_check", sql`${t.gmSplitPct} BETWEEN 0 AND 100`),
    check("deals_stage_check", sql`${t.stage} IN ('waiting_on_app', 'information_needed', 'submitted', 'approved', 'in_funding', 'funded', 'declined', 'dead', 'hold_on')`),
  ],
);

export const insertDealSchema = createInsertSchema(dealsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDeal = z.infer<typeof insertDealSchema>;
export type Deal = typeof dealsTable.$inferSelect;
