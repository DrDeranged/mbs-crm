# CRM release certification — 2026-09-21

## NO-SHIP

**NO-SHIP.** The public deployment is reachable and the automated suites are
green, but this release is not certifiable for shipment. The authoritative
preflight ends in `PREFLIGHT FAIL`: database divergence detects a changed
`users.role` column. In addition, the generated authenticated tester remained
`pending` after the exact-row role update, so no authenticated admin, manager, or
representative journey could be certified. The published revision is not
provably the current `HEAD` (there is no live revision header).

Ship is allowed only after the `users.role` divergence is resolved, publication
identity is made verifiable, and every critical authenticated role journey passes.

## Scope and method

This is the final task-136 evidence report. I inspected the web route/page
registry, mobile route tree, API route inventory, the authoritative preflight
transcript, retained SendGrid production certification, prior preflight evidence
(`reports/preflight-2026-09-18.txt`), release-verdict memory, and current git
history. The 2026-09-18 transcript is historical evidence only (it ended in a
preflight pass); it cannot override the 2026-09-21 final divergence failure.
The test evidence was reconciled without creating production business data or
sending communications.

Production target: `https://app.my-business-solutions.com` (successful public VM
deployment). Current repository `HEAD` is `ba322b2` (`Retain SendGrid production
certification evidence`). The latest published-code evidence remains `fe572d8`;
the live response has no revision header, so exact `HEAD` publication cannot be
proven. The retained SendGrid certification was performed against the same
migration and last-send baseline and has a newer webhook observation.

## Production and build evidence

- `/api`, `/api/healthz`, and `/api/health/deep`: HTTP 200.
- Deep health SHA-256:
  `d9726557fe9d4187972444fe000e5d4dba495dee5cfc4e11dcf58ffb0816fbd4`.
- Deep health: database `ok`; 46 migrations applied; no pending or failed
  migrations; Clerk configured and proxy reachable; Twilio fully configured and
  `voiceToken` ok; SendGrid configured; Anthropic `true`; Experian `false`;
  native PDF `ok`; Puppeteer unavailable; jobs successful.
- SendGrid deep-health baseline: last send
  `2026-09-20T22:26:00.530Z`; last webhook
  `2026-09-21T01:13:38.282Z`.
- Web: typecheck and 82 tests pass; production build passes with
  `PORT=5173 BASE_PATH=/`.
- API: typecheck, 312 tests, and build pass.
- Mobile: typecheck, 2 tests, and iOS and Android bundle builds pass.
- Root preflight passes schema/recovery guards, typecheck, full suite, migration
  lint, built-app smoke, migration dependency lint, clone, and migration
  rehearsal. It fails only at final database divergence:
  `Changed columns: users.role`.
- The authoritative transcript is retained at
  `reports/preflight-2026-09-21-release-certification.txt`; it ends with
  `DB DIVERGENCE FAILED` and `PREFLIGHT FAIL`, not a release pass.

## Feature acceptance matrix

`PASS` means directly evidenced in this run or by the explicitly retained
production evidence. Automated-contract-only functionality is `PASS` only where
the tests directly cover the contract. `BLOCKED` means not tested because the
authenticated role prerequisite was unavailable; it is not a functional failure.

| Feature/surface | Role | Prerequisites/test data | Expected outcome | Result | Evidence/limitation | Cleanup |
|---|---|---|---|---|---|---|
| Public application `/apply`: render, step validation, safe validation errors | Public applicant | Browser tag `release-cert-uVZRkN`; no account | Form renders, validates steps, gives safe errors | **PASS** | Screenshots `wfbuii`, `9fo4un`, `0dlrbu`; public E2E | No submission/business data |
| Public invalid status and unknown rep slug chooser | Public applicant | Invalid status; unknown slug | Safe error and generic chooser, no leakage | **PASS** | Screenshots `6pr2rg`, `s84dqu` | None |
| Authentication, Clerk proxy, sign-in and pending gate | All authenticated roles | Clerk configured/reachable; generated browser user | Sign-in completes and approved role reaches app | **BLOCKED** | Auth user remained pending despite exact-row role update; screenshot `d7r7ot` | Tagged user/identity absent after cleanup |
| Dashboard and analytics | Admin, manager, rep | Approved role and lead/deal data | Role-scoped KPIs and dashboard render | **BLOCKED** | Authenticated E2E unavailable; contracts covered only where tests directly assert them | No data created |
| Leads list, search/filter/import/export, stale/renewal views | Admin, manager, rep | Approved role; lead fixtures | Correct scoped lead management | **BLOCKED** | No authenticated journey; API contracts do not replace UI acceptance | None |
| Lead create, detail, assignment, status, duplicate handling | Admin, manager, rep | Approved role; disposable lead | Create/update and ownership rules work | **BLOCKED** | Auth gate prevented E2E; no lead created | None |
| Notes, tasks, documents, activity timeline | Admin, manager, rep | Approved role; disposable lead/document | CRUD, ownership, audit activity and downloads work | **BLOCKED** | No authenticated E2E; direct API tests cover selected authorization/transaction contracts only | None |
| Communications history and partner contacts | Admin, manager, rep | Approved role; disposable lead/contact | Communication history and partner attribution are visible and scoped | **BLOCKED** | No authenticated E2E; contract tests cover selected SMS/partner policy behavior only | No contact or message created |
| Deals, stages, notes, approvals, commissions | Admin, manager, rep | Approved role; disposable deal | Deal lifecycle and role permissions work | **BLOCKED** | No authenticated E2E; API tests directly cover selected update/approval contracts | None |
| Rate converter and rate points tools | Admin, manager, rep | Approved role; deal/rate inputs | Calculations and persisted rate points work | **BLOCKED** | No authenticated browser journey | None |
| Lenders, matching, lender packages and submissions | Admin, manager, rep | Approved role; lender/application fixtures | Match, select, render, audit and submit safely | **BLOCKED** | No authenticated E2E; native package/API contracts directly tested; no external submission | No package or submission created |
| Collateral and flyer templates/rendering | Admin, manager, rep | Approved role; template/lead fixtures | Policy-scoped collateral and PDF output | **BLOCKED** | Auth E2E unavailable; native PDF contracts pass; Puppeteer-dependent output blocked | No flyer/email sent |
| Applications and application status | Public applicant; admin/manager/rep | Public form; authenticated review role | Submit, preserve consent, review/status safely | **PASS** | Public render/validation pass; native application PDF contracts pass | No application created |
| Native PDF generation | Admin, manager, rep | Native renderer and fixture contracts | One-page Letter output, safe masking/consent/footer | **PASS** | Preflight/API tests directly cover native application/package PDF behavior | No stored output retained |
| Puppeteer-dependent PDF/flyer output | Admin, manager, rep | Puppeteer runtime | Render through browser renderer | **BLOCKED** | Deep health reports Puppeteer unavailable; native path remains PASS | None |
| Email templates and email settings | Admin, manager | Approved role; template fixture | Manage templates/settings and permissions | **BLOCKED** | Auth E2E unavailable | No settings changed |
| Campaigns, drips, enrollment and tracking | Admin, manager, rep | Approved role; disposable lead | Configure/enroll and track without unsafe sends | **BLOCKED** | Auth E2E unavailable; no outbound send authorized in this run | No enrollment created |
| SendGrid configuration and signed webhook processing | Admin/system | Production config and retained event evidence | Signed event accepted and ledger/status effects applied | **PASS** | Retained certification: signed fixture HTTP 200; same migration/last-send baseline; newer live webhook `2026-09-21T01:13:38.282Z`; direct signature tests pass | No new send in this run |
| SendGrid outbound send E2E | Admin/manager | Approved recipient required | Send and reconcile delivery event | **BLOCKED** | No approved outbound send in this run; prior controlled certification is retained separately, not a new run result | No email sent |
| SMS and browser calling configuration | Admin/system | Twilio configuration | Credentials and token health valid | **PASS** | Deep health: all Twilio settings configured and `voiceToken` ok | No call/SMS |
| SMS/calling E2E, call notes/outcomes | Rep, manager | Approved recipient and authenticated role | Safe call/text and activity recording | **BLOCKED** | Safety restriction/no approved recipient; auth E2E unavailable; no external calls/messages | None |
| Notifications, PWA, push token and delivery | Admin, manager, rep | Approved role/device token | In-app/PWA/push notifications work | **BLOCKED** | Authenticated mobile/web E2E unavailable; contract-only tests do not certify journey | No token/data retained |
| Workflow rules and automations | Admin, manager | Approved role; disposable trigger data | Rule validation, task/notification automation | **BLOCKED** | Auth E2E unavailable; automated-contract-only items are not promoted to PASS without direct coverage | No rule or trigger created |
| Settings, users, roles and lead distribution | Admin, manager | Approved admin/manager role | Role updates and distribution settings persist safely | **BLOCKED** | Exact generated user role update did not lift pending gate; `users.role` divergence also blocks release | Tagged identity removed |
| Governance, compliance, credit consent and audit | Admin, manager, rep | Approved role; compliant fixture | Disclosure, access logs and policy controls work | **BLOCKED** | Auth E2E unavailable; repository contracts cover selected controls | No credit action |
| Experian credit pull | Admin/manager/rep | Experian integration and consent | Authorized pull and audit record | **BLOCKED** | Deep health explicitly reports `experian: false` (missing integration) | No credit pull |
| Admin health, migrations, errors, USFA intake | Admin | Approved admin role and safe fixtures | Health/migration/USFA views and guarded operations work | **BLOCKED** | Auth E2E unavailable; health endpoints are PASS; final divergence is a release blocker | No USFA poll/reprocess |
| AI briefing/recommendations/message drafts | Admin, manager, rep | Approved role and Anthropic | AI output is scoped, safe and visible | **BLOCKED** | Anthropic configured (`true`) but authenticated UI journey unavailable; configuration is not feature acceptance | No prompt/output retained |
| Mobile dashboard, leads, create, detail and tasks | Admin, manager, rep | Approved mobile auth and role | Mobile tabs and CRUD/detail/task flows work | **BLOCKED** | Mobile workflow was not started during tester; auth user stayed pending; mobile build/typecheck/tests pass only | No mobile data |
| Mobile settings, offline behavior and notifications | Admin, manager, rep | Approved mobile auth, device permissions/network transitions | Settings, offline queue and notification handling work | **BLOCKED** | Mobile workflow not started; no device notification or offline E2E evidence | No token/data retained |

## Browser tester and workflow disposition

Unique browser tag: `release-cert-uVZRkN`. PASS results were public
`/apply` render/step validation (`wfbuii`, `9fo4un`, `0dlrbu`), invalid-status
safe error (`6pr2rg`), and unknown-slug generic chooser (`s84dqu`). The generated
auth user stayed pending after the exact-row role update; pending screenshots
are `d7r7ot`, `ae15k8`, and `kgkm6y`. Therefore all admin/manager/rep and
authenticated mobile E2E entries above are **BLOCKED**, not failed. The API
workflow was initially `NOT_STARTED` and recovered after an exact restart.
The mobile workflow was not started during the tester.

Cleanup found no tagged users or identities and no business data. No external
emails, calls, SMS, credit pulls, lender submissions, or other external side
effects were made.

## Blockers, ordered

### Critical

1. Resolve the final preflight database divergence: `users.role` differs between
   the production clone and the development schema. Re-run the authoritative
   preflight and retain the complete transcript through a final PASS.
2. Establish verifiable publication identity. Current `HEAD` is `ba322b2`,
   latest published evidence is `fe572d8`, and the live service exposes no
   revision header. Publish the intended commit and capture immutable revision
   evidence.
3. Repair the authenticated test prerequisite so a generated user can be
   promoted from pending to its exact admin, manager, and rep role. Re-run every
   critical authenticated web and mobile journey for each role.

### High

4. Add/configure the Experian integration before certifying credit pulls.
5. Provide an approved recipient and explicit authorization for calling, SMS,
   and any new outbound email E2E; otherwise retain those items as blocked.
6. Provide a Puppeteer-capable production renderer or formally certify only the
   native PDF path; Puppeteer-dependent output remains blocked.

## Cleanup and side-effect accounting

- Browser tag: `release-cert-uVZRkN`.
- No tagged users or Clerk identities remained.
- No business leads, deals, applications, tasks, documents, lender packages,
  submissions, rules, enrollments, credit records, or push tokens were created.
- No external email, SMS, voice call, credit pull, or lender submission occurred.
- SendGrid retained evidence referenced here is historical certification, not a
  new outbound send.

## Screenshots index

| Screenshot | Evidence |
|---|---|
| `wfbuii`, `9fo4un`, `0dlrbu` | Public `/apply` render and step validation |
| `6pr2rg` | Invalid application-status safe error |
| `s84dqu` | Unknown-slug safe generic chooser |
| `d7r7ot`, `ae15k8`, `kgkm6y` | Auth user remained pending after role update |

## Exact recertification checklist

1. Correct the `users.role` schema/production divergence without bypassing the
   migration guard; run root preflight and retain its complete output.
2. Publish the intended commit, capture the deployed commit/revision from the
   live service, and reconcile it with `HEAD`.
3. Confirm `/api`, `/api/healthz`, and `/api/health/deep` return 200; record the
   deep-health body and SHA-256, including database and integration statuses.
4. Verify Clerk proxy reachability and create only tagged disposable test
   identities; prove admin, manager, rep, and pending role transitions.
5. Re-run public `/apply`, status, and chooser tests, retaining screenshots.
6. Re-run authenticated web journeys for dashboard, leads, notes/tasks/docs/
   activity, deals/approvals/commissions/rate tools, lenders/matching/packages,
   collateral, applications/status, email/drips, notifications, workflows,
   settings/users/distribution, governance/compliance, admin health/migrations/
   USFA, and AI for every applicable role.
7. Re-run Twilio configuration checks; perform SMS/calling only with an
   explicitly approved recipient. Reconcile SendGrid signed webhook and perform
   outbound send only with an approved recipient.
8. Re-run native PDF and, if required for scope, Puppeteer-dependent output.
   Keep Experian blocked until its integration is configured and tested.
9. Re-run mobile dashboard, leads/create/detail/tasks/settings, offline, and
   notifications journeys on both supported bundle targets.
10. Verify cleanup: no tagged identities or test business data; reconcile all
    side-effect ledgers and external provider events.
11. Issue SHIP only if preflight ends in PASS, publication identity is proven,
    and every critical authenticated role journey is PASS. Otherwise issue
    NO-SHIP with the blocking evidence.

## Limitations

This report does not infer UI acceptance from typechecks, builds, health
configuration, or isolated API tests. It does not claim authenticated success
where the pending gate prevented access. It does not claim Experian behavior
without the integration, Puppeteer output without Puppeteer, or communications
without an approved recipient. The preflight transcript is authoritative and
explicitly fails its final gate; the retained memory guidance therefore does not
permit a SHIP verdict.
