import { sql } from "drizzle-orm";
import { pgTable, serial, text, boolean, timestamp, uniqueIndex, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    clerkId: text("clerk_id").notNull().unique(),
    name: text("name"),
    title: text("title"),
    email: text("email").notNull().unique(),
    slug: text("slug"),
    role: text("role", { enum: ["admin", "manager", "rep", "pending"] }).notNull().default("pending"),
    isActive: boolean("is_active").notNull().default(true),
    mobileNumber: text("mobile_number"),
    pushToken: text("push_token"),
    mergedInto: integer("merged_into_user_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_slug_unique").on(t.slug).where(sql`${t.slug} IS NOT NULL`),
  ],
);

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
