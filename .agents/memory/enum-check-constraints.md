---
name: Postgres check constraints drift from Drizzle enums
description: Adding a value to a Drizzle text-enum column doesn't update the DB's CHECK constraint — must alter it manually.
---

When a column is defined with a TypeScript string-union type in a Drizzle schema (not a native Postgres enum) but the table was created with an explicit `CHECK (col = ANY(ARRAY[...]))` constraint, adding a new allowed value to the TS union does NOT update that constraint. Inserts using the new value fail at the DB layer with `violates check constraint "<table>_<col>_check"`, even though TypeScript compiles fine and the app logic looks correct.

**Why:** `drizzle-kit push`/migrate wasn't run (e.g. it hung on an unrelated interactive prompt) so schema changes were applied via hand-written `ALTER TABLE ADD COLUMN` SQL, which skipped regenerating the CHECK constraint tied to the enum-like column.

**How to apply:** After adding a new variant to any string-union column backed by a Postgres CHECK constraint (e.g. `notifications.type`), check `pg_get_constraintdef` for that column's check constraint and `ALTER TABLE ... DROP CONSTRAINT ... ADD CONSTRAINT ...` to include the new value — don't assume the TS-level union change is sufficient. Always seed test data and exercise the actual insert path (not just `tsc --build`) before declaring a new enum value done.
