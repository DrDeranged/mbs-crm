import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const userIdentitiesTable = pgTable("user_identities", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  clerkId: text("clerk_id").notNull().unique(),
  email: text("email").notNull(),
  provider: text("provider").notNull().default("clerk"),
  linkedAt: timestamp("linked_at").notNull().defaultNow(),
});

export type UserIdentity = typeof userIdentitiesTable.$inferSelect;