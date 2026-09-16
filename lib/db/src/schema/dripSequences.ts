import { pgTable, serial, text, boolean, timestamp, integer } from "drizzle-orm/pg-core";
import { LEAD_STATUSES } from "./leads";
import { usersTable } from "./users";

export const dripSequencesTable = pgTable("drip_sequences", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  triggerStatus: text("trigger_status", { enum: LEAD_STATUSES }).notNull(),
  senderMode: text("sender_mode").notNull().default("template"),
  isActive: boolean("is_active").notNull().default(false),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  ownerId: integer("owner_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type DripSequence = typeof dripSequencesTable.$inferSelect;
