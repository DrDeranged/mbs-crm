# S1 raw SQL audit (post-fix)

## Scope and reproducible count

This audit covers production TypeScript under `artifacts/api-server/src`. It
includes `.ts`/`.tsx` files, excludes files ending in `.test.ts`, and excludes
`generated` and `dist` directories. The primary inventory is every
`TaggedTemplateExpression` whose tag is the identifier `sql` (including
generic forms such as `sql<number>`). Nested tagged templates are separate
fragments. `sql.raw(...)` is reviewed separately because its argument is an
ordinary template expression, not a tagged `sql` expression. Relational
`findMany`/`findFirst` calls were also reviewed for a correlated fragment in
their `where`/`orderBy` input.

The count is reproducible with the TypeScript compiler API. From the workspace
root, run the following (the command deliberately does not execute application
code):

```sh
node --input-type=module <<'EOF'
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const root = "artifacts/api-server/src";
function files(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!["generated", "dist"].includes(entry.name)) result.push(...files(file));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
      result.push(file);
    }
  }
  return result;
}

let count = 0;
for (const file of files(root)) {
  const text = fs.readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  function visit(node) {
    if (ts.isTaggedTemplateExpression(node) &&
        node.tag.kind === ts.SyntaxKind.Identifier &&
        node.tag.text === "sql") {
      count++;
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      console.log(`${file}:${line + 1}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
console.log(`COUNT ${count}`);
EOF
```

The resulting AST count is **59**. The original rough expectation was
approximately **28**; that estimate did not count every expression (notably
typed `sql<T>` expressions and nested `sql` fragments).

## Exhaustive current fragment inventory

There is exactly one row below for each of the 59 current AST fragments.
`FIXED` means the current fragment is the post-remediation representation of a
previously unsafe logical site; it is not a finding that remains unsafe.
Table paths are relative to `artifacts/api-server/` (so `src/...` identifies
the exact production file).

| # | Current file:line | Concise purpose | Verdict | Rationale |
|---:|---|---|---|---|
| 1 | `src/lib/aiAssistant.ts:328` | Count lender matches | SAFE | Aggregate only; table column is interpolated through Drizzle. |
| 2 | `src/lib/aiAssistant.ts:351` | Count assistant result rows | SAFE | Static aggregate with no identifier or value interpolation. |
| 3 | `src/lib/emailRateLimiter.ts:14` | Acquire email-rate advisory lock | SAFE | Static lock expression; no request-controlled SQL. |
| 4 | `src/lib/emailRateLimiter.ts:16` | Count rate-limit slots | SAFE | Static aggregate. |
| 5 | `src/lib/emailSafety.ts:13` | Case/whitespace-normalized email match | SAFE | Column reference plus bound normalized input. |
| 6 | `src/lib/latestActivitySort.ts:10` | Correlated latest deal-activity sort | FIXED | Dedicated activity alias prevents relation-alias capture; callers use an ID phase before relational hydration. |
| 7 | `src/lib/leadDistribution.ts:22` | Acquire round-robin advisory lock | SAFE | Lock key is a bound interpolation; no SQL identifier interpolation. |
| 8 | `src/lib/productionMaintenance.ts:125` | Count lender rows | SAFE | Static aggregate. |
| 9 | `src/lib/productionMaintenance.ts:133` | Count lender rows | SAFE | Static aggregate. |
| 10 | `src/lib/productionMaintenance.ts:141` | Count lender rows | SAFE | Static aggregate. |
| 11 | `src/lib/productionMaintenance.ts:234` | Acquire lender-seed advisory lock | SAFE | Static lock expression. |
| 12 | `src/lib/productionMaintenance.ts:236` | Build lender-name `IN` predicate | SAFE | `sql.join` combines a fixed seed set; values remain bound. |
| 13 | `src/lib/productionMaintenance.ts:236` | Bind one lender seed name | SAFE | `${seed.name}` is a value parameter, not SQL text. |
| 14 | `src/lib/productionMaintenance.ts:236` | Join seed values with commas | SAFE | Static separator fragment. |
| 15 | `src/lib/productionMaintenance.ts:256` | Build second lender-name `IN` predicate | SAFE | `sql.join` combines a fixed seed set; values remain bound. |
| 16 | `src/lib/productionMaintenance.ts:256` | Bind one lender seed name | SAFE | `${seed.name}` is a value parameter, not SQL text. |
| 17 | `src/lib/productionMaintenance.ts:256` | Join seed values with commas | SAFE | Static separator fragment. |
| 18 | `src/lib/productionMaintenance.ts:280` | Acquire second lender-seed advisory lock | SAFE | Static lock expression. |
| 19 | `src/lib/staleLeadCondition.ts:10` | Correlated stale-lead predicate | FIXED | Dedicated activity alias preserves correlation; stale list/export use core ID selection and ID-only relational hydration. |
| 20 | `src/routes/analytics.ts:39` | Count unassigned inbound leads | SAFE | Static aggregate over a shared typed predicate. |
| 21 | `src/routes/analytics.ts:79` | Count leads by status | SAFE | Static aggregate. |
| 22 | `src/routes/analytics.ts:87` | Count leads in selected range | SAFE | Static aggregate. |
| 23 | `src/routes/analytics.ts:95` | Count all-time leads | SAFE | Static aggregate. |
| 24 | `src/routes/analytics.ts:102` | Average lead-to-funded days | SAFE | Arithmetic over columns from an explicit join; no correlated relation fragment. |
| 25 | `src/routes/analytics.ts:109` | Exclude near-immediate funded history | SAFE | Direct columns from the explicit `leadStatusHistory`/`leads` join. |
| 26 | `src/routes/analytics.ts:119` | Sum funded revenue | SAFE | Aggregate over a typed table column. |
| 27 | `src/routes/analytics.ts:162` | Count pipeline rows by status | SAFE | Static aggregate. |
| 28 | `src/routes/analytics.ts:216` | Count rep leads by status | SAFE | Static aggregate. |
| 29 | `src/routes/analytics.ts:225` | Sum rep funded revenue | SAFE | Aggregate over a typed table column. |
| 30 | `src/routes/analytics.ts:234` | Count outbound calls | SAFE | Static aggregate. |
| 31 | `src/routes/analytics.ts:249` | Count outbound SMS | SAFE | Static aggregate. |
| 32 | `src/routes/analytics.ts:264` | Count rep email sends | SAFE | Static aggregate. |
| 33 | `src/routes/analytics.ts:333` | Count leads by source | SAFE | Static aggregate. |
| 34 | `src/routes/analytics.ts:334` | Sum source revenue | SAFE | Aggregate over a typed table column. |
| 35 | `src/routes/analytics.ts:382` | Group communications by date granularity | FIXED | Granularity is a two-value whitelist; only that fixed SQL literal is inlined, avoiding the repeated-parameter `GROUP BY` correctness bug. |
| 36 | `src/routes/analytics.ts:388` | Count communications by type/date | SAFE | Static aggregate. |
| 37 | `src/routes/credit.ts:432` | Apply compliance-log end date | SAFE | Date is a bound value; table column is typed. |
| 38 | `src/routes/credit.ts:488` | Apply compliance-log end date | SAFE | Date is a bound value; table column is typed. |
| 39 | `src/routes/dashboard.ts:67` | Count dashboard leads | SAFE | Static aggregate. |
| 40 | `src/routes/dashboard.ts:80` | Count dashboard lead IDs | SAFE | Aggregate over a typed lead ID. |
| 41 | `src/routes/dashboard.ts:132` | Count dashboard rows | SAFE | Static aggregate. |
| 42 | `src/routes/deals.ts:126` | Count total deals | SAFE | Static aggregate. |
| 43 | `src/routes/deals.ts:223` | Set export transaction isolation | SAFE | Static transaction-setting statement. |
| 44 | `src/routes/deals.ts:533` | Count deals by stage | SAFE | Static aggregate. |
| 45 | `src/routes/deals.ts:534` | Sum funded gross margin | SAFE | Aggregate over a typed deal column. |
| 46 | `src/routes/deals.ts:535` | Sum active approximate gross margin | SAFE | Aggregate over a typed deal column. |
| 47 | `src/routes/deals.ts:536` | Sum active deal amount | SAFE | Aggregate over a typed deal column. |
| 48 | `src/routes/deals.ts:537` | Average funded duration | SAFE | Arithmetic over typed deal columns. |
| 49 | `src/routes/deals.ts:540` | Exclude near-immediate funding | SAFE | Direct typed deal-column comparison with a static interval. |
| 50 | `src/routes/deals.ts:556` | Count active deals per rep | SAFE | Active stages now come from `inArray`, not raw SQL text. |
| 51 | `src/routes/deals.ts:557` | Count funded deals per rep | SAFE | Static aggregate. |
| 52 | `src/routes/deals.ts:557` | Sum funded gross margin per rep | SAFE | Aggregate over a typed deal column. |
| 53 | `src/routes/deals.ts:636` | Count qualifying deals | SAFE | Static aggregate. |
| 54 | `src/routes/health.ts:24` | Database health probe | SAFE | Static `SELECT 1`. |
| 55 | `src/routes/leads.ts:225` | Filter renewal-flagged leads | SAFE | Static null test over a typed lead column. |
| 56 | `src/routes/leads.ts:264` | Count total leads | SAFE | Static aggregate. |
| 57 | `src/routes/leads.ts:587` | Filter renewal-flagged export rows | SAFE | Static null test over a typed lead column. |
| 58 | `src/routes/leads.ts:657` | Set export transaction isolation | SAFE | Static transaction-setting statement. |
| 59 | `src/routes/leads.ts:819` | Exclude already-assigned target rep | SAFE | Typed column comparison and bound request value; no identifier interpolation. |

## `sql.raw` and relational-query review

The current production scan finds one `sql.raw` call:
`src/routes/analytics.ts:382`, inside the fragment in row 35. Its input is
limited immediately beforehand to `"day"` or `"week"` and is emitted as a SQL
literal solely because using three separate bind parameters for the same
`date_trunc` expression breaks PostgreSQL's `GROUP BY` equivalence check. No
request-controlled identifier, clause, or arbitrary SQL text reaches `raw`.

Every production relational `findMany`/`findFirst` was checked for embedded
SQL and correlated table references. The only correlated cases are the stale
lead predicate and latest deal-activity sort. Both now have explicit,
non-colliding activity aliases, and their affected list/export paths perform
the correlated/core query in an ID phase followed by relational hydration
using `inArray` IDs. The bulk-assignment relational lookup can also receive the
stale predicate through its filter builder; it uses the same explicit activity
alias, so the inner activity columns cannot be rewritten as lead-relation
columns. Other relational SQL predicates are local typed-column tests (for
example the renewal and assignment filters), not correlated subqueries.

The two-phase helpers add **zero** new `sql` tagged templates: they use the
core select builder and `inArray` for hydration. They do introduce safe query
steps, not additional raw-SQL fragments. The two fixed correlated expressions
are now consolidated in `staleLeadCondition.ts` and
`latestActivitySort.ts`.

## Closure and totals

The five originally unsafe logical sites are fixed:

1. Active-deal stages in the main deal analytics query: raw `IN (...)` replaced
   by `activeDealStageCondition()`/`inArray`.
2. Active-deal stages in per-rep analytics: same bound `inArray` replacement.
3. Communications `date_trunc` granularity: whitelist-gated literal only,
   retaining correct grouping semantics.
4. Stale-lead correlated activity predicate: explicit alias plus two-phase
   selection/hydration at the affected list/export paths.
5. Latest-deal-activity correlated sort: explicit alias plus two-phase
   selection/hydration at the affected list/export paths.

Current AST-fragment totals: **59 total = 56 SAFE + 3 FIXED**. The three
`FIXED` rows are the current post-fix representations of the date-trunc,
stale-correlated, and latest-activity logical fixes. The two active-stage fixes
remove their former raw tagged fragments entirely, so they have no current
fragment row. Historical unsafe logical-site total: **5 FIXED, 0 remaining
unsafe**.

There is no remaining unsafe alias/correlation, SQL-injection, or SQL
correctness class in the reviewed production paths.