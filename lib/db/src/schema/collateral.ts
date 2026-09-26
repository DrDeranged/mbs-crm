import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { leadsTable } from "./leads";
import { usersTable } from "./users";

export const COLLATERAL_CATEGORIES = ["flyer", "one_pager", "application", "letter", "other"] as const;
export const COLLATERAL_KINDS = ["html", "image_overlay"] as const;
export const COLLATERAL_STATUSES = ["draft", "published"] as const;
export const COLLATERAL_FLYER_CATEGORIES = ["equipment_financing", "working_capital"] as const;
export const COLLATERAL_FLYER_VERTICALS = ["yellow_iron", "trucking", "restaurants", "amusement", "general"] as const;
export const COLLATERAL_FLYER_AUDIENCES = ["end_user", "vendor"] as const;

export const collateralTemplatesTable = pgTable(
  "collateral_templates",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    category: text("category", { enum: COLLATERAL_CATEGORIES }).notNull(),
    kind: text("kind", { enum: COLLATERAL_KINDS }).notNull(),
    sourceKey: text("source_key").notNull(),
    status: text("status", { enum: COLLATERAL_STATUSES }).notNull().default("draft"),
    campaignCategory: text("campaign_category", { enum: COLLATERAL_FLYER_CATEGORIES }),
    vertical: text("vertical", { enum: COLLATERAL_FLYER_VERTICALS }),
    audience: text("audience", { enum: COLLATERAL_FLYER_AUDIENCES }),
    repUserId: integer("rep_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    originalFilename: text("original_filename"),
    assetSha256: text("asset_sha256"),
    assetContentType: text("asset_content_type"),
    assetGeneration: text("asset_generation"),
    assetSize: integer("asset_size"),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    check(
      "collateral_templates_category_check",
      sql`${table.category} IN ('flyer', 'one_pager', 'application', 'letter', 'other')`,
    ),
    check(
      "collateral_templates_kind_check",
      sql`${table.kind} IN ('html', 'image_overlay')`,
    ),
    check(
      "collateral_templates_status_check",
      sql`${table.status} IN ('draft', 'published')`,
    ),
    check(
      "collateral_templates_campaign_category_check",
      sql`${table.campaignCategory} IS NULL OR ${table.campaignCategory} IN ('equipment_financing', 'working_capital')`,
    ),
    check(
      "collateral_templates_vertical_check",
      sql`${table.vertical} IS NULL OR ${table.vertical} IN ('yellow_iron', 'trucking', 'restaurants', 'amusement', 'general')`,
    ),
    check(
      "collateral_templates_audience_check",
      sql`${table.audience} IS NULL OR ${table.audience} IN ('end_user', 'vendor')`,
    ),
    index("collateral_templates_status_idx").on(table.status),
    index("collateral_templates_category_idx").on(table.category),
    index("collateral_templates_flyer_filters_idx").on(table.campaignCategory, table.vertical, table.audience, table.repUserId),
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