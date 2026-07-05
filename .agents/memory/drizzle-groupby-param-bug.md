---
name: Drizzle repeated parameterized sql fragment breaks GROUP BY
description: A sql`` template referencing a bound parameter, when reused as a computed column across SELECT/GROUP BY/ORDER BY in the same query, can fail Postgres's GROUP BY validity check even when the underlying value is identical and even when the table has rows.
---

## The rule

Never reuse a `sql` template that embeds a JS value (bound as a query parameter) as a computed
expression across multiple clauses of the same query (e.g. `select`, `groupBy`, `orderBy`) when
that computed expression needs to be recognized by Postgres as the *same* expression (e.g. so a
non-aggregated column is allowed in SELECT because it matches a GROUP BY key).

Each reference to the fragment gets compiled into its own bind parameter ($1, $2, $3, ...). Even
though all three parameters are bound to the same value at runtime, Postgres's planner validates
GROUP BY equivalence structurally/positionally, not by resolved value — so it does not treat
`date_trunc($1, col)` (in SELECT) and `date_trunc($2, col)` (in GROUP BY) as the same expression,
and rejects the query with: `column "..." must appear in the GROUP BY clause or be used in an
aggregate function`.

**Why:** This is NOT a zero-rows / empty-table bug. It reproduces identically whether the table
has 0 rows or many — it's a static SQL validity error thrown by the query planner before any rows
are scanned. If a bug report says an endpoint "500s only when the table is empty," don't assume
the empty-table branch is unique — reproduce directly against the DB with a temp row inserted too
before concluding the fix path (verified by inserting/deleting a throwaway row in this session).

**How to apply:** If the value going into the repeated expression is drawn from a small, trusted,
server-validated whitelist (not raw user text), inline it with `sql.raw` instead of interpolating
it as a bound parameter, e.g.:

```ts
// BAD: granularity is bound 3x as $1/$2/$3, GROUP BY validation can fail
const truncExpr = sql<string>`date_trunc(${granularity}, ${table.createdAt})::date::text`;

// GOOD: granularity is restricted to a fixed whitelist earlier, safe to inline as text
const truncExpr = sql<string>`date_trunc(${sql.raw(`'${granularity}'`)}, ${table.createdAt})::date::text`;
```

Never use `sql.raw` for arbitrary user input — only for values already constrained to a small
fixed set (e.g. `"day" | "week"`) by the calling code.
