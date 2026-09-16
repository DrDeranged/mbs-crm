# Production Scrub Round 2 — A: Regression Pass

## Evidence classes

- **Actual dev DB** means a synthetic-data transaction on the development
  database that ended in `ROLLBACK`; follow-up checks found no remaining rows.
- **Mocked fixture** means an injected in-memory repository and ephemeral
  localhost HTTP server. It proves route behavior, but is not a development-DB
  result.
- No production database was queried or changed.

| Requirement | Result | Evidence class | File:line / observed evidence |
| --- | --- | --- | --- |
| Bare-digit EIN is formatted before storage | PASS | Mocked fixture + actual dev DB insert | `scrub-round2-a.test.ts:109-117`; rollback query verified `12-3456789`. |
| Bad EIN returns 400 with field `ein` | PASS | Mocked fixture | `scrub-round2-a.test.ts:137-141`; `applicationValidation.test.ts:33-40`. |
| Missing credit-pull consent returns a named field | PASS | Mocked fixture | `scrub-round2-a.test.ts:143-149`; `applicationSignature.ts:25-27`. |
| Missing terms consent returns a named field | PASS | Mocked fixture | `scrub-round2-a.test.ts:151-157`; `applicationSignature.ts:28-30`. |
| Secondary owner is optional | PASS | Mocked fixture + actual dev DB insert | `scrub-round2-a.test.ts:112-115`; rollback insert omitted all secondary-owner columns. |
| `consent_text_version` is recorded | PASS | Mocked fixture + actual dev DB insert | `scrub-round2-a.test.ts:115`; rollback query verified `2026-09-14`. |
| Typed signature is stored | PASS | Mocked fixture | `scrub-round2-a.test.ts:116-117`. |
| Drawn signature is stored | PASS | Mocked fixture + actual dev DB insert | `scrub-round2-a.test.ts:119-127`; rollback query verified `drawn`. |
| Equipment applications can omit statements | PASS | Mocked fixture | `scrub-round2-a.test.ts:128`; `applications.ts:192-196`. |
| Working-capital skip creates the collection task for the assigned rep | PASS | Mocked fixture + actual dev DB insert | `scrub-round2-a.test.ts:159-167`; rollback query inserted/verified one task; route behavior at `applications.ts:443-464`. |
| `/r/{slug}` shows personalized greeting | PASS | Mocked frontend fixture | `repChooser.test.ts:26-32`. |
| `/r/{slug}` presents one canonical Continue target | PASS | Mocked frontend fixture | `repChooser.test.ts:35-39`. |
| Rep-attributed application is QR-card sourced and assigned | PASS | Mocked route fixture | `applicationSubmitRoute.test.ts:139-161`. |
| Retired slug returns 301 | PASS | Mocked localhost HTTP fixture | `repSlugRetirement.test.ts:128-148`. |
| Unknown slug uses generic chooser content | PASS | Mocked frontend fixture | `repChooser.test.ts:21-24`. |
| Unchecked package section is omitted | PASS | Mocked PDF fixture | `lenderPackage.test.ts:253-266`. |
| Selected document order is honored | PASS | Mocked PDF fixture | `lenderPackage.test.ts:253-282`. |
| In-dialog uploaded document is selected | PASS | Mocked builder-state fixture | `lender-package-config.test.ts:13-19`. |
| Foreign-lead document ID returns 400 | PASS | Mocked route fixture | `lenderPackage.test.ts:284-297`. |
| SSN unmask is admin-only | PASS | Mocked route fixture | `lenderPackage.test.ts:314-320`. |
| Admin SSN unmask is PII-audited | PASS | Mocked route fixture | `lenderPackage.test.ts:323-354`. |
| Preview never creates a submission | PASS | Mocked route fixture | `scrub-round2-a.test.ts:237-298` makes submission lookup/insert/transaction throw and asserts zero calls. |
| `package_config` persists | PASS | Mocked route repository | `scrub-round2-a.test.ts:291-313` exercises PUT then GET. Actual dev remains unavailable because `public.leads.package_config` is absent. |
| `package_config` reset persists | PASS | Mocked route repository | `scrub-round2-a.test.ts:291-320` exercises DELETE then GET. Actual dev remains unavailable because `public.leads.package_config` is absent. |
| One lender is sent per submission | PASS | Mocked route fixture | `lenderSubmissionRoute.test.ts:493-517`. |
| 24-hour duplicate is refused | PASS | Mocked route fixture | `lenderSubmissionRoute.test.ts:424-436`. |
| Admin duplicate override succeeds and records override activity | PASS | Mocked route fixture | `scrub-round2-a.test.ts:326-401` passes `admin_override: true`, makes duplicate lookup throw if reached, and asserts `lender_submitted` with `details.adminOverride: true` (`lenders.ts:662-670`). |
| Deal is created/moved to Submitted | PASS | Mocked route fixture | `lenderSubmissionRoute.test.ts:438-490`. |
| Snapshot re-download is byte-identical | PASS | Mocked route fixture | `lenderSubmissionRoute.test.ts:346-389`. |
| Rep receives 403 for another rep’s lead | PASS | Mocked route fixture | `lenderSubmissionRoute.test.ts:410-422`. |
| Submission status edits are activity-logged | PASS | Mocked route fixture | `lenderSubmissionRoute.test.ts:519-545`. |
| Trucking $60k/TIB18/FICO560 matches KEF and YES only | PASS | Pure matcher fixture | `matchingEngine.test.ts:179-314`. |
| FICO660 adds NMEF | PASS | Pure matcher fixture | `matchingEngine.test.ts:339-357`. |
| WC $12k/TIB14/FICO520 matches Luminar only | PASS | Pure matcher fixture | `matchingEngine.test.ts:361-383`. |
| WC law firm $1.2M/TIB30 matches Ophelia and Dexly, not Luminar | PASS | Pure matcher fixture | `matchingEngine.test.ts:385-401`. |
| Equipment $400k with financials matches CapTech; without financials excludes it | PASS | Pure matcher fixture | `matchingEngine.test.ts:403-421`. |
| AMUR and AFG restricted industries are excluded | PASS | Pure matcher fixture | `matchingEngine.test.ts:424-465`. |
| Closeout repeat is idempotent at 0/0/N | PASS | Mocked operation fixture | `newLenderSeeds.test.ts:324-340,522-650`. |
| Seed-new repeat is idempotent at 0/0/N | PASS | Mocked route fixture | `lenderSeedRoutes.test.ts:73-102`. |
| Fresh DB boot applies 001–022 in order | FAIL | Actual dev isolated-schema transaction | Observed `003_deals.sql:21: relation "activity_log" does not exist`; no commit occurred. Details: `SCRUB_ROUND2_FIXTURES.md:19`. |
| Seeded DB boot reports schema OK | BLOCKED | Dev schema unavailable | Development has no `schema_migrations` ledger and is missing `leads.package_config`. |
| Failing migration reports and server starts | PASS | Synthetic runner fixture | `schemaBoot.test.ts:76-158`. |
| Lead/deal 404 versus error+retry | PASS | Client error-helper behavior; browser untested | `query-error.test.ts:5-16`; `query-error.ts:14-39` preserves status/reason for the detail-page branches. |
| Notifications portal works | PASS | Source behavior; browser untested | `notification-bell.tsx:44,117-141` covers fetched list, loading, failure, empty, and notification states. |
| New Deal currency fields start blank | PASS | Source behavior; browser untested | `deal-detail.tsx:184-204,360-374` initializes form state and controls currency inputs with string values. |

## Counts

- PASS: 46
- FAIL: 1
- BLOCKED: 1

## Required follow-up before release

Construct a complete version-0 schema fixture for migrations 001–022 and run the
runner against it in an isolated development transaction. Apply approved
migrations through the normal development/publish flow before attempting the
blocked seeded-schema boot path. Do not use production.