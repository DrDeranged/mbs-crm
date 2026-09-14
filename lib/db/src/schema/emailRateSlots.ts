import { pgTable, serial, timestamp, index } from "drizzle-orm/pg-core";

/** Durable reservations used to cap provider attempts across all API workers. */
export const emailRateSlotsTable = pgTable(
  "email_rate_slots",
  {
    id: serial("id").primaryKey(),
    reservedAt: timestamp("reserved_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (t) => [
    index("email_rate_slots_expiry_idx").on(t.expiresAt),
  ],
);

export type EmailRateSlot = typeof emailRateSlotsTable.$inferSelect;