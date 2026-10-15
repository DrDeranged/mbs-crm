import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { createGetMyTasksHandler } from "../routes/dashboard";

for (const role of ["rep", "manager", "admin"]) {
  for (const hour of [19, 23]) {
    test(`${role}: real task handler at ${hour === 19 ? "7 PM" : "11 PM"} ET uses local date and strict overdue SQL`, async () => {
      const queries: Array<{ sql: string; params: unknown[] }> = [];
      const handler = createGetMyTasksHandler({
        clock: () => new Date(`2026-07-15T${hour}:00:00-04:00`),
        authenticate: async () => ({ id: 3, role }) as any,
        database: { query: { tasksTable: { findMany: async (config: any) => {
          queries.push(new PgDialect().sqlToQuery(config.where));
          return [];
        } } } } as any,
      });
      let result: unknown;
      await handler({} as any, { json: (value: unknown) => { result = value; } } as any);
      assert.equal(queries.length, 3);
      assert.ok(queries[0]!.params.includes("2026-07-15"));
      assert.ok(queries[1]!.params.includes("2026-07-15"));
      assert.match(queries[1]!.sql, /"due_date" > \$/);
      assert.match(queries[2]!.sql, /"due_date" < \$/);
      assert.doesNotMatch(queries[2]!.sql, /"due_date" <=/);
      assert.ok(queries[2]!.params.includes("2026-07-15"));
      assert.ok(queries.every(query => query.sql.includes('"is_completed"')));
      if (role !== "rep") assert.ok(queries.every(query => !query.sql.includes('"user_id"')));
      assert.deepEqual(result, { dueToday: [], dueThisWeek: [], overdue: [] });
    });
  }
}
