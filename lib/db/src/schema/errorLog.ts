import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const errorLogTable = pgTable("error_log", {
  id: serial("id").primaryKey(),
  requestId: text("request_id").notNull(),
  userId: text("user_id"),
  method: text("method").notNull(),
  path: text("path").notNull(),
  status: integer("status").notNull(),
  message: text("message").notNull(),
  stack: text("stack"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ErrorLogEntry = typeof errorLogTable.$inferSelect;
