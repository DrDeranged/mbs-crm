import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const jobRunsTable = pgTable("job_runs", {
  id: serial("id").primaryKey(),
  jobName: text("job_name").notNull(),
  startedAt: timestamp("started_at").notNull(),
  finishedAt: timestamp("finished_at"),
  status: text("status").notNull(),
  itemsProcessed: integer("items_processed"),
  errorMessage: text("error_message"),
});

export type JobRun = typeof jobRunsTable.$inferSelect;
