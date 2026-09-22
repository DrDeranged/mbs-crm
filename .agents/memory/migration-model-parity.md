---
name: Migration-model parity
description: Why migration replay must cover every public table and preserve migration-owned model declarations.
---

The migration-replay parity gate must compare every public table and column against the complete Drizzle model set. Never exclude `schema_migrations` or another operational table. A migration's matching application-model declarations belong to the migration scope and must remain when unrelated audit fixes are reverted.

**Why:** Model declarations for production columns were removed repeatedly by unrelated branch work, causing Publish to propose destructive column drops. Exclusions let those regressions pass schema checks, while reverting migration-owned model alignment leaves runtime models inconsistent with the migrated database.

**How to apply:** Keep the schema parity table filter all-inclusive, replay the full applied migration set in preflight, and model the migration ledger exactly as production defines it. If narrowing a change set, retain the schema declarations and exact constraint/index naming needed by the included migrations.