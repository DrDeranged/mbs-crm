---
name: Drizzle column type quirks
description: Type expectations for Drizzle pg-core column types when inserting/updating — date needs string, numeric needs string, timestamp accepts Date.
---

# Drizzle pg-core Column Type Rules

**Rule:** Match the TypeScript insert type, not the JavaScript intuition.

## date() column
- Drizzle type: `string` (YYYY-MM-DD format)
- When Zod parses a date field with `z.coerce.date()`, it returns a `Date` object — convert before inserting:
  ```ts
  dueDate: body.data.dueDate?.toISOString().split("T")[0] ?? null
  ```

## numeric() column
- Drizzle type: `string` (PostgreSQL NUMERIC is returned/stored as string)
- When schema has `annualRevenue: numeric(...)`, always convert number input:
  ```ts
  annualRevenue: company.annualRevenue?.toString()
  ```

## timestamp() column
- Drizzle type (default, no mode): accepts `Date | null | undefined` for INSERT/UPDATE
- Do NOT convert to `.toISOString()` — pass the Date object directly

**Why:** Drizzle's TypeScript types are strict about column modes. Mismatches cause TS2769 overload resolution errors that are hard to trace.

**How to apply:** Any time a Zod schema uses `z.coerce.date()` for a field mapped to a Drizzle `date()` column, always add the `.toISOString().split("T")[0]` conversion. For `numeric()` columns, always `.toString()`.
