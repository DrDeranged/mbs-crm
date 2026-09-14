import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * A rep slug is never reusable after it has served traffic.  Keeping the
 * redirect target here, instead of changing activity/history rows, gives the
 * public resolver a permanent source of truth for old links.
 */
export const retiredRepSlugsTable = pgTable(
  "retired_rep_slugs",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    replacementSlug: text("replacement_slug").notNull(),
    userId: integer("user_id").notNull().references(() => usersTable.id),
    retiredAt: timestamp("retired_at").notNull().defaultNow(),
  },
  (table) => [
    index("retired_rep_slugs_replacement_idx").on(table.replacementSlug),
    index("retired_rep_slugs_user_idx").on(table.userId),
  ],
);

export type RetiredRepSlug = typeof retiredRepSlugsTable.$inferSelect;