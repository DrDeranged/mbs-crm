import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { LEAD_STATUSES } from "./leads";

export const dripSequencesTable = pgTable("drip_sequences", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  triggerStatus: text("trigger_status", { enum: LEAD_STATUSES }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type DripSequence = typeof dripSequencesTable.$inferSelect;
