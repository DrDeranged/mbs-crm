import { pgTable, serial, text, timestamp, uniqueIndex, jsonb } from "drizzle-orm/pg-core";

export const idempotencyKeysTable = pgTable(
  "idempotency_keys",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull(),
    endpoint: text("endpoint").notNull(),
    resultRef: text("result_ref"),
    resultPayload: jsonb("result_payload"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("idempotency_keys_key_endpoint_unique").on(table.key, table.endpoint),
  ],
);
