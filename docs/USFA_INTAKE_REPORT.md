# USFA intake implementation report

Date: 2026-09-16  
Scope: code and tests only. Production remained read-only. No migration was
applied, no external Google API was called, and no deployment occurred.

## Section results

| Section | Status | Evidence |
|---|---|---|
| A — Mapper and persistence model | PASS | Exact 28-column mapping and normalization: `artifacts/api-server/src/lib/intake/usfa.ts:149-219`; exhaustive mapper tests: `artifacts/api-server/src/lib/intake/usfa.test.ts`; append-only migration: `lib/db/migrations/025_usfa_intake.sql:1-66`. SSN/DOB are only in encrypted prefill history, never the lead row. |
| B — Sheet poller and administration | PASS | Header validation and ingestion: `artifacts/api-server/src/lib/intake/usfaPoller.ts:42-253`; admin status/run/reprocess: `artifacts/api-server/src/routes/adminUsfaIntake.ts:19-72`; page and toggles: `artifacts/mbs-crm/src/pages/admin-usfa-intake.tsx:1-86`. The Google client uses read-only values access and has no Sheet write call. |
| C — Application PDF ingestion | BLOCKED | Read-only Gmail scope, pagination, 24-hour retry, deterministic storage key, message lock/receipt: `artifacts/api-server/src/lib/intake/usfaApplicationPoller.ts:7-275`; setup: `docs/USFA_INTAKE.md:27-78`. Vendor sender/domain is not confirmed, so sender allowlisting cannot be implemented without inventing a fact. Gmail activation is documented as blocked. |
| D — Routing and consent | PASS | Existing routing integration and post-commit admin notification: `artifacts/api-server/src/lib/intake/usfaPoller.ts:85-211`; central consent predicate: `artifacts/api-server/src/lib/intake/usfaCompliance.ts:1-25`; SMS and both drip entry/worker paths call it; admin toggle: `artifacts/mbs-crm/src/pages/admin-usfa-intake.tsx:39-80`. Email and calls are unchanged. |
| E — Dormant webhook | PASS | Strict payload and raw-body HMAC: `artifacts/api-server/src/routes/usfaIntake.ts:9-101`; exact signature tests: `artifacts/api-server/src/routes/usfaIntake.test.ts`; enable flag defaults false in migration 025 and settings. |
| F — Regression and guardrails | PASS | Normal API suite includes USFA tests through `artifacts/api-server/src/lib/usfaIntake.test.ts`; results and protected-file checks below. |

## Privacy, idempotency, and re-applications

- External ID is checked first. Email/phone matches attach a re-application to
  the existing lead while preserving encrypted prefill history, notes, statement
  metadata, and tasks. `tech@usfundadvisor.ai` is excluded from email dedupe.
- Statement links remain metadata and are never fetched. Tasks go to the assigned
  rep; unassigned leads create admin tasks or an explicit admin-queue task.
- Admin notifications run after the intake transaction commits.
- Reps/admins mint an opaque, short-lived, lead/rep-bound application invite at
  `artifacts/api-server/src/routes/usfaPrefill.ts:75`. The public prefill endpoint
  returns only SSN/DOB with `no-store`, decrypts only on successful token/slug
  validation, and synchronously logs PII access. Application submission claims
  the invite conditionally inside its database transaction at
  `artifacts/api-server/src/routes/applications.ts:267`.
- Gmail uses read-only access, paginates, reserves each message with a PostgreSQL
  advisory transaction lock, overwrites one deterministic private object key on
  retry, and commits the document/receipt together. It never deletes, labels,
  marks, or modifies Gmail messages.

## Verification

```text
pnpm -r --if-present test
  API: 233 passed, 0 failed
  CRM: 35 passed, 0 failed

pnpm typecheck
  workspace libraries: PASS
  API, CRM, mobile, mockup sandbox, scripts: PASS

PORT=5173 BASE_PATH=/ pnpm build
  API and CRM builds: PASS
  mobile iOS and Android bundles: PASS
  existing chunk-size warnings only

git diff --check: PASS
migrations 001-024 changed: none
protected model/consent/lender-gate strings changed: none
```

`googleapis` was absent and was added to the API package for read-only Sheets
and Gmail clients. No other dependency was added.

## Commit ledger

| Section | Commit |
|---|---|
| A | `029518446fe25d12253ef46c91d8f16479de8139` |
| B | `7033b2c6ddce539b4425a21ea5df5bd34f8dd1ae` |
| C | `14c0afc5b81f235aa55d746c4f7024e3b9cd2947` |
| D | `4a74e3e364df45074d369e5f05d9adbbd7e79546` |
| E | `490d1ce396b0f551f404fe4b36bdae4247a66396` |
| F | Commit containing this report; report the exact hash from Git after commit |

## Activation blockers

1. Obtain the confirmed USFA sender address/domain and implement an allowlist
   before enabling Gmail polling. Subject, recipient, and known lead identity
   are not sufficient sender authentication.
2. Apply migration 025 through the approved migration process before starting
   either poller or enabling the webhook.
3. Configure `GOOGLE_SERVICE_ACCOUNT_JSON`, Sheet ID/tab, Workspace domain-wide
   delegation, and object storage. Configure `USFA_WEBHOOK_SECRET` only when the
   vendor webhook is ready.
4. Complete a non-production end-to-end run against a representative Sheet,
   delegated mailbox, and current schema. The current tests use pure functions,
   repositories, and mocked Google clients; they do not claim a live Google run.

DO-NOT-SHIP