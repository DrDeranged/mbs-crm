import { pgTable, serial, integer, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { leadsTable } from "./leads";

export const companiesTable = pgTable("companies", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull().unique().references(() => leadsTable.id, { onDelete: "cascade" }),
  name: text("name"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  industry: text("industry"),
  timeInBusinessMonths: integer("time_in_business_months"),
  annualRevenue: numeric("annual_revenue", { precision: 15, scale: 2 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCompanySchema = createInsertSchema(companiesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Company = typeof companiesTable.$inferSelect;
