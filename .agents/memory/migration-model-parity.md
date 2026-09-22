---
name: Migration-model parity
description: Why schema parity checks must not exclude operational tables.
---

Schema parity checks must cover application and operational tables without exclusions. A migration's matching application-model declarations belong to the migration scope and must remain when unrelated audit fixes are reverted.

**Why:** Excluding a table can let destructive production drift pass validation. Reverting migration-owned model alignment makes an otherwise valid migration set fail parity and leaves runtime models inconsistent with the migrated database.

**How to apply:** When changing schema validation, keep its table scope complete and treat any proposed destructive diff as a release blocker. If narrowing a change set, retain the schema declarations and exact constraint/index naming needed by the included migrations.