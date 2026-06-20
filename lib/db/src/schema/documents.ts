import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { leadsTable } from "./leads";
import { usersTable } from "./users";

export const documentsTable = pgTable(
  "documents",
  {
    id: serial("id").primaryKey(),
    leadId: integer("lead_id").notNull().references(() => leadsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => usersTable.id),
    filename: text("filename").notNull(),
    fileKey: text("file_key").notNull(),
    fileType: text("file_type").notNull(),
    fileSize: integer("file_size").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("documents_lead_idx").on(t.leadId)],
);

export const insertDocumentSchema = createInsertSchema(documentsTable).omit({ id: true, createdAt: true });
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documentsTable.$inferSelect;
