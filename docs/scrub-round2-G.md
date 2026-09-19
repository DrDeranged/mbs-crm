# Production scrub, round 2 — G: behavioral pins

| Rule | Status | Evidence |
| --- | --- | --- |
| Rep Performance lists active representatives and active historical owners only; display name falls back to email local-part | PASS | `artifacts/api-server/src/lib/scrub-round2-g.test.ts:9`; production handler `artifacts/api-server/src/routes/analytics.ts:193-329`, display fallback `artifacts/api-server/src/lib/authHelpers.ts:184-203` |
| Average Funding Time excludes funding cycles shorter than 24 hours | PASS | `artifacts/api-server/src/lib/scrub-round2-g.test.ts:67`; production predicate `artifacts/api-server/src/routes/analytics.ts:67-82,116` |
| Deal export scopes representatives to their own assignments and permits an admin/manager rep filter | PASS | `artifacts/api-server/src/lib/scrub-round2-g.test.ts:80`; production scope `artifacts/api-server/src/routes/deals.ts:148-168,270` |
| Retired slugs return a canonical permanent redirect; unknown slugs retain generic output | PASS | `artifacts/api-server/src/lib/scrub-round2-g.test.ts:97`; production resolver `artifacts/api-server/src/routes/repPublic.ts:165-188` |
| Lender package statement inclusion is determined by persisted category, not statement-like filename | PASS | `artifacts/api-server/src/lib/scrub-round2-g.test.ts:122`; production selection `artifacts/api-server/src/lib/lenderPackage.ts:176-215` |
| Submission handler refuses same lead/lender duplicate within 24 hours before package creation | PASS | `artifacts/api-server/src/lib/scrub-round2-g.test.ts:134`; production duplicate guard `artifacts/api-server/src/routes/lenders.ts:489-503` |

The pins call production handlers/functions or compile the production Drizzle
predicates used by those handlers; they do not copy business rules into
test-only implementations.