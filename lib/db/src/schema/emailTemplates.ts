import { pgTable, serial, integer, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { APPLICATION_TYPES } from "./leads";

export const emailTemplatesTable = pgTable(
  "email_templates",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    subject: text("subject").notNull(),
    bodyHtml: text("body_html").notNull(),
    programType: text("program_type", { enum: APPLICATION_TYPES }),
    senderMode: text("sender_mode").notNull().default("default"),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    ownerId: integer("owner_id").references(() => usersTable.id, { onDelete: "set null" }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("email_templates_owner_id_idx").on(t.ownerId)],
);

export type EmailTemplate = typeof emailTemplatesTable.$inferSelect;
