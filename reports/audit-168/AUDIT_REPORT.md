# CRM workflow audit — 2026-09-23 (UTC)

## Verdict: NO-SHIP / full end-to-end operation unverified

This audit is of workspace **`7a5417afd75f147c5221487cb23c0af3893817ec`** (clean before the audit), not a certification of the published revision. At 16:07 UTC, `git ls-remote origin HEAD refs/heads/main` reported GitHub main **`ba14949adf9a7863916140b9ddc71c291064f9f8`**. These hashes differ; do not assume one is deployed or that the two histories are ordered. The deployment service reported an active, successful, public VM deployment at `https://app.my-business-solutions.com`. Neither its live HTML nor `/api/` and `/api/health/deep` returned an immutable web/API commit identifier (only ordinary ETags for API responses). **Live web revision: unverified; live API revision: unverified; live/workspace and live/GitHub parity: unverified.** The production startup log's `proxyRevision: "2026-09-19.1"` identifies one Clerk proxy component, **not** the whole API commit.

The authoritative **fresh** `pnpm preflight` transcript is `preflight.txt` (exit 1, `PREFLIGHT FAIL`). It stopped at gate 4/11 because a migration-corpus test asserts 54 migrations while the current corpus has 55. The prior `reports/audit-159/AUDIT_REPORT.md`, `reports/preflight-2026-09-21-current-pass.txt`, and `reports/CRM_RELEASE_CERTIFICATION_2026-09-21.md` are historical, not proof of this revision. The September 21 certification also said NO-SHIP, for different evidence then. Later gates were run independently and are **not** a substitute for one complete passing preflight.

### Scope, expected behavior and safe boundary

PASS below means only the named observation passed, not that the entire row is production-certified. FAIL is observed failure or deterministically contradicted behavior; BLOCKED means a safe prerequisite (isolated recipients, production auth/provider, device) was unavailable; NOT TESTED means no fresh execution. Tests of pure helpers or mocked handlers are explicitly called out as such. Browser inspection used one development-only read-only session with an existing admin; it did not change business records. The development database is shared (read-only count: 12 leads, two draft campaigns, zero launches); the production read-only database returned 524 leads, two draft campaigns, zero launches and 55 migration rows. These counts are not a before/after proof for customer records. No real customer record was edited, no public form was submitted, no message was sent, and no campaign was approved, launched or scheduled in production **or development**.

| Journey (expected) | Result at audited revision | Evidence / missing proof |
| --- | --- | --- |
| Public application and tracking status: validated multi-step form, persisted application/token, invalid-token explanation | **PASS** for first two UI steps and invalid-token API/UI; **BLOCKED** for submission and valid-token persisted state | Development browser: financing selection enables Next, incomplete business details prevent progression; invalid status token shows explicit not-found message. Live and dev `GET /api/applications/status/not-a-real-token` return 404; public consent endpoint returns 200. API mocked submit/re-application persistence tests pass (`preflight.txt`), but no current real form/database submission. |
| Authentication and roles: signed-out denial, pending/rep/manager/admin boundaries, error recovery | **PASS** signed-out redirect, anonymous API 401 and development admin dashboard; **BLOCKED** full role matrix/production login; **FAIL** `/me` error UX by source | Browser `/campaigns` redirects to sign-in, admin can view campaign, live/dev anonymous `/api/me`, `/api/leads`, `/api/campaigns` return 401. Source `App.tsx:155-165` renders a perpetual loader when `/me` fails. No production credential or safe role-isolated browser set was used. |
| Lead intake/editing/routing/import: scoped create/edit and assigned-rep persistence | **PASS** API/mock tests for selected intake, rep scoping; **BLOCKED** UI→real DB round trip | Public capture/submit and list/rep-scope tests in `preflight.txt`; no new shared or production leads were created/edited. Leads query error lacks UI error branch (`pages/leads.tsx:504-505,731-773`). |
| Tasks and notifications: assignment, completion, unread/read state and errors | **FAIL** task assignment boundary and error feedback; **BLOCKED** persisted UI completion/notification delivery | `routes/tasks.ts:71-89` accepts caller-supplied `assignedUserId` for a rep's lead without assignee authorization. `lead-detail/tasks.tsx:17,42-47,80-84` does not render query/toggle failures. No notification mutation or push was triggered. |
| Deals: create/edit/convert, scoped reporting and rollback | **PASS** selected handler/mock DB tests; **BLOCKED** full UI→DB journey | `preflight.txt` shows deal-update transaction/rollback and CSV tests passed. No real deal mutation or production read of private records. |
| Documents: scoped upload/download/category and package selection | **PASS** selected permission/package/mock tests; **BLOCKED** live file round trip | `preflight.txt` covers denied other-rep category, download headers, selected document ownership and package render. No private customer document was opened or uploaded. |
| Lender matching/submission safeguards: eligibility, duplicate suppression, package audit, delivery outcome | **PASS** isolated/mock rules and handler tests; **BLOCKED** real submission/provider delivery | `preflight.txt` includes matching, other-rep denial, rolling 24-hour duplicate, mock SendGrid PDF/recipient tests. No credit pull, lender submission, provider send or customer-data mutation. |
| Communications/automation: email/SMS/call, drip, webhook and task routing | **PASS** signature/consent and selected helper tests; **BLOCKED** provider delivery | `preflight.txt` shows unsigned webhooks rejected and policy tests; dev cold start says drip and USFA pollers disarmed. No live SMS/email/call. |
| Production-only provider delivery/credit pulls | **NOT TESTED** | Chargeable or live recipient actions are outside this audit; provider configuration and unit tests cannot certify delivery or credit bureau results. |
| Campaign draft→safe confirmation→post-launch | **PASS** read-only draft UI, selected pure guard tests; **FAIL** scheduled delivery promise; **BLOCKED** full isolated API/DB execution | Development admin saw draft list/detail, no-template/flyer state, built-in/upload flyer controls, filters, disabled preview/approval/launch and affirmation guidance. Tests cover exclusion classifier, template rendering, flyer digest, approval hash, idempotency/lease helpers (`campaigns.test.ts`, `preflight.txt`). No isolated database plus blocked provider was available, so actual template/flyer save, suppression preview snapshot, provider-free `/test` audit write, affirmation approval snapshot, schedule/launch ledger and post-launch state were **not** exercised end to end. Never infer launch success from the pure tests. Source `campaigns.ts:600-658` records scheduled rows but has no delivery worker; UI warns at `campaign-detail.tsx:1387-1390`. SMS launch is deliberately rejected at `campaigns.ts:565-566`. Production has zero launch rows, not a launch-success proof. |
| Reporting/settings/governance: scoped dashboard, settings, audit/retention | **PASS** dashboard/admin read in development; **BLOCKED** mutations, role-specific and production authenticated checks; **FAIL** several error states by source | Browser admin dashboard loaded; source/API tests cover selected analytics/role predicates; dashboard and leads render missing/empty data without a query-error state. No governance purge, backup, settings mutation or production auth. |
| Mobile dashboard/leads/new-lead/tasks/settings and offline replay | **PASS** TypeScript/iOS/Android bundles and Expo startup only; **BLOCKED** native device/auth UI→DB; **FAIL** offline replay capability by source | Mobile tab routes exist, Expo workflow reached Metro ready. A mobile web screenshot captured only the splash screen; no native device/session interaction. Offline queue writes bodies to AsyncStorage (`OfflineContext.tsx:12-18,63-90`); no replay consumer found in the mobile tree. |

### Campaign safeguard trace (no provider call)

- Creation/edit, flyer ownership/metadata, preview audience exclusions and content hash: API source `routes/campaigns.ts:91-107,172-255,323-416`; read-only browser saw controls, but no persisted fixture was created. Unit classifiers cover missing/duplicate/unsubscribed/suppressed/capacity and SMS-consent reasons.
- Provider-free validation `/campaigns/:id/test` validates render/template and returns an explicit no-send result (`campaigns.ts:514-538`, `campaigns.test.ts:128-152`); tested as helper/mocked contract only, not as an authenticated handler/database effect. Actual SendGrid delivery is out of scope.
- Approval requires current requester-bound preview token, matching content hash, nonempty eligible audience and `claimsAffirmed=true`; snapshot is written in a transaction (`campaigns.ts:466-513`). Browser showed disabled approval. No approval row created during this audit.
- Launch rejects nonapproved, unsupported SMS, stale approval/flyer and malformed or empty snapshot, and creates recipient ledger transactionally (`campaigns.ts:539-650`); existing-key handling and post-send ledger paths exist (`:651-820`). **No live or dry-run launch endpoint was called**: `dry_run` still writes ledger/audit rows and shared development data are not isolated. Post-launch state is therefore BLOCKED, not PASS.
- Schedule creates `scheduled` rows without an automatic delivery worker; even the UI warns of this. A 10-minute execution lease has no evidenced background recovery when a process dies. These are code-confirmed operational gaps; a real recipient-provider result remains unverified.

### Fresh checks and runtime evidence

| Check | Result and retained evidence |
| --- | --- |
| Root preflight | **FAIL**, `preflight.txt` and `preflight.exit` (1): schema-path and recovery guards pass, `pnpm typecheck` passes, API 339/339 and web 96/96 tests pass, scripts 62/63 fail at migration corpus 55 ≠ 54; DB library tests and gates 5–11 **not reached** in this run. The stack traces for expected negative tests are not extra failing tests. |
| Build | Default `pnpm build` **FAIL** (`build.txt`): sandbox Vite config requires workflow-injected `PORT`; standalone web build without env similarly fails (`web-build.txt`). Explicit API build **PASS** (`api-build.txt`), mobile iOS/Android bundle **PASS** (`mobile-build.txt`), web and sandbox builds **PASS** when invoked with `PORT` and `BASE_PATH` (`web-build-configured.txt`, `sandbox-build-configured.txt`). Web build reports large chunk warnings, not an error. |
| Built-app smoke | **PASS** 1/1 (`smoke.txt`), independent after the failed preflight. |
| Migration idempotency/dependency lint, schema parity | **PASS** independently (`migration-lint.txt`, `migration-dependencies.txt`, `schema-parity.txt`); dependency lint counts 55 migrations. |
| Clone/rehearsal/divergence | **PASS** independently (`clone.txt`, `rehearsal.txt`, `divergence.txt`): schema-only clone 31 tables/320 columns; rehearsal applies through `056_campaign_flyer.sql` with no changed/removed ledger rows; clone/dev schema divergence reports none. Not a production authenticated UI test. |
| Cold starts / health | Managed API, web and Expo workflows restarted once at ~16:16 UTC, all running. API startup logged `schema OK (55 applied)`, web Vite ready, Expo Metro ready. After restart development `/api/`, `/api/health/deep`, `/apply` all HTTP 200. Prior published startup logs (~13:18–13:19 UTC) contain transient `/api` and mobile healthcheck 500/timeouts before API readiness; current published `/api/`, `/api/healthz`, `/api/health/deep` each HTTP 200 with DB `ok`, 55 applied, none pending/failed. |
| Browser/production logs | Development browser showed expected Clerk **development-key** warning and a nonfatal Twilio audio-device warning; invalid status lookup generated expected 404, no campaign JS exception. Production logs contain Clerk proxy startup, healthy later requests and a `Drip automation is disarmed` entry; log requests alone do not prove page behavior or code identity. `http-probes.txt` retains sanitized status/header/health results. Production DB reads were metadata/counts only, with no customer rows or secrets exported. |

### Prioritized actionable findings

Each reproduction below is non-destructive unless explicitly labeled for a future isolated test. No fix was made in this audit.

1. **P0 — Current preflight is red.** Impact: release gate cannot certify current migrations. Reproduce `pnpm preflight`: gate 4 script test `workspace corpus has the expected baseline and migration counts` fails `55 !== 54` (`preflight.txt:949-1004`, `scripts/src/lint-migration-dependencies.test.ts:175-181`; migration `056_campaign_flyer.sql`). **Owner:** migration/test infrastructure. **Fix:** update the expected count only after validating migration 056's corpus/dependency assertions, then rerun and retain an entire preflight PASS.
2. **P1 — Published revision identity is unprovable.** Impact: healthy endpoints and a current-looking client cannot prove the audited web and API were shipped together. Reproduce compare workspace `git rev-parse HEAD`, GitHub `git ls-remote origin main` and live `/api/health/deep` response headers/HTML; hashes differ and no commit marker is returned (`http-probes.txt`, deployment metadata). **Owner:** build/release observability. **Fix:** inject non-secret web and API commit identifiers in built assets/health headers and verify both against the intended publish; related proposed task **#138** already exists.
3. **P1 — Scheduling accepts a campaign that will not automatically send.** Impact: a manager can believe delivery will happen while recipients never receive it. Reproduce safely in a *fresh isolated fixture/provider stub*: approve a nonempty test-only audience, schedule a future launch and observe the persisted `scheduled` state without a worker; current proof is code/UI (`routes/campaigns.ts:600-658`, `pages/campaign-detail.tsx:1387-1390`). **Owner:** campaign execution. **Fix:** either disable scheduling until a monitored dispatcher exists or implement execution/recovery with idempotent ledger reconciliation. No campaign was scheduled for this audit.
4. **P1 — Mobile offline writes can be stranded and expose queued bodies on device.** Impact: reps may think new leads/notes were saved while no replay occurs; sensitive fields remain in plaintext local storage. Reproduce only with disposable device/identity: disable network, queue a synthetic lead, reconnect, check that no replay consumer sends it; inspect local queue schema (`OfflineContext.tsx:12-18,63-90`, `app/(tabs)/new-lead.tsx:133`; repository search finds no queue consumer). **Owner:** mobile/offline. **Fix:** implement authenticated per-user replay, retries/dead-letter/conflict handling, secure storage and explicit pending/error UI, or remove the offline-save promise.
5. **P1 — Cross-user task assignment is not authorized.** Impact: a rep owning one lead can create a task assigned to another user by supplying `assignedUserId` directly, creating misleading work/notifications. Reproduce in isolated API/DB fixture as rep with assigned lead and a second active rep, POST `/api/leads/:id/tasks` with the second ID; current proof is unguarded assignment in `routes/tasks.ts:71-89`. **Owner:** tasks/authorization. **Fix:** limit rep assignee to self (or policy-authorized list), validate active target and add a negative handler test. No crafted mutation was sent.
6. **P2 — Routine query failures look like loading/empty data.** Impact: a failed `/me` can leave a signed-in user stuck on a spinner; leads/dashboard can look empty or tasks can disappear when requests fail; failed task toggles have no message. Reproduce with isolated API 403/500 interception and reload `/dashboard`, `/leads`, lead Tasks; source proof `App.tsx:155-165`, `pages/leads.tsx:504-505,731-773`, `pages/lead-detail/tasks.tsx:17,42-47,80-84`. **Owner:** web UX. **Fix:** distinguish error/permission from loading and empty, add retry and mutation errors.
7. **P2 — Default workspace build lacks required artifact environment.** Impact: `pnpm build` fails even though configured artifact builds can pass. Reproduce without `PORT`: `pnpm build` aborts at sandbox Vite config (`build.txt:24-42`); web standalone build also fails (`web-build.txt`). **Owner:** build/tooling. **Fix:** provide build-time port/base path through the root script/validated workflow, without weakening the runtime host checks.
8. **P1 — Campaign persistence and safeguards have no current isolated browser/API/DB proof.** Impact: an approval, scheduling or launch regression could evade helper tests and expose actual recipients. Reproduce the gap by comparing the read-only draft browser pass to `preflight.txt` campaign helper tests: neither includes an authenticated, synthetic-lead campaign transaction or its final recipient ledger; `baseline.txt` shows the shared development database has existing leads and no launch fixture. **Owner:** campaign QA/test infrastructure. **Fix:** provision a disposable database and blocking provider adapter; exercise saved template/flyer, excluded audience, provider-free test, claims affirmation, approval, dry-run/schedule, idempotent launch and post-launch ledger through UI and API. Do not use real recipients.
9. **P1 — Production role journeys remain uncertified.** Impact: a healthy anonymous API can conceal broken admin/manager/rep authorization or a broken deployed frontend. Reproduce the evidence gap: anonymous `/api/me` returns 401 and the live page returns HTML, but no approved authenticated production account/session was available for read-only navigation (see `http-probes.txt` and the browser scope above). **Owner:** release QA/identity. **Fix:** arrange authorized read-only test identities for each role and verify deployed read-only views and permission denials; obtain permission and isolation separately before any production mutation.
10. **P2 — Other real UI→DB journeys and native mobile behaviors remain uncertified.** Impact: intake, tasks, deals, documents, governance and mobile can still fail at runtime despite passing isolated tests. Reproduce the gap with this report's matrix: selected mocked handler effects pass, but no browser-to-persisted-record fixture or native device session was used; Expo web screenshot stayed at a splash frame. **Owner:** cross-product QA. **Fix:** build disposable role-owned records/files and native-device test sessions, assert visible state and database/audit changes after each permitted operation, and check error/permission behavior. Keep production business data read-only.

**Evidence limits and release decision.** Isolated campaign UI→API→database execution, role-specific error/permission cases, valid public submission, production authenticated read-only pages, actual provider delivery, and native mobile journeys are **not certified**. An unauthenticated 401 and a read-only production table count cannot replace those checks. Do not publish based on this report. First clear the red preflight, preserve a full current transcript, establish published web/API revision parity, and verify critical journeys with isolated synthetic recipients and a blocked provider before reconsidering readiness.

### Subsequent migration bootstrap rehearsal

The migration bootstrap was subsequently added as `000_baseline.sql`, using the same 31-table/320-column pre-runner schema snapshot used by the existing schema-parity check. On an empty public schema it supplies the initial DDL. On a database with a prior numbered migration ledger entry—or any existing public application table—it records its checksum as detected/applied and does **not** execute the baseline SQL. This adoption path avoids constraint validation, index creation, and other baseline DDL on existing installations. Migration discovery and dependency lint now admit only the exact zero-numbered name `000_baseline.sql`.

Focused rehearsal result: a separate temporary PostgreSQL cluster began with zero public tables, replayed all 66 discovered migrations (`000_baseline.sql` through `066_bundled_vendor_equipment_flyers.sql`), and passed complete Drizzle schema parity. It also confirmed `users.role` defaults to `'pending'::text`. A schema-populated production-clone-equivalent fixture then adopted `000` without listing it as applied SQL, reconciled numbered migrations (61 SQL files applied; ledger 66/66), and passed schema parity. After removing only the fixture's `000` ledger row to repeat adoption, the runner applied zero SQL files, restored the `000_baseline` row with SHA-256 `a07aee3fbf5a174ff94c05859a401cac808b0c89435fd834e4bae09e75117902`, and left the full application catalog unchanged: 60 tables, 710 columns, 228 constraints, and 184 indexes before/after. Production's previously captured read-only catalog evidence agrees with the default, and migration `051_users_role_default_pending.sql` plus the Drizzle model already encode it; no additional role migration was needed.

The six root `reports/preflight-*.txt` transcripts are no longer tracked; they remain in the local workspace and the root-level pattern is ignored. At the time this focused migration rehearsal was first recorded, the final combined-preflight tail was still pending; the dated addendum below records that run and its failure. The focused migration rehearsal is not a substitute for a passing full preflight.

## Combined maintenance preflight — 2026-09-28

The full combined preflight ended **FAIL at gate 11/11 only**. The divergence comparator reported one difference: clone-only ledger row `000_baseline`; dev-only ledger rows, changed ledger rows, tables, and columns were all none. The dev ledger remained unchanged. The empty-schema 000-to-latest replay and populated-schema adoption rehearsal passed, including schema parity and unchanged application catalog signatures, as documented above. These focused passes do not convert the combined preflight into a pass. The comparator was not weakened, and this documentation update makes no database changes.

Exact final 200 lines from `/tmp/maintenance-preflight-final.log` (reviewed; no credentials or PII detected):

```text
[2K[1G[⣻] Pulling schema from database...
[2K[1G[⣽] Pulling schema from database...
[2K[1G[⣷] Pulling schema from database...
[2K[1G[⣯] Pulling schema from database...
[2K[1G[⣟] Pulling schema from database...
[2K[1G[⡿] Pulling schema from database...
[2K[1G[⢿] Pulling schema from database...
[2K[1G[⣻] Pulling schema from database...
[2K[1G[⣽] Pulling schema from database...
[2K[1G[⣷] Pulling schema from database...
[2K[1G[⣯] Pulling schema from database...
[2K[1G[⣟] Pulling schema from database...
[2K[1G[⡿] Pulling schema from database...
[2K[1G[⢿] Pulling schema from database...
[2K[1G[✓] Pulling schema from database...
Schema parity OK: SQL runner and complete Drizzle schema set match
PREFLIGHT 7/11: built-app smoke

> workspace@0.0.0 smoke /home/runner/workspace
> playwright test --config playwright.smoke.config.ts

[WebServer] (node:16824) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
[WebServer] (Use `node --trace-warnings ...` to show where the warning was created)
[WebServer] (node:16840) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
[WebServer] (Use `node --trace-warnings ...` to show where the warning was created)
[WebServer] (node:16856) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
[WebServer] (Use `node --trace-warnings ...` to show where the warning was created)
[WebServer] (node:16876) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
[WebServer] (Use `node --trace-warnings ...` to show where the warning was created)
[WebServer]
[WebServer]   dist/chunks/runtime-GO7YRMB4.mjs               15.3mb ⚠️
[WebServer]   dist/chunks/chunk-5JOA2WDW.mjs                  3.0mb ⚠️
[WebServer]   dist/chunks/esm-JJSRRVUZ.mjs                  992.6kb
[WebServer]   dist/chunks/chunk-TJJS3D2A.mjs                117.7kb
[WebServer]   dist/pino-pretty.mjs                           84.6kb
[WebServer]   dist/chunks/chunk-RICIZEEN.mjs                 51.8kb
[WebServer]   dist/chunks/chunk-RIS63LTX.mjs                 21.9kb
[WebServer]   dist/chunks/chunk-7E3CCQC2.mjs                 11.5kb
[WebServer]   dist/pino-worker.mjs                            9.1kb
[WebServer]   dist/index.mjs                                  4.9kb
[WebServer]   dist/thread-stream-worker.mjs                   4.2kb
[WebServer]   dist/chunks/chunk-R5GPNPTX.mjs                  3.8kb
[WebServer]   dist/chunks/chunk-ATFS5275.mjs                  3.5kb
[WebServer]   dist/chunks/chunk-KKR2HMRO.mjs                  2.6kb
[WebServer]   dist/chunks/chunk-OUD2LORY.mjs                  2.6kb
[WebServer]   dist/chunks/chunk-5AX5I6WE.mjs                  2.4kb
[WebServer]   dist/chunks/getMachineId-win-IBLM3IE2.mjs       2.0kb
[WebServer]   dist/chunks/getMachineId-darwin-HFMRGTA6.mjs    1.8kb
[WebServer]   dist/chunks/getMachineId-bsd-UN3MRJQ5.mjs       1.8kb
[WebServer]   dist/chunks/chunk-EFSD5NGP.mjs                  1.8kb
[WebServer]   ...and 38 more output files...
[WebServer]
[WebServer] ⚡ Done in 3456ms
[WebServer] (node:16942) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
[WebServer] (Use `node --trace-warnings ...` to show where the warning was created)
[WebServer] (node:16955) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
[WebServer] (Use `node --trace-warnings ...` to show where the warning was created)
[WebServer] src/components/ui/tooltip.tsx (2:0): Error when using sourcemap for reporting an error: Can't resolve original location of error.
[WebServer] src/components/ui/sheet.tsx (2:0): Error when using sourcemap for reporting an error: Can't resolve original location of error.
[WebServer] src/components/ui/dropdown-menu.tsx (2:0): Error when using sourcemap for reporting an error: Can't resolve original location of error.
[WebServer] src/components/ui/label.tsx (2:0): Error when using sourcemap for reporting an error: Can't resolve original location of error.
[WebServer] src/components/ui/select.tsx (2:0): Error when using sourcemap for reporting an error: Can't resolve original location of error.
[WebServer] src/components/ui/command.tsx (2:0): Error when using sourcemap for reporting an error: Can't resolve original location of error.
[WebServer]
[WebServer] (!) Some chunks are larger than 500 kB after minification. Consider:
[WebServer] - Using dynamic import() to code-split the application
[WebServer] - Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
[WebServer] - Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
[WebServer] (node:16856) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
[WebServer] (Use `node --trace-warnings ...` to show where the warning was created)
[WebServer] (node:17009) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
[WebServer] (Use `node --trace-warnings ...` to show where the warning was created)

Running 1 test using 1 worker

(node:17025) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
  ✓  1 tests/smoke.spec.ts:3:5 › production smoke paths (13.0s)

  1 passed (52.0s)
PREFLIGHT 8/11: migration dependency lint

> workspace@0.0.0 lint:migration-dependencies /home/runner/workspace
> pnpm --filter @workspace/scripts run lint:migration-dependencies


> @workspace/scripts@0.0.0 lint:migration-dependencies /home/runner/workspace/scripts
> tsx ./src/lint-migration-dependencies.ts

baseline tables: 31
baseline columns: 320
migrations checked: 66
table references checked: 187
column references checked: 371
MIGRATION DEPENDENCY LINT PASS
PREFLIGHT 9/11: production database clone

> workspace@0.0.0 db:clone-prod /home/runner/workspace
> pnpm --silent --dir scripts exec tsx ./src/dbCloneProd.ts

DB clone source: schema-only
Public base tables: 31
Public columns: 320
Schema migrations ledger rows: 0
DB CLONE PASS
PREFLIGHT 10/11: migration rehearsal

> workspace@0.0.0 migrate:rehearse /home/runner/workspace
> pnpm --silent --dir scripts exec tsx ./src/migrate-rehearse.ts

Applied names/count: 002_rep_slugs.sql, 003_deals.sql, 004_deal_intended_rep_slug.sql, 006_drip_sequence_ownership.sql, 009_email_send_failure_reason.sql, 010_email_webhook_events.sql, 011_email_rate_slots.sql, 012_application_signature.sql, 013_retired_rep_slugs.sql, 014_application_optional_fields.sql, 015_application_consent_text_version.sql, 016_user_titles.sql, 017_deal_notes_gm_split.sql, 018_lender_matcher_gates.sql, 019_document_categories.sql, 020_lender_submissions.sql, 021_lead_package_config.sql, 022_lender_submission_package_snapshots.sql, 023_routing_and_marketing_ownership.sql, 024_email_compliance_daily_budget.sql, 025_usfa_intake.sql, 026_usfa_intake_runtime_support.sql, 028_merge_going_to_funding_stage.sql, 029_deal_approvals.sql, 030_add_application_collateral.sql, 031_collateral_library.sql, 032_finance_application_collateral.sql, 033_lender_submission_review_fields.sql, 034_application_sms_consent.sql, 035_user_identities.sql, 036_partners_contacts.sql, 037_partner_flows_and_texting.sql, 038_partner_texting.sql, 039_ridgestone_partner_profile.sql, 040_release_schema_parity.sql, 041_push_notifications.sql, 042_push_delivery_ledger.sql, 043_align_push_schema.sql, 044_notification_delivery_claims.sql, 045_application_equipment_category_homeowner.sql, 046_complete_partner_contacts_recovery.sql, 047_partner_contacts_prerequisite.sql, 048_financing_campaign_draft.sql, 049_lender_underwriting_intelligence.sql, 050_lender_guideline_versions.sql, 051_users_role_default_pending.sql, 052_reusable_campaign_launcher.sql, 053_campaign_preview_approval_snapshots.sql, 054_campaign_preview_recipient_snapshots.sql, 055_campaign_launch_execution_leases.sql, 056_campaign_flyer.sql, 057_telephony_settings.sql, 058_telephony_business_defaults.sql, 059_inbound_voice_settings.sql, 060_inbound_voice_array_defaults.sql, 061_telephony_completion.sql, 062_email_readiness_daily_cap.sql, 063_lead_vertical.sql, 064_collateral_flyer_library.sql, 065_campaign_flyer_link_vendor_template.sql, 066_bundled_vendor_equipment_flyers.sql / 61
Superseded names/count: none / 0
Failed: none
Ledger before/after counts: 0/66
Added ledger rows: 000_baseline, 001_create_credit_tables, 002_rep_slugs, 003_deals, 004_deal_intended_rep_slug, 005_lead_distribution_settings, 006_drip_sequence_ownership, 007_lead_staleness_threshold, 008_email_safety_settings, 009_email_send_failure_reason, 010_email_webhook_events, 011_email_rate_slots, 012_application_signature, 013_retired_rep_slugs, 014_application_optional_fields, 015_application_consent_text_version, 016_user_titles, 017_deal_notes_gm_split, 018_lender_matcher_gates, 019_document_categories, 020_lender_submissions, 021_lead_package_config, 022_lender_submission_package_snapshots, 023_routing_and_marketing_ownership, 024_email_compliance_daily_budget, 025_usfa_intake, 026_usfa_intake_runtime_support, 028_merge_going_to_funding_stage, 029_deal_approvals, 030_add_application_collateral, 031_collateral_library, 032_finance_application_collateral, 033_lender_submission_review_fields, 034_application_sms_consent, 035_user_identities, 036_partners_contacts, 037_partner_flows_and_texting, 038_partner_texting, 039_ridgestone_partner_profile, 040_release_schema_parity, 041_push_notifications, 042_push_delivery_ledger, 043_align_push_schema, 044_notification_delivery_claims, 045_application_equipment_category_homeowner, 046_complete_partner_contacts_recovery, 047_partner_contacts_prerequisite, 048_financing_campaign_draft, 049_lender_underwriting_intelligence, 050_lender_guideline_versions, 051_users_role_default_pending, 052_reusable_campaign_launcher, 053_campaign_preview_approval_snapshots, 054_campaign_preview_recipient_snapshots, 055_campaign_launch_execution_leases, 056_campaign_flyer, 057_telephony_settings, 058_telephony_business_defaults, 059_inbound_voice_settings, 060_inbound_voice_array_defaults, 061_telephony_completion, 062_email_readiness_daily_cap, 063_lead_vertical, 064_collateral_flyer_library, 065_campaign_flyer_link_vendor_template, 066_bundled_vendor_equipment_flyers
Changed ledger rows: none
Removed ledger rows: none
Applied names/count: 000_baseline.sql, 001_create_credit_tables.sql, 002_rep_slugs.sql, 003_deals.sql, 004_deal_intended_rep_slug.sql, 005_lead_distribution_settings.sql, 006_drip_sequence_ownership.sql, 007_lead_staleness_threshold.sql, 008_email_safety_settings.sql, 009_email_send_failure_reason.sql, 010_email_webhook_events.sql, 011_email_rate_slots.sql, 012_application_signature.sql, 013_retired_rep_slugs.sql, 014_application_optional_fields.sql, 015_application_consent_text_version.sql, 016_user_titles.sql, 017_deal_notes_gm_split.sql, 018_lender_matcher_gates.sql, 019_document_categories.sql, 020_lender_submissions.sql, 021_lead_package_config.sql, 022_lender_submission_package_snapshots.sql, 023_routing_and_marketing_ownership.sql, 024_email_compliance_daily_budget.sql, 025_usfa_intake.sql, 026_usfa_intake_runtime_support.sql, 028_merge_going_to_funding_stage.sql, 029_deal_approvals.sql, 030_add_application_collateral.sql, 031_collateral_library.sql, 032_finance_application_collateral.sql, 033_lender_submission_review_fields.sql, 034_application_sms_consent.sql, 035_user_identities.sql, 036_partners_contacts.sql, 037_partner_flows_and_texting.sql, 038_partner_texting.sql, 039_ridgestone_partner_profile.sql, 040_release_schema_parity.sql, 041_push_notifications.sql, 042_push_delivery_ledger.sql, 043_align_push_schema.sql, 044_notification_delivery_claims.sql, 045_application_equipment_category_homeowner.sql, 046_complete_partner_contacts_recovery.sql, 047_partner_contacts_prerequisite.sql, 048_financing_campaign_draft.sql, 049_lender_underwriting_intelligence.sql, 050_lender_guideline_versions.sql, 051_users_role_default_pending.sql, 052_reusable_campaign_launcher.sql, 053_campaign_preview_approval_snapshots.sql, 054_campaign_preview_recipient_snapshots.sql, 055_campaign_launch_execution_leases.sql, 056_campaign_flyer.sql, 057_telephony_settings.sql, 058_telephony_business_defaults.sql, 059_inbound_voice_settings.sql, 060_inbound_voice_array_defaults.sql, 061_telephony_completion.sql, 062_email_readiness_daily_cap.sql, 063_lead_vertical.sql, 064_collateral_flyer_library.sql, 065_campaign_flyer_link_vendor_template.sql, 066_bundled_vendor_equipment_flyers.sql / 66
Superseded names/count: none / 0
Failed: none
Ledger before/after counts: 0/66
Added ledger rows: 000_baseline, 001_create_credit_tables, 002_rep_slugs, 003_deals, 004_deal_intended_rep_slug, 005_lead_distribution_settings, 006_drip_sequence_ownership, 007_lead_staleness_threshold, 008_email_safety_settings, 009_email_send_failure_reason, 010_email_webhook_events, 011_email_rate_slots, 012_application_signature, 013_retired_rep_slugs, 014_application_optional_fields, 015_application_consent_text_version, 016_user_titles, 017_deal_notes_gm_split, 018_lender_matcher_gates, 019_document_categories, 020_lender_submissions, 021_lead_package_config, 022_lender_submission_package_snapshots, 023_routing_and_marketing_ownership, 024_email_compliance_daily_budget, 025_usfa_intake, 026_usfa_intake_runtime_support, 028_merge_going_to_funding_stage, 029_deal_approvals, 030_add_application_collateral, 031_collateral_library, 032_finance_application_collateral, 033_lender_submission_review_fields, 034_application_sms_consent, 035_user_identities, 036_partners_contacts, 037_partner_flows_and_texting, 038_partner_texting, 039_ridgestone_partner_profile, 040_release_schema_parity, 041_push_notifications, 042_push_delivery_ledger, 043_align_push_schema, 044_notification_delivery_claims, 045_application_equipment_category_homeowner, 046_complete_partner_contacts_recovery, 047_partner_contacts_prerequisite, 048_financing_campaign_draft, 049_lender_underwriting_intelligence, 050_lender_guideline_versions, 051_users_role_default_pending, 052_reusable_campaign_launcher, 053_campaign_preview_approval_snapshots, 054_campaign_preview_recipient_snapshots, 055_campaign_launch_execution_leases, 056_campaign_flyer, 057_telephony_settings, 058_telephony_business_defaults, 059_inbound_voice_settings, 060_inbound_voice_array_defaults, 061_telephony_completion, 062_email_readiness_daily_cap, 063_lead_vertical, 064_collateral_flyer_library, 065_campaign_flyer_link_vendor_template, 066_bundled_vendor_equipment_flyers
Changed ledger rows: none
Removed ledger rows: none
[⣷] Pulling schema from database...
[2K[1G[⣯] Pulling schema from database...
[2K[1G[⣟] Pulling schema from database...
[2K[1G[⡿] Pulling schema from database...
[2K[1G[⢿] Pulling schema from database...
[2K[1G[⣻] Pulling schema from database...
[2K[1G[⣽] Pulling schema from database...
[2K[1G[⣷] Pulling schema from database...
[2K[1G[⣯] Pulling schema from database...
[2K[1G[⣟] Pulling schema from database...
[2K[1G[⡿] Pulling schema from database...
[2K[1G[⢿] Pulling schema from database...
[2K[1G[⣻] Pulling schema from database...
[2K[1G[⣽] Pulling schema from database...
[2K[1G[⣷] Pulling schema from database...
[2K[1G[⣯] Pulling schema from database...
[2K[1G[⣟] Pulling schema from database...
[2K[1G[⡿] Pulling schema from database...
[2K[1G[⢿] Pulling schema from database...
[2K[1G[⣻] Pulling schema from database...
[2K[1G[✓] Pulling schema from database...
Schema parity OK: SQL runner and complete Drizzle schema set match
EMPTY-SCHEMA users.role default: pending
EMPTY-SCHEMA 000-TO-LATEST REHEARSAL PASS
[⣷] Pulling schema from database...
[2K[1G[⣯] Pulling schema from database...
[2K[1G[⣟] Pulling schema from database...
[2K[1G[⡿] Pulling schema from database...
[2K[1G[⢿] Pulling schema from database...
[2K[1G[⣻] Pulling schema from database...
[2K[1G[⣽] Pulling schema from database...
[2K[1G[⣷] Pulling schema from database...
[2K[1G[⣯] Pulling schema from database...
[2K[1G[⣟] Pulling schema from database...
[2K[1G[⡿] Pulling schema from database...
[2K[1G[⢿] Pulling schema from database...
[2K[1G[⣻] Pulling schema from database...
[2K[1G[⣽] Pulling schema from database...
[2K[1G[⣷] Pulling schema from database...
[2K[1G[⣯] Pulling schema from database...
[2K[1G[⣟] Pulling schema from database...
[2K[1G[⡿] Pulling schema from database...
[2K[1G[⢿] Pulling schema from database...
[2K[1G[⣻] Pulling schema from database...
[2K[1G[⣽] Pulling schema from database...
[2K[1G[⣷] Pulling schema from database...
[2K[1G[⣯] Pulling schema from database...
[2K[1G[⣟] Pulling schema from database...
[2K[1G[⡿] Pulling schema from database...
[2K[1G[⢿] Pulling schema from database...
[2K[1G[✓] Pulling schema from database...
Schema parity OK: SQL runner and complete Drizzle schema set match
POPULATED-SCHEMA initial no-ledger reconciliation: applied=61, ledger=66|1, baseline SQL skipped
POPULATED-SCHEMA retry: applied=0, adopted=000_baseline (a07aee3fbf5a174ff94c05859a401cac808b0c89435fd834e4bae09e75117902), constraints/indexes unchanged (60/710|228|184)
MIGRATION REHEARSAL PASS
PREFLIGHT 11/11: database divergence

> workspace@0.0.0 db:divergence /home/runner/workspace
> pnpm --silent --dir scripts exec tsx ./src/db-divergence.ts

Clone-only ledger rows: 000_baseline
Dev-only ledger rows: none
Changed ledger rows: none
Clone-only tables: none
Dev-only tables: none
Clone-only columns: none
Dev-only columns: none
Changed columns: none
DB DIVERGENCE FAILED: differences detected
 ELIFECYCLE  Command failed with exit code 1.
pnpm -w run db:divergence failed with exit code 1
PREFLIGHT FAIL
undefined
/home/runner/workspace/scripts:
 ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command failed with exit code 1: tsx ./src/preflight.ts
 ELIFECYCLE  Command failed with exit code 1.
```
