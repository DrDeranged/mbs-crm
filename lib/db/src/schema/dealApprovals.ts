import { sql } from "drizzle-orm";
import {
  date,
  check,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { dealsTable } from "./deals";
import { documentsTable } from "./documents";
import { lendersTable } from "./lenders";
import { usersTable } from "./users";

export const APPROVAL_CONTRACT_TYPES = ["EFA", "lease", "loan"] as const;

export const dealApprovalsTable = pgTable(
  "deal_approvals",
  {
    id: serial("id").primaryKey(),
    dealId: integer("deal_id").notNull().references(() => dealsTable.id, { onDelete: "cascade" }),
    lenderId: integer("lender_id").notNull().references(() => lendersTable.id, { onDelete: "restrict" }),
    contractType: text("contract_type", { enum: APPROVAL_CONTRACT_TYPES }).notNull(),
    advance: numeric("advance", { precision: 12, scale: 2, mode: "number" }).notNull(),
    payment: numeric("payment", { precision: 12, scale: 2, mode: "number" }).notNull(),
    term: integer("term").notNull(),
    downPayment: numeric("down_payment", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
    tier: text("tier").notNull(),
    expiresOn: date("expires_on", { mode: "string" }).notNull(),
    approvalDocumentId: integer("approval_document_id").references(() => documentsTable.id, { onDelete: "set null" }),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("deal_approvals_deal_created_idx").on(t.dealId, t.createdAt.desc(), t.id.desc()),
    index("deal_approvals_lender_idx").on(t.lenderId),
    check("deal_approvals_contract_type_check", sql`${t.contractType} IN ('EFA', 'lease', 'loan')`),
    check("deal_approvals_advance_check", sql`${t.advance} > 0`),
    check("deal_approvals_payment_check", sql`${t.payment} > 0`),
    check("deal_approvals_down_payment_check", sql`${t.downPayment} >= 0`),
    check("deal_approvals_tier_check", sql`length(trim(${t.tier})) > 0`),
    check("deal_approvals_term_check", sql`${t.term} > 0`),
  ],
);

export const insertDealApprovalSchema = createInsertSchema(dealApprovalsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertDealApproval = z.infer<typeof insertDealApprovalSchema>;
export type DealApproval = typeof dealApprovalsTable.$inferSelect;