# Production Scrub Round 2 — Fixture Definitions

## Scope and isolation

These are development-only fixtures. They use injected in-memory repositories and
ephemeral localhost HTTP servers; the one actual development-database probe is
wrapped in an explicit `BEGIN`/`ROLLBACK`. They do not connect to, read, or
modify production. The fixture test is
`artifacts/api-server/src/lib/scrub-round2-a.test.ts`.

| Fixture | Purpose | Isolation / assertions |
| --- | --- | --- |
| `applicationFixture()` | A submitted application with a deterministic lead (501), application (601), and rep assignment (17). | In-memory database records every insert; injected storage, OCR, score, notifications, and idempotency have no external effects. |
| Typed equipment application | Bare EIN, no secondary owner, no statements. | Confirms EIN normalization, server-owned consent version, typed signature persistence, and equipment statement optionality. |
| Drawn equipment application | PNG data URL signature. | Confirms the drawn method and unchanged data URL are persisted. |
| Invalid application | Bad EIN and absent/false consent fields. | Confirms a 400 named `ein` field before inserts. Existing parser tests cover each individual named consent field. |
| Working-capital skip | Explicit `statementsSkipped=true`, no uploaded files. | Confirms the assigned-rep collection task and audit activity are recorded without an extraction row. |
| Migration dry-run | Current migration directory and an empty fake executor. | Confirms ordered discovery of 001–022 and that status dry-run does not start a transaction. |
| Selected-package preview | Package builder route with a repository that throws if a submission insert, submission lookup, or transaction is attempted. | Confirms preview emits a PDF and only saves package config; zero submission-path calls. |
| Package-config route | Isolated stateful repository for GET, PUT, DELETE, GET. | Confirms saved selection returns after reload and deletion returns `null` on reopen. |
| Actual development rollback insert | A synthetic user, lead, application, document, task, and activity are inserted in one `BEGIN`/`ROLLBACK` transaction. | Observed `1,1,1,1,1` for lead/application/document/task/activity; a subsequent development `SELECT` confirmed zero rows remained. |
| Actual isolated-schema migration boot | A transaction-created `scrub_round2_a_fresh` schema with the pre-migration application tables, then migrations 001–022 via `psql`. | **Observed FAIL** at `003_deals.sql:21`: `relation "activity_log" does not exist`. `psql` exited before commit and a subsequent `to_regclass` check confirmed the schema did not remain. This demonstrates that this hand-built baseline is incomplete; it is not a passing fresh-boot proof. |

## Dev-DB constraint

Read-only inspection found `public.leads` but no `package_config` column and no
`schema_migrations` ledger. Applying 019–022 to shared development would violate
this scrub's no-migration constraint. The actual rollback insert therefore tests
database persistence mechanics only—not the whole HTTP application route. The
fresh-schema boot failure is retained as observed evidence and must be fixed with
a complete version-0 baseline fixture before it can become a passing proof.