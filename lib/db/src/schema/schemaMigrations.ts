import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const schemaMigrationsTable = pgTable("schema_migrations", {
  name: text("name").primaryKey(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
  checksum: text("checksum").notNull(),
  failedAt: timestamp("failed_at", { withTimezone: true }),
  error: text("error"),
  supersededBy: text("superseded_by"),
  supersededAt: timestamp("superseded_at", { withTimezone: true }),
});

export type SchemaMigration = typeof schemaMigrationsTable.$inferSelect;