---
name: Postgres check constraints drift from Drizzle enums
description: Adding a value to a Drizzle text-enum column doesn't update the DB's CHECK constraint unless the SQL migration changes it too.
---

When a column is defined with a TypeScript string-union type in a Drizzle schema (not a native Postgres enum) but the table was created with an explicit `CHECK (col = ANY(ARRAY[...]))` constraint, adding a new allowed value to the TS union does NOT update that constraint. Inserts using the new value fail at the DB layer with `violates check constraint "<table>_<col>_check"`, even though TypeScript compiles fine and the app logic looks correct.

**Why:** TypeScript unions are not database constraints. The SQL migration runner is the project's only schema-change path, so the migration must update the CHECK constraint explicitly.

**How to apply:** When adding a string-union variant backed by a Postgres CHECK constraint, include the corresponding DROP/ADD constraint SQL in a numbered migration. Never use Drizzle push or ad-hoc live SQL. Exercise the real insert path.
