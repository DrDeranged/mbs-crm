# Production scrub round 2 — C: raw SQL and relational predicates

**Baseline:** `c31530bfeb3b00fb14fbd61ef5e82e38ed617c60`, whose parent
chain contains `76e15ed5fe57ba7233d802d38899f604b3dee4ea`. The worktree was
clean before this audit. This document is the only workspace write. No
production/development data was written, no migration was applied, and no code
was changed.

## Result

| Outcome | Count | Evidence |
|---|---:|---|
| PASS | 279 | 67 tagged `sql` AST nodes and 212 `db.query.*.findMany/findFirst` calls. |
| FAIL | 0 | No request-controlled SQL text, unsafe identifier interpolation, unaliased relational correlation, or repeated bound GROUP BY expression. |
| BLOCKED | 0 | No C-scope execution blocker. Post-B type follow-up is not a query failure. |

## Method and reason codes

The audit parsed executable TypeScript in `artifacts/api-server/src` and
`lib/db/src`, excluding tests, generated output, `dist`, and dependencies.
No SQL/query-builder calls were found in `scripts`. Nested `sql` templates are
counted separately: **67** tagged templates and **2** `sql.raw` calls. The
relational scan found **212** calls: **205** with `where`, **7** without.

All 45 uses of `with` were checked against the parent-side declarations in
`lib/db/src/schema/relations.ts:25-270`. Schema objects provide identifiers;
Drizzle binds values; dynamic sorts use local whitelists; and LIKE text is
escaped before interpolation.

| Code | Verdict and safe reason |
|---|---|
| S | **PASS** — static aggregate, interval, transaction, or health statement; no request-controlled SQL text. |
| V | **PASS** — schema table/column plus values bound by Drizzle; `sql.join` has a static delimiter. |
| F | **PASS (fixed)** — distinct `aliasedTable` correlation plus core ID phase, `inArray` hydration, deterministic reorder. |
| G | **PASS (fixed)** — closed `"day" \| "week"` raw literal reuses `date_trunc` in SELECT/GROUP BY/ORDER BY, avoiding the repeated-bound-parameter PostgreSQL bug. |
| M | **PASS** — migration metadata is bound; the migration executor runs source-controlled numbered local files, not request input. |
| P | **PASS** — direct local Drizzle `eq`/`ne`/`and`/`or`/`inArray`/null predicate over schema columns and bound values; no SQL fragment or subquery. |
| D | **PASS** — locally composed Drizzle clauses, role branch, or validated filter; no raw SQL. |
| L | **PASS** — local `sql` condition uses typed columns and a bound value; it is not correlated. |
| N | **PASS** — no `where` option (included for complete relational-query coverage). |

## A. Tagged `sql` inventory (67)

Each parenthesized item is `file:line(reason-code)`. Repeated locations are
distinct nested tagged templates.

| File | Complete tagged-template inventory |
|---|---|
| `src/lib/aiAssistant.ts` | `328(V), 351(S)` |
| `src/lib/dealMetrics.ts` | `6(V)` |
| `src/lib/emailRateLimiter.ts` | `14(S), 16(S)` |
| `src/lib/emailSafety.ts` | `13(V)` |
| `src/lib/latestActivitySort.ts` | `10(F)` |
| `src/lib/leadDistribution.ts` | `22(V)` |
| `src/lib/productionMaintenance.ts` | `135(S), 143(S), 151(S), 273(S), 275(V), 275(V), 275(V), 356(V), 356(V), 356(V), 414(S)` |
| `src/lib/staleLeadCondition.ts` | `10(F)` |
| `src/routes/analytics.ts` | `39(S), 79(S), 87(S), 95(S), 102(V), 109(V), 119(V), 162(S), 232(S), 241(V), 250(S), 265(S), 280(S), 353(S), 354(V), 402(G), 408(S)` |
| `src/routes/credit.ts` | `432(V), 488(V)` |
| `src/routes/dashboard.ts` | `67(S), 80(V), 132(S)` |
| `src/routes/deals.ts` | `189(S), 299(S), 763(S), 777(V), 783(V), 789(V), 796(V), 821(S), 826(S), 827(V), 1098(S)` |
| `src/routes/health.ts` | `28(S)` |
| `src/routes/leads.ts` | `160(V), 198(S), 399(V), 469(S), 631(V)` |
| `lib/db/src/migrate.ts` | `122(M), 130(M), 135(M), 135(M), 202(M), 250(M), 311(M), 342(M)` |

### Direct `sql.raw` calls

| File:line | Result |
|---|---|
| `artifacts/api-server/src/routes/analytics.ts:402` | **PASS (G)** — immediately preceding lines `389-402` narrow `granularity` to `day` or `week`; it is the documented GROUP BY exception. |
| `lib/db/src/migrate.ts:341` | **PASS (M)** — intentional trusted migration executor. `discoverMigrations` reads only numbered local files at lines `94-114`; no request value is a source. |

## B. Relational `findMany/findFirst` inventory (212)

The exact call-site `where` class is shown beside every location. P means the
literal expression at that location is a local schema-column Drizzle predicate
(the operators are enumerated in the reason-code table); D/F/L expressions are
spelled out after this table.

| File | Complete `findMany/findFirst` inventory |
|---|---|
| `src/lib/aiAssistant.ts` | `68(P), 109(P), 126(P), 544(P)` |
| `src/lib/authHelpers.ts` | `107(P), 116(P)` |
| `src/lib/dripJob.ts` | `47(P), 109(P), 122(P)` |
| `src/lib/idempotency.ts` | `14(P)` |
| `src/lib/leadDistribution.ts` | `94(P)` |
| `src/lib/leadScoring.ts` | `183(P), 187(P), 188(P)` |
| `src/lib/lenderPackage.ts` | `814(P), 826(P), 835(P), 837(P), 910(P), 955(P), 959(P), 960(P), 961(P)` |
| `src/lib/matchingEngine.ts` | `28(P), 35(P)` |
| `src/lib/notify.ts` | `37(P), 54(P)` |
| `src/lib/renewalJob.ts` | `28(P), 65(P)` |
| `src/lib/workflowEngine.ts` | `75(P)` |
| `src/routes/activity.ts` | `20(P), 30(P)` |
| `src/routes/adminGovernance.ts` | `33(P), 36(P), 97(N), 154(N), 223(P), 275(P), 330(P), 355(P)` |
| `src/routes/ai.ts` | `40(P)` |
| `src/routes/analytics.ts` | `438(D)` |
| `src/routes/applicationForm.ts` | `32(P)` |
| `src/routes/applications.ts` | `181(D), 227(P), 397(P), 525(P), 564(P), 570(P), 621(P), 627(P), 703(P), 716(P), 723(P)` |
| `src/routes/communications.ts` | `63(P), 108(P), 156(P), 172(P), 179(P), 218(P)` |
| `src/routes/credit.ts` | `163(P), 207(P), 230(P), 379(P), 386(P), 442(N), 493(D)` |
| `src/routes/dashboard.ts` | `70(N), 114(D), 120(P), 125(D), 169(D), 174(D)` |
| `src/routes/deals.ts` | `130(P), 209(F), 217(N), 313(F), 319(N), 438(P), 480(P), 578(P), 630(P), 641(P), 663(P), 685(P), 1086(P), 1106(P), 1133(P), 1167(P)` |
| `src/routes/documents.ts` | `71(P), 81(P), 104(P), 163(P), 170(P), 210(P), 216(P)` |
| `src/routes/drip.ts` | `76(D), 117(P), 144(P), 184(P), 200(P), 235(P), 242(P), 263(P), 273(P), 305(P), 309(P)` |
| `src/routes/email.ts` | `103(P), 364(P), 402(P), 447(P), 483(P), 492(P), 493(P), 501(P), 558(P), 584(P), 592(P), 593(P), 637(D), 652(P), 692(P), 722(P), 748(P), 756(P), 762(P), 784(P), 790(P), 852(P), 859(P)` |
| `src/routes/flyer-templates.ts` | `217(P), 237(P), 272(P)` |
| `src/routes/flyers.ts` | `28(P), 46(P), 57(P), 129(P), 144(P), 169(P), 170(P), 195(P), 206(P), 283(P)` |
| `src/routes/import.ts` | `242(P)` |
| `src/routes/leads.ts` | `98(N), 209(F), 217(D), 257(D), 483(F), 489(D), 561(P), 607(P), 628(L), 709(P), 734(P), 825(P), 844(P), 855(P), 895(P), 956(P), 965(P), 1006(P), 1053(P), 1065(P)` |
| `src/routes/lenders.ts` | `246(P), 275(P), 318(P), 352(P), 436(P), 445(P), 469(P), 484(P), 497(P), 503(P), 505(P), 537(P), 543(P), 663(P), 680(P), 724(P), 751(P), 754(P), 775(P), 821(P)` |
| `src/routes/notes.ts` | `21(P), 31(P), 63(P)` |
| `src/routes/notifications.ts` | `44(P)` |
| `src/routes/repPublic.ts` | `44(P), 60(P), 319(P), 331(P)` |
| `src/routes/sendgrid.ts` | `46(P), 67(P)` |
| `src/routes/storage.ts` | `105(P), 114(P)` |
| `src/routes/tasks.ts` | `36(P), 46(P), 71(P), 119(P), 125(P)` |
| `src/routes/twilio.ts` | `116(P), 147(P), 165(P), 185(P), 292(P)` |
| `src/routes/users.ts` | `109(D), 144(P), 154(P), 164(P)` |
| `src/routes/workflowRules.ts` | `77(P), 98(P)` |

### Non-P call-site expressions

| File:line | Exact `where` expression | Result |
|---|---|---|
| `src/routes/analytics.ts:438` | `and(...clauses)` | **PASS (D)** |
| `src/routes/applications.ts:181` | `or(...conditions)` | **PASS (D)** |
| `src/routes/credit.ts:493` | `and(...conditions)` | **PASS (D)** |
| `src/routes/dashboard.ts:114` | `repFilter` | **PASS (D)** |
| `src/routes/dashboard.ts:125` | `user.role === "rep" ? eq(activityLogTable.userId, user.id) : undefined` | **PASS (D)** |
| `src/routes/dashboard.ts:169` | `and(eq(tasksTable.isCompleted, false), extraWhere)` | **PASS (D)** |
| `src/routes/dashboard.ts:174` | `and(eq(tasksTable.userId, user.id), eq(tasksTable.isCompleted, false), extraWhere)` | **PASS (D)** |
| `src/routes/deals.ts:209,313` | `buildDealHydrationWhere(dealIds/pageIds)` | **PASS (F)** |
| `src/routes/drip.ts:76` | `user.role === "rep" ? eq(dripSequencesTable.createdBy, user.id) : undefined` | **PASS (D)** |
| `src/routes/email.ts:637` | `user.role === "rep" ? eq(emailTemplatesTable.createdBy, user.id) : undefined` | **PASS (D)** |
| `src/routes/leads.ts:209,483` | `buildLeadHydrationWhere(leadIds/pageIds)` | **PASS (F)** |
| `src/routes/leads.ts:217` | `whereClause as any` | **PASS (D)** — locally assembled parsed filters. |
| `src/routes/leads.ts:257` | `or(...conditions)` | **PASS (D)** |
| `src/routes/leads.ts:489` | `leadWhere` | **PASS (D)** |
| `src/routes/leads.ts:628` | `and(assignmentWhere as any, sql\`${leadsTable.assignedRepId} is distinct from ${body.data.repId}\`) as any` | **PASS (L)** |
| `src/routes/users.ts:109` | parsed role/activity `and(...)` or `undefined` | **PASS (D)** |
| `src/routes/adminGovernance.ts:97,154`; `routes/credit.ts:442`; `routes/dashboard.ts:70`; `routes/deals.ts:217,319`; `routes/leads.ts:98` | no `where` option | **PASS (N)** |

## C. Correlation, relation, and GROUP BY checks

* **PASS (F):** `src/lib/staleLeadCondition.ts:3-14` uses
  `aliasedTable(activityLogTable, "stale_lead_activity")`, correlating only to
  `leads.id`. `routes/leads.ts:201-213` selects IDs with the core builder, then
  hydrates them separately.
* **PASS (F):** `src/lib/latestActivitySort.ts:4-11` uses
  `latest_deal_activity`, correlating only to `deals.id`. List/export use the
  same two-phase pattern at `routes/deals.ts:194-224` and `302-324`.
* **PASS:** all relation names requested via `with` are declared on their
  parent side: leads `relations.ts:25-45`, deals `136-147`, activity
  `121-134`, documents `99-108`, tasks `88-97`, drip `169-198`, email
  templates/sends `160-167,200-213`, credit `235-245`, and notifications
  `268-271`.
* **PASS (G):** `routes/analytics.ts:389-413` narrows `granularity` before
  making the whitelist raw literal and reuses that one `truncExpr` object in
  select/group/order. No other computed parameterized GROUP BY key is reused.

## Findings and exact implementation suggestions

### FAIL — none

No C-scope code change is warranted. Do **not** move either F subquery into a
relational `where`, and do **not** bind G's `date_trunc` unit; those changes
reintroduce known runtime failures.

### BLOCKED — none

### Post-B recheck (not a C failure)

After B removes request-input `any`, regenerate this inventory and:

1. In `src/routes/leads.ts:140-180,217-218,489,628-632`, replace
   `q/conditions/whereClause/assignmentWhere as any` with precise parsed-Zod
   and Drizzle-condition types. Preserve `validSortFields` and
   `sanitizeLikeInput`; never turn a sort key into `sql.raw`.
2. In `src/routes/flyer-templates.ts:217`, `src/routes/lenders.ts:484-505`,
   and `src/lib/dripJob.ts:47`, infer relational callback types or use a
   precise condition-array type in place of `any`. These are typing gaps, not
   SQL-injection paths in this audited revision.
3. New dynamic sort/group expressions must be closed server-side whitelists.
   A value reused in SELECT/GROUP BY/ORDER BY must follow G; other values stay
   bound.

**Baseline C result: PASS 279 / FAIL 0 / BLOCKED 0. See the current-working-tree
refresh below for the D/E/B in-flight result.**

## E. Current working-tree refresh — 2026-09-16T15:32:53Z

This is a second, read-only AST scan after the D/E additions and the current B
typed-callback edits. It is intentionally a working-tree result, not a commit
result: at scan time the following C-relevant files were modified or untracked
and therefore remain **in flight**:

* `src/lib/leadDistribution.ts`, `src/lib/staleLeadReassignment.ts`,
  `src/lib/authHelpers.ts`, and `src/routes/analytics.ts`;
* `src/routes/applications.ts`, `src/routes/drip.ts`, `src/routes/email.ts`,
  `src/routes/flyers.ts`, `src/routes/leads.ts`, `src/routes/deals.ts`, and
  `src/routes/settings.ts`;
* `lib/db/src/schema/relations.ts`,
  `lib/db/src/schema/companySettings.ts`,
  `lib/db/src/schema/dripSequences.ts`, and
  `lib/db/src/schema/emailTemplates.ts`.

The current scan contains **70** tagged `sql` templates, **2** direct
`sql.raw` calls, and **213** relational `findMany/findFirst` calls (**205**
with `where`, **8** without). It therefore supersedes the baseline totals for
the in-flight files.

| Outcome | Count | Evidence |
|---|---:|---|
| PASS | 282 | All baseline-safe sites that remain, plus the four safe SQL additions and current B callback/query changes below. |
| FAIL | 1 | `src/lib/staleLeadReassignment.ts:22` passes a correlated raw predicate to Drizzle's relational query builder. |
| BLOCKED | 0 | The failure is statically determinable; it does not require database access to correct. |

### Added/changed SQL fragments — current safety inventory

| File:line | Fragment | Result and reason |
|---|---|---|
| `src/routes/analytics.ts:90` | `sql\`${leadStatusHistoryTable.createdAt} >= ${leadsTable.createdAt} + interval '24 hours'\`` | **PASS (V)** — fixed interval and schema columns only; no dynamic SQL identifier or text. |
| `src/routes/applications.ts:238` | `sql\`SELECT pg_advisory_xact_lock(hashtext(${identityKey}))\`` | **PASS (V)** — `identityKey` is bound as a value to `hashtext`; it cannot alter SQL syntax. |
| `src/routes/applications.ts:242` | `sql\`lower(${leadsTable.email}) = ${normalizedEmail}\`` | **PASS (V)** — typed email column and bound normalized value. |
| `src/routes/applications.ts:243` | `sql\`regexp_replace(${leadsTable.phone}, '[^0-9]', '', 'g') = ${normalizedPhone}\`` | **PASS (V)** — static regular expression/replacement/flag, typed phone column, bound normalized value. |

The advisory-lock template in `src/lib/leadDistribution.ts:36` is the
line-shifted existing template formerly at line 22, not a new logical
fragment. Its result remains **PASS (V)**: the fixed integer lock key is bound.
All other baseline `sql` sites moved only by line number.

### Added/changed relational call-site inventory

| File:line | `where` expression | Result and reason |
|---|---|---|
| `src/lib/staleLeadReassignment.ts:22` | `and(eq(leadsTable.leadSource, "website"), buildStaleLeadCondition(settings.staleDays))` | **FAIL** — `buildStaleLeadCondition` is a correlated `sql` subquery. It is embedded in `db.query.leadsTable.findMany`, where Drizzle may rewrite the activity-table references to the outer relation alias. |
| `src/routes/applications.ts:245` | `or(...duplicateConditions)` | **PASS (D)** — `duplicateConditions` comprises only the bound fragments at lines 242–243 above. |
| `src/routes/drip.ts:81` | no `where`; result is filtered in memory with `canReadMarketingResource` | **PASS (N)** for SQL safety. The fetched relations (`creator`, `owner`, `steps`) are parent-side declarations in `relations.ts:160-176`. |
| `src/routes/drip.ts:125,153` | `eq(dripSequencesTable.id, id)` | **PASS (P)** — bound parsed ID; `owner` relation is declared at `relations.ts:169-176`. |
| `src/routes/drip.ts:219` | `inArray(emailTemplatesTable.id, templateIds)` | **PASS (P)** — bound numeric ID list; `owner` relation is declared at `relations.ts:160-167`. |
| `src/routes/email.ts:673` | no `where`; result is filtered in memory with `canReadMarketingResource` | **PASS (N)** for SQL safety; `creator`/`owner` exist at `relations.ts:160-167`. |
| `src/routes/email.ts:690,735,794` | `eq(emailTemplatesTable.id, id.data)` | **PASS (P)** — bound validated ID; `owner` exists at `relations.ts:160-167`. |
| `src/routes/flyers.ts:58` | `eq(flyerTemplatesTable.id, templateId)` | **PASS (P)** — typed, validated/bound ID. |

The remaining current line shifts and B callback typing changes were scanned
and remain in their baseline P/D/L/F/N categories. Notably, the former
rep-filtered template/sequence SQL queries are now no-`where` relational
loads followed by the ownership helper; that is not raw SQL, alias rewriting,
or relational predicate construction.

### Required implementation correction for the FAIL

Replace the relational builder at
`artifacts/api-server/src/lib/staleLeadReassignment.ts:22-27` with a **core**
`select(...).from(leadsTable).where(and(...))` query that selects the existing
`id`, `assignedRepId`, and `leadSource` fields, retains the limit, and
deterministically orders by `leadsTable.id`. Do not put
`buildStaleLeadCondition()` in `db.query.leadsTable.findMany`. If a relational
hydration step becomes necessary later, select ordered IDs in the core phase,
hydrate with `inArray(leadsTable.id, ids)`, then restore the ID order.

This correction is required even though `staleLeadCondition.ts` itself has the
right explicit alias: the alias is only safe when it is compiled by a core
select, as in the existing list/export paths. This is the relational
alias-rewriting failure documented by the current audit.

**Superseded by the final exact-worktree refresh below.**

## F. Final exact-worktree refresh — 2026-09-16T15:40:48Z

This final read-only AST scan covers the exact current TypeScript worktree in
`artifacts/api-server/src` and `lib/db/src`, excluding tests, generated files,
build output, and dependencies. It found **74** tagged `sql` templates, **2**
direct `sql.raw` calls, and **213** relational `findMany/findFirst` calls
(**205** with a `where`, **8** intentionally without one). The 49 current
`with` options were rechecked against their queried parent relations.

| Outcome | Count | Evidence |
|---|---:|---|
| PASS | 287 | 74 tagged-template and 213 relational call sites are safe under the reason codes above. |
| FAIL | 0 | The only prior FAIL now uses the core builder. |
| BLOCKED | 0 | All results are statically determinable; no database access is required. |

### Resolved correlated-predicate finding

`src/lib/staleLeadReassignment.ts:24-40` now uses
`database.select(...).from(leadsTable).where(and(...buildStaleLeadCondition...))`
instead of a relational `findMany`. It selects only `id`, `assignedRepId`, and
`leadSource`; that is **PASS (F)** because the correlated predicate and outer
`FROM leadsTable` are compiled by the core builder.

The stale-write compare-and-set at
`src/lib/staleLeadReassignment.ts:65-73` also uses the core
`update(leadsTable).where(...)` builder. Its repeated
`buildStaleLeadCondition(settings.staleDays)` remains **PASS (F)** for the same
reason: it is not passed through a Drizzle relational query. The transaction
calls `pickNextInboundAssigneeInTransaction` before this conditional update;
the helper's advisory lock at `src/lib/leadDistribution.ts:47` is **PASS (V)**:
the module-private constant is bound as a value, not interpolated as SQL text.

### F email-compliance/daily-budget SQL — complete new inventory

| File:line | Fragment / use | Result and reason |
|---|---|---|
| `src/routes/email.ts:269` | `sql<number>\`count(*)\`` for the displayed allowance | **PASS (S)** — fixed aggregate; the delivery-kind set and UTC-day boundary are schema predicates/bound values. |
| `src/routes/email.ts:327` | `sql\`SELECT pg_advisory_xact_lock(hashtext('mbs-email-daily-marketing-cap'))\`` | **PASS (S)** — entirely source-controlled constant statement. |
| `src/routes/email.ts:332` | `sql<number>\`count(*)\`` inside the lock transaction | **PASS (S)** — fixed aggregate; it uses the same typed delivery-kind/day predicates before queueing a record. |
| `src/routes/health.ts:92` | `sql\`${emailSendsTable.sentAt} IS NOT NULL\`` | **PASS (V)** — schema column plus fixed SQL syntax, no external text. |
| `lib/db/migrations/024_email_compliance_daily_budget.sql:1-18` | additive settings/send classification and index DDL | **PASS (M)** — source-controlled, append-only migration SQL; it contains no runtime interpolation and remains unapplied in this audit. |

These four tagged templates account for the increase from the preceding
70-template refresh to 74. Neither direct `sql.raw` call is new: analytics
retains the closed `day|week` GROUP BY literal exception, and the migration
executor retains its source-controlled file content.

### Current relational-predicate and relation recheck

* **PASS (L):** the two new transactional duplicate lookups are
  `src/routes/applications.ts:253-255`
  (`lower(leads.email) = normalizedEmail`) and `:258-260`
  (`regexp_replace(leads.phone, ...) = normalizedPhone`). Each has a typed
  `leads` column, static function text, and a bound normalized value. They are
  non-correlated conditions, so relational alias rewriting cannot capture an
  inner table reference.
* **PASS (P):** current ownership queries use validated/bound identifiers or
  ID lists: drip sequence reads at `src/routes/drip.ts:156,190,233,249,339`,
  template membership at `:260`, and email template reads at
  `src/routes/email.ts:591,651,757,802,832,861,910`.
* **PASS (N):** the ownership list loads at
  `src/routes/drip.ts:111` and `src/routes/email.ts:740` deliberately have no
  `where`; authorization is applied to the resulting owner relation in memory.
  This is recorded rather than silently omitted from the 213-call inventory.
* **PASS (P):** F's SendGrid webhook lookups at
  `src/routes/sendgrid.ts:58-64` and `:79-81` use an `and` of equality
  predicates and a bound `inArray` candidate list, respectively.
* **PASS:** all 49 current `with` options name relations declared on the
  queried parent. In particular, email templates define `creator` and `owner`
  at `lib/db/src/schema/relations.ts:160-172`; drip sequences define
  `creator`, `owner`, `steps`, and `enrollments` at `:174-186`; a step defines
  `template` at `:188-197`; and an enrollment defines `sequence` at
  `:199-208`. This covers the nested current drip requests at
  `src/routes/drip.ts:156,305,339,381`.
* **PASS (G):** analytics still narrows the `date_trunc` unit to the closed
  `day|week` whitelist before its one `sql.raw` expression, and reuses that
  expression in select/group/order. No new repeated bound computed GROUP BY
  expression was introduced.

The funding-time eligibility replacement at
`src/routes/analytics.ts:90` is **PASS (V)**: both operands are schema columns
and `interval '24 hours'` is fixed source text. The previous five-minute
predicate was removed, so this is a replacement rather than an additional
unreviewed correlation.

**Final C result: PASS 287 / FAIL 0 / BLOCKED 0.**