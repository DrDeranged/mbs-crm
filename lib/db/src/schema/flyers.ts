import { pgTable, serial, text, integer, boolean, timestamp, index, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { leadsTable } from "./leads";
import { usersTable } from "./users";

export const FLYER_PROGRAM_TYPES = ["equipment", "working_capital", "general"] as const;

export const flyerTemplatesTable = pgTable(
  "flyer_templates",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    programType: text("program_type", { enum: FLYER_PROGRAM_TYPES }).notNull().default("general"),
    htmlTemplate: text("html_template").notNull(),
    variableFields: jsonb("variable_fields").notNull().default([]),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("flyer_templates_active_idx").on(t.isActive),
    index("flyer_templates_program_idx").on(t.programType),
  ],
);

export const generatedFlyersTable = pgTable(
  "generated_flyers",
  {
    id: serial("id").primaryKey(),
    leadId: integer("lead_id").references(() => leadsTable.id, { onDelete: "set null" }),
    templateId: integer("template_id").references(() => flyerTemplatesTable.id, { onDelete: "set null" }),
    fieldValues: jsonb("field_values").notNull().default({}),
    pdfStorageKey: text("pdf_storage_key"),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("generated_flyers_lead_idx").on(t.leadId),
    index("generated_flyers_template_idx").on(t.templateId),
  ],
);

export const insertFlyerTemplateSchema = createInsertSchema(flyerTemplatesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFlyerTemplate = z.infer<typeof insertFlyerTemplateSchema>;
export type FlyerTemplate = typeof flyerTemplatesTable.$inferSelect;
export type GeneratedFlyer = typeof generatedFlyersTable.$inferSelect;
