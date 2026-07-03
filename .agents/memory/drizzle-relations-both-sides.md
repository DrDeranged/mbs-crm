---
name: Drizzle relations must be declared on both sides
description: A relational query's `with: { relationName: ... }` fails with a cryptic error if the parent table doesn't declare that relation name in its own relations() call, even when the child table declares the inverse relation.
---

Drizzle's relational query builder (`db.query.someTable.findFirst({ with: { x: ... } })`) resolves `x` by looking it up in the `relations()` definition of `someTable` itself — not by inferring it from the child table's `relations()` definition.

If a child table (e.g. `lenderMatchesTable`) declares `lead: one(leadsTable, ...)` but the parent table's `relations()` (e.g. `leadsRelations`) never declares the corresponding `lenderMatches: many(lenderMatchesTable)`, then querying `leadsTable.findFirst({ with: { lenderMatches: true } })` throws a runtime error like `Cannot read properties of undefined (reading 'referencedTable')`. TypeScript does not catch this at compile time.

**Why:** This bit us building AI lead-briefing context aggregation — `lenderMatchesRelations` had the child-side `lead` relation, but `leadsRelations` was missing the parent-side `lenderMatches` relation, causing every briefing/draft generation call to fail at runtime despite `tsc --build` passing cleanly.

**How to apply:** Whenever adding a new relational `with` clause to a query, grep the parent table's `relations()` block first and confirm the relation name exists there — don't assume it exists just because the child table's `relations()` references the parent.
