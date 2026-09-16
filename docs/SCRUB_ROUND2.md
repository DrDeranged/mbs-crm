# Production scrub — round 2

Date: 2026-09-16. Starting working tree was clean at
`c31530bfeb3b00fb14fbd61ef5e82e38ed617c60`, a descendant of `76e15ed`.
Production access was restricted to metadata and aggregate SELECT queries.
No production records, settings, or schemas were changed. No deployment occurred.

## Results by section

Counts below are requirement/evidence rows, not test-case counts. C counts audited
SQL/relational sites. PASS describes the stated evidence class; it does not
convert a mocked or source-level check into a live database/browser check.

| Section | PASS | FAIL | BLOCKED | Evidence |
|---|---:|---:|---:|---|
| A — Regression pass | 43 | 1 | 1 | [Per-requirement matrix](scrub-round2-A.md:14), [fixtures and rollback observations](SCRUB_ROUND2_FIXTURES.md) |
| B — Input typing | 27 | 0 | 0 | [Route inventory and remaining adapter types](scrub-round2-B.md:9) |
| C — Raw SQL and relational predicates | 287 | 0 | 0 | [Final audit](scrub-round2-C.md:268); prior findings retained as audit history, not current failures |
| D — Routing and marketing ownership | 8 | 0 | 0 | [API/UI evidence](scrub-round2-D.md:3), `artifacts/api-server/src/lib/scrub-round2-d.test.ts` |
| E — Re-application | 9 | 0 | 0 | [History/identity/token safety](scrub-round2-E.md:3), `artifacts/api-server/src/lib/applicationSubmitRoute.test.ts` |
| F — Email compliance | 5 | 0 | 0 | [Dispatch/webhook/quota proof](scrub-round2-F.md:3), `artifacts/api-server/src/lib/scrub-round2-f.test.ts` |
| G — Behavioral pins | 6 | 0 | 0 | [Production-handler pins](scrub-round2-G.md:3), `artifacts/api-server/src/lib/scrub-round2-g.test.ts` |
| H — Observability | 5 | 0 | 0 | [Logging/rendering evidence](scrub-round2-H.md:5), `artifacts/api-server/src/lib/flyerObservability.integration.test.ts` |
| I — Production data hygiene | 3 | 2 | 0 | [Exact read-only SQL and results](scrub-round2-I.md:7) |
| J — Final verification | 5 | 1 | 1 | Verification matrix below |

The interim A count of 46 PASS was a counting error; the final matrix has
43 individual PASS rows. B's two interim delegated BLOCKED entries were
resolved by the completed drip/settings validation.

## Implemented corrections

- Strict named-field input validation, including null company settings and
  nested drip steps; no remaining direct `req.body/query/params as any` casts.
  Database/SDK/test adapters still contain `any`; the B inventory distinguishes
  these from request-input values.
- Manual-by-default routing, guarded round-robin, admin stale queue, transactional
  cursor selection, and current-threshold/ownership rechecks before reassignment.
  Marketing resources have explicit ownership and template authorization is
  checked at enrollment and again at send time.
- Re-applications retain the existing lead and rep, preserve prior signature
  document links, select the latest application deterministically, reject
  conflicting identities with a named 400, and do not disclose existing tracking
  tokens to unauthenticated repeat submitters.
- Central outbound footer, recipient-safe webhook suppression, fixed CEO delivery
  test, local-ledger deep health, and a shared durable 75/day bulk/drip budget.
  No real email was sent during testing.
- The funding-time minimum is 24 hours. Export tests execute the real handler.
  Flyer requests have an enqueue-time 30-second deadline and at most two active
  renders, including when the first renders never settle.

## J — Final verification matrix

| Check | Status | Evidence |
|---|---|---|
| Full available test suites | PASS | `pnpm -r --if-present test`; API 211/211 and CRM 35/35; final API rerun after settings hardening remains 211/211 |
| Full workspace typecheck | PASS | `PORT=5173 BASE_PATH=/ pnpm build` begins with `pnpm typecheck`; API, CRM, mobile, sandbox, scripts all Done; final API typecheck repeated after its last edit |
| Workspace builds | PASS | Same workspace build succeeded for all configured build scripts, including iOS/Android mobile bundles; API build repeated after last API edit |
| Protected-file/value guardrails | PASS | `git diff c31530b --` migrations 001–022, package manifests and lockfile is empty; no model/consent/lender-seed/gate value changes; `git diff --check` passes |
| Public development preview | PASS | Screenshot at `/` renders the sign-in screen at 1280×900; no browser runtime error shown |
| Development runtime schema readiness | FAIL | Startup logs report pending 019–024; missing `routing_mode` and `package_config` cause background-job errors, although HTTP listener starts |
| Full authenticated live-DB/browser regression | BLOCKED | Shared dev schema is missing required columns; no authenticated browser journey or live SendGrid delivery was claimed |

### Test and typecheck tails

```text
API: tests 211 | pass 211 | fail 0 | skipped 0
CRM: tests 35 | pass 35 | fail 0 | skipped 0

artifacts/mockup-sandbox typecheck: Done
scripts typecheck: Done
artifacts/mbs-crm-mobile typecheck: Done
artifacts/api-server typecheck: Done
artifacts/mbs-crm typecheck: Done

Final API typecheck: tsc -p tsconfig.json --noEmit (exit 0)
Final API build: exit 0
Workspace build: exit 0
```

Local log files (ephemeral; summarized above):
`/tmp/scrub-round2-final-tests.log`,
`/tmp/scrub-round2-final-build.log`,
`/tmp/scrub-round2-final-api-tests.log`,
`/tmp/scrub-round2-final-api-typecheck.log`,
`/tmp/scrub-round2-final-api-build.log`.
Build warnings concern existing chunk sizes/sourcemaps; no new dependencies
were introduced.

## Production hygiene observations

| Observation | Count |
|---|---:|
| Leads with null source | 0 |
| `other` documents with statement-like filenames | 0 |
| Pending users | 0 |
| Unassigned deals | 4 |
| Leads without a company row | 5 |

The exact SQL and filename heuristic are in `scrub-round2-I.md:19-36`.
No affected record was changed.

## Commit ledger

One implementation/audit commit per letter. A–E were pushed at the first checkpoint.

| Section | Commit |
|---|---|
| A | `b078d1d1a1612cedcf2d5d67d5ecafcb479ad4d0` |
| B | `98744fcb58aef3f0f7cadff7bec147692f487981` |
| C | `0d8c3d52d760de1a247a725a4f3d1d20ad506230` |
| D | `83b2d237219d9d654306f335cdf87d8a21638f19` |
| E | `d126733690b271ba31f0420c32764f6619423ded` |
| F | `66192cfa48dba51b136133459188d744f5629a68` |
| G | `2fbc0cbb2983572a5608a4e3d40187167c9bdea4` |
| H | `7114134c798205279c85d2495ce24de94f295537` |
| I | `72944972061ee2c237735962a5e774492c0565ec` |
| J | The commit introducing this report; exact hash is reported in the final delivery and resolved with `git log --diff-filter=A -1 --format=%H -- docs/SCRUB_ROUND2.md` |

J also reconciles interim audit status/counts. Its hash cannot be embedded in
its own contents without changing that hash.

## Release blockers

1. A rollback-only fresh-schema attempt failed at
   `lib/db/migrations/003_deals.sql:21`: `activity_log` did not exist. A complete
   version-0 schema/bootstrap fixture is required to prove ordered 001–022 startup.
   Protected migrations were not edited.
2. The seeded development schema is not current. New migrations
   `023_routing_and_marketing_ownership.sql` and
   `024_email_compliance_daily_budget.sql` were added, not applied.
3. Full authenticated, schema-backed regression and real delivery verification
   remain unperformed. Mocked/rollback tests must not be represented as these checks.
4. Administrators should review the four unassigned deals and five company-less
   leads; this audit intentionally leaves production data unchanged.

DO-NOT-SHIP