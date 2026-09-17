import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { leadsTable } from "./leads";
import { usersTable } from "./users";

export const COLLATERAL_CATEGORIES = ["flyer", "one_pager", "application", "letter", "other"] as const;
export const COLLATERAL_KINDS = ["html", "image_overlay"] as const;
export const COLLATERAL_STATUSES = ["draft", "published"] as const;

export const collateralTemplatesTable = pgTable(
  "collateral_templates",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    category: text("category", { enum: COLLATERAL_CATEGORIES }).notNull(),
    kind: text("kind", { enum: COLLATERAL_KINDS }).notNull(),
    sourceKey: text("source_key").notNull(),
    status: text("status", { enum: COLLATERAL_STATUSES }).notNull().default("draft"),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("collateral_templates_status_idx").on(table.status),
    index("collateral_templates_category_idx").on(table.category),
  ],
);

export const collateralRendersTable = pgTable(
  "collateral_renders",
  {
    id: serial("id").primaryKey(),
    templateId: integer("template_id")
      .notNull()
      .references(() => collateralTemplatesTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    leadId: integer("lead_id").references(() => leadsTable.id, { onDelete: "set null" }),
    fileKey: text("file_key").notNull(),
    sha256: text("sha256").notNull(),
    renderedAt: timestamp("rendered_at").notNull().defaultNow(),
  },
  (table) => [
    index("collateral_renders_template_idx").on(table.templateId),
    index("collateral_renders_user_idx").on(table.userId),
    index("collateral_renders_lead_idx").on(table.leadId),
    index("collateral_renders_cache_idx").on(table.templateId, table.userId, table.sha256),
  ],
);

export const insertCollateralTemplateSchema = createInsertSchema(collateralTemplatesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertCollateralRenderSchema = createInsertSchema(collateralRendersTable).omit({
  id: true,
  renderedAt: true,
});

export type InsertCollateralTemplate = z.infer<typeof insertCollateralTemplateSchema>;
export type InsertCollateralRender = z.infer<typeof insertCollateralRenderSchema>;
export type CollateralTemplate = typeof collateralTemplatesTable.$inferSelect;
export type CollateralRender = typeof collateralRendersTable.$inferSelect;