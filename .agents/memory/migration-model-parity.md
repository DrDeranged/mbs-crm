---
name: Migration-model parity
description: Why the migration replay must cover every public table and column without exclusions.
---

The migration-replay parity gate must compare every public table and column against the complete Drizzle model set. Never exclude `schema_migrations` or another operational table.

**Why:** Model declarations for production columns were removed repeatedly by unrelated branch work, causing Publish to propose destructive column drops. A table exclusion allowed the ledger regression to pass schema checks.

**How to apply:** Keep the schema parity table filter all-inclusive, replay the full applied migration set in preflight, and model the migration ledger exactly as production defines it.