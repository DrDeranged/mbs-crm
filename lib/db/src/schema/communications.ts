import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { leadsTable } from "./leads";

export const COMMUNICATION_TYPES = ["call", "sms"] as const;
export const COMMUNICATION_DIRECTIONS = ["inbound", "outbound"] as const;

export const communicationsTable = pgTable(
  "communications",
  {
    id: serial("id").primaryKey(),
    leadId: integer("lead_id").references(() => leadsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
    type: text("type", { enum: COMMUNICATION_TYPES }).notNull(),
    direction: text("direction", { enum: COMMUNICATION_DIRECTIONS }).notNull(),
    fromNumber: text("from_number"),
    toNumber: text("to_number"),
    body: text("body"),
    durationSeconds: integer("duration_seconds"),
    recordingUrl: text("recording_url"),
    recordingSid: text("recording_sid"),
    status: text("status").notNull().default("initiated"),
    twilioSid: text("twilio_sid"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("comms_lead_idx").on(t.leadId),
    index("comms_user_idx").on(t.userId),
    index("comms_twilio_sid_idx").on(t.twilioSid),
    index("comms_created_idx").on(t.createdAt),
  ],
);

export type Communication = typeof communicationsTable.$inferSelect;
