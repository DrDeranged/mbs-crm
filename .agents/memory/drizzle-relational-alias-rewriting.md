---
name: Drizzle relational alias rewriting
description: Why correlated SQL must not be embedded in Drizzle relational query builders.
---

Do not pass correlated subqueries through Drizzle relational `findMany` or `findFirst`, even when the inner table uses `aliasedTable`. Use the core select builder to select ordered IDs, then hydrate relations with an ID-only relational query and restore the selected order.

**Why:** Drizzle can rewrite every column reference in nested SQL to the relational builder's outer alias. This produced invalid references such as an outer lead alias being used for `activity_log.lead_id` and `activity_log.created_at`; normal-builder compilation tests did not expose the runtime rewrite.

**How to apply:** Any filter or sort requiring a correlated subquery should run in a core `select().from(...)` ID phase. Add deterministic ID tie-breaking for pagination, hydrate by `inArray` only, and test the actual two-phase query path.