# Production Scrub Round 2 — B: Request-input typing

**Scope:** code and tests only; production was not read or modified.  This pass
audited all route modules that read request input and the request-adjacent
helpers under `artifacts/api-server/src/lib`.  A route is PASS only when its
body/params/query are already schema-validated or this pass makes malformed
input return a named `400`; provider callbacks are separately identified.

| Route module | Request-input evidence | Result |
| --- | --- | --- |
| `activity.ts` | `activity.ts:14` uses `ListLeadActivityParams.safeParse` | PASS |
| `adminBackup.ts`, `adminMigrations.ts`, `adminProductionCloseout.ts`, `health.ts`, `index.ts` | no caller-controlled structured input | PASS |
| `adminErrors.ts` | `adminErrors.ts:9-24` validates the pagination query before calculating the offset | PASS |
| `adminGovernance.ts` | `adminGovernance.ts:15-35,48,165,234,270,343` validates confirmation/acknowledgement bodies and all lead id params | PASS |
| `ai.ts` | `ai.ts:145` uses `GenerateDraftBody.safeParse`; identifier checks return 400 | PASS |
| `analytics.ts` | `analytics.ts:16-62,416` parses the date/rep/granularity query once before analytics handlers use it | PASS |
| `applicationForm.ts` | `applicationForm.ts:23` validates numeric id | PASS |
| `applications.ts` | `applications.ts:134` now passes `unknown` into `parseApplicationSubmission`; `applicationValidation.ts:19,132` normalizes only records and Zod returns a named field | PASS |
| `communications.ts` | `communications.ts:18-37,90,146,219,283` validates call, SMS, metrics, and update inputs with Zod | PASS |
| `credit.ts` | `credit.ts:21-38,434,496` validates compliance log pagination, date, rep, and lead filters | PASS |
| `deals.ts` | `deals.ts:50-73,157,194,292,786` validates all list/export/analytics query values and mutation ids/bodies | PASS |
| `documents.ts` | `documents.ts:65,113,158,179,204` validates params and category before storage/database work | PASS |
| `drip.ts` | `drip.ts:90,153,206,270` legacy request `any` | BLOCKED — explicitly owned by the routing/template workstream |
| `email.ts` | `email.ts:30-58,505,584,694,717,776,813` adds Zod body/id validation with named fields | PASS |
| `flyers.ts` | `flyers.ts:17-30,50,175` validates generation and email payloads | PASS |
| `flyer-templates.ts` | `flyer-templates.ts:8-25,264,292` validates create/update payloads | PASS |
| `import.ts` | `import.ts:11,175-192` parses `columnMapping` as `Record<string,string>` and rejects malformed JSON/type | PASS |
| `leads.ts` | `leads.ts:49-75,176,462` validates list/export filters (including comma-separated ids) before SQL building | PASS |
| `lenders.ts` | `lenders.ts:25-44,462,737` validates submission/create-update request fields; package snapshots are reparsed before access | PASS |
| `me.ts` | `me.ts:8-19,31-47` validates nullable mobile and push-token bodies before trimming | PASS |
| `notes.ts`, `storage.ts`, `tasks.ts`, `users.ts`, `workflowRules.ts` | generated Zod schemas or local parsing at each body/params boundary | PASS |
| `notifications.ts` | `notifications.ts:8-15,48,91` validates list pagination and read id | PASS |
| `piiAccessLog.ts` | `piiAccessLog.ts:8-26,38,103` validates both report endpoints' date/id/category/pagination filters | PASS |
| `repPublic.ts` | slug normalized from params; no structured request body | PASS |
| `sendgrid.ts` | `sendgrid.ts:17-30,84-91` verifies signature then validates event payload shape; invalid signed payload is a named 400 | PASS |
| `settings.ts` | `settings.ts:32,108,165` is assigned to routing/settings workstream | BLOCKED |
| `twilio.ts` | `twilio.ts:22-43,99,161,251,294,321,366` verifies signature then parses provider payload types; malformed signed values return named 400 | PASS |

## Focused evidence

- `applicationValidation.test.ts` proves `null` request bodies become the
  named `type` validation error, rather than a spread/destructure exception.
- `lenderSubmissionRoute.test.ts` proves `"false"` for the boolean
  `admin_override` is rejected as `400 { error: "Invalid admin_override" }`
  before package rendering or email delivery.

## Remaining request-path `any` values

`rg -n '\bany\b' artifacts/api-server/src/routes artifacts/api-server/src/lib`
still reports database relation adapters, PDF/SDK payload adapters, tests,
generic sorting callback types, and string literals/comments.  They are not
HTTP request-input values.  At this point the only delegated request-path
work is `drip.ts` and `settings.ts`, owned by D; their final status must be
recorded after D's changes land. No mutation,
seed, matcher gate, model, consent constant, or migration `001`–`022` was
changed in this section.