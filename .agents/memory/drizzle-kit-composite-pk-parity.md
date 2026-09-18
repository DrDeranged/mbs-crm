---
name: Drizzle Kit composite PK parity
description: Schema parity limitation affecting new PostgreSQL tables with composite primary keys.
---

Avoid introducing new composite primary keys while schema parity uses Drizzle Kit 0.31.10 `pushSchema`. Prefer a surrogate primary key plus a unique multi-column index.

**Why:** The PostgreSQL introspector emits a parameterized composite-primary-key lookup, but `pushSchema` executes it without its parameters. Schema parity then fails with `there is no parameter $1`, even though migrations and TypeScript compile.

**How to apply:** For new join, preference, or idempotency tables, use a serial/identity primary key and preserve the business key with a unique index. Also keep explicit constraint names within PostgreSQL's 63-character identifier limit.