import { pgTable, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { dripSequencesTable } from "./dripSequences";
import { emailTemplatesTable } from "./emailTemplates";

export const dripSequenceStepsTable = pgTable("drip_sequence_steps", {
  id: serial("id").primaryKey(),
  sequenceId: integer("sequence_id").notNull().references(() => dripSequencesTable.id, { onDelete: "cascade" }),
  stepOrder: integer("step_order").notNull(),
  templateId: integer("template_id").notNull().references(() => emailTemplatesTable.id, { onDelete: "restrict" }),
  delayHours: integer("delay_hours").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type DripSequenceStep = typeof dripSequenceStepsTable.$inferSelect;
