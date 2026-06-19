import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { leadsTable } from "./leads";
import { dripSequencesTable } from "./dripSequences";

export const DRIP_ENROLLMENT_STATUSES = ["active", "completed", "unenrolled"] as const;

export const dripEnrollmentsTable = pgTable("drip_enrollments", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull().references(() => leadsTable.id, { onDelete: "cascade" }),
  sequenceId: integer("sequence_id").notNull().references(() => dripSequencesTable.id, { onDelete: "cascade" }),
  currentStep: integer("current_step").notNull().default(0),
  status: text("status", { enum: DRIP_ENROLLMENT_STATUSES }).notNull().default("active"),
  enrolledAt: timestamp("enrolled_at").notNull().defaultNow(),
  lastStepSentAt: timestamp("last_step_sent_at"),
  completedAt: timestamp("completed_at"),
  unenrolledAt: timestamp("unenrolled_at"),
});

export type DripEnrollment = typeof dripEnrollmentsTable.$inferSelect;
