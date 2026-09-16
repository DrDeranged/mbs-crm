# API authorization matrix

**Section A audit date:** 2026-09-15  
**Audited revision:** `4bd0fde0478f25847f9eb8e5ef5ee93ffc673364` plus the
Section A fixes listed below.  The effective API mount is `/api`; paths in
this matrix include it.  The router contains **161 method registrations**
(`get`, `post`, `put`, and `delete`), not the previously reported 155.
`router.use` mounts are not counted as registrations; factory registrations
are counted at their declaration line.

`/r/:slug` is a public web-client route, not an Express registration under
`artifacts/api-server/src/routes`; its API resolver is the read-only
`GET /api/public/reps/:slug` row below.

## Controls and exact predicates

| ID | Guard and exact scope predicate |
| --- | --- |
| `U` | `requireUser(req,res)` requires a Clerk `userId`, resolves the local user, then rejects inactive users and `role === "pending"` (`authHelpers.ts:85-155`). The root defense-in-depth mutation gate also rejects every non-public `POST`/`PUT`/`PATCH`/`DELETE` without `getAuth(req).userId` (`routes/index.ts:64-85`). |
| `A` | `U`, then `user.role !== "admin"` returns 403. |
| `M` | `U`, then `user.role !== "admin" && user.role !== "manager"` returns 403. |
| `L` | `U`, then a rep is denied when `user.role === "rep" && lead.assignedRepId !== user.id`. List/export variants instead add `eq(leadsTable.assignedRepId, user.id)` to the SQL predicate. |
| `D` | `U`, then `canAccessDeal(user, deal)` is required; for a rep its predicate is `deal.assignedTo === user.id`. List/export variants add `eq(dealsTable.assignedTo, user.id)`. |
| `S` | `U`, then the target is the caller: `user.id === targetId` (or the explicitly named self record). |
| `P` | Public read-only endpoint. |
| `I` | Public, rate-limited, schema-validated form intake. This is an explicit exception to the mutation gate. |
| `T` | Public Twilio callback. `validateTwilioSignature` requires `TWILIO_AUTH_TOKEN`, `x-twilio-signature`, and `twilio.validateRequest(AUTH_TOKEN, signature, absoluteCallbackUrl, req.body)`; invalid requests return 403 (`twilio.ts:31-39`). |
| `G` | Public SendGrid callback. It requires `SENDGRID_WEBHOOK_VERIFICATION_KEY`, both SendGrid signature headers, the captured raw body, and `EventWebhook.verifySignature`; absent configuration or any invalid input returns 403 (`sendgrid.ts:17-34,72-74`). |
| `H` | Public signed email action. Tracking and unsubscribe actions require their HMAC token; unsubscribe additionally binds the token email to the persisted send (`email.ts:339-357,369-404,407-443`). |
| `K` | Public, rate-limited application-status lookup authorized by its opaque status token (`applications.ts:694-739`). |
| `O` | Authenticated endpoint whose response is not a lead/deal list, detail, export, or download. The route-specific role check shown in its source governs the operation. |

For `L` and `D`, a client-provided `repId` can only narrow results: it never
replaces the ownership predicate. `N/A` below means the route has no
lead/deal payload to scope; it is still guarded by the control in its row.

## Complete registration matrix

| Method | Effective path | Registration | Control | Rep/list/detail/export/download scope |
| --- | --- | --- | --- | --- |
| GET | `/api/` | `routes/health.ts:10` | `P` | N/A |
| GET | `/api/healthz` | `routes/health.ts:15` | `P` | N/A |
| GET | `/api/health/deep` | `routes/health.ts:20` | `P` | N/A |
| GET | `/api/me` | `routes/me.ts:9` | `S` | caller only; pending allowed by `requireUser(..., {allowPending:true})` |
| PUT | `/api/me/mobile` | `routes/me.ts:16` | `S` | `usersTable.id === user.id`; pending allowed |
| PUT | `/api/me/push-token` | `routes/me.ts:32` | `S` | `usersTable.id === user.id`; pending allowed |
| POST | `/api/admin/users/:id/retire-slug` | `routes/users.ts:61` | `A` | N/A |
| POST | `/api/admin/rep-slugs/retire` | `routes/users.ts:72` | `A` | N/A |
| POST | `/api/admin/users/backfill-slugs` | `routes/users.ts:81` | `A` | N/A |
| GET | `/api/users` | `routes/users.ts:100` | `M` | reps rejected |
| GET | `/api/users/:id/application-form.pdf` | `routes/applicationForm.ts:22` | `U` | admin, or `actor.role === "rep" && actor.id === id` |
| PUT | `/api/users/:id` | `routes/users.ts:124` | `A` | N/A |
| PUT | `/api/users/:id/push-token` | `routes/users.ts:198` | `S` | `user.id === targetId`; pending allowed |
| POST | `/api/leads/import/preview` | `routes/import.ts:128` | `A` | reps rejected |
| POST | `/api/leads/import` | `routes/import.ts:160` | `A` | reps rejected |
| POST | `/api/twilio/token` | `routes/twilio.ts:42` | `U` | caller receives only `user_${user.id}` token |
| POST | `/api/twilio/voice` | `routes/twilio.ts:88` | `T` | provider callback; no rep-selected record |
| POST | `/api/twilio/voice/inbound` | `routes/twilio.ts:147` | `T` | provider callback; assignment is read from matched lead |
| POST | `/api/twilio/voice/status` | `routes/twilio.ts:234` | `T` | provider callback |
| POST | `/api/twilio/voice/recording` | `routes/twilio.ts:274` | `T` | provider callback |
| POST | `/api/twilio/sms/inbound` | `routes/twilio.ts:296` | `T` | provider callback; assignment is read from matched lead |
| POST | `/api/twilio/sms/status` | `routes/twilio.ts:350` | `T` | provider callback |
| POST | `/api/leads/:id/calls/log` | `routes/communications.ts:56` | `L` | `lead.assignedRepId === user.id` for reps |
| POST | `/api/leads/:id/sms` | `routes/communications.ts:97` | `L` | `lead.assignedRepId === user.id` for reps |
| GET | `/api/leads/:id/communications` | `routes/communications.ts:165` | `L` | `lead.assignedRepId === user.id` for reps |
| GET | `/api/metrics/communications` | `routes/communications.ts:189` | `M` | reps rejected; managers/admins may select a rep aggregate |
| PUT | `/api/communications/:id` | `routes/communications.ts:251` | `U` | reps may update only communication `userId === user.id`; managers/admins allowed |
| GET | `/api/email/track/open/:sendId` | `routes/email.ts:339` | `H` | signed tracking token |
| GET | `/api/brand/logo.png` | `routes/email.ts:361` | `P` | public static brand image |
| GET | `/api/email/track/click/:sendId` | `routes/email.ts:369` | `H` | signed tracking token and safe HTTP(S) destination |
| GET | `/api/email/unsubscribe` | `routes/email.ts:407` | `H` | HMAC token plus persisted send/email equality |
| POST | `/api/email/send` | `routes/email.ts:565` | `L` | reps require `lead.assignedRepId === user.id`; selected template must be owned by that rep or an admin |
| POST | `/api/email/bulk` | `routes/email.ts:527` | `M` | reps rejected |
| GET | `/api/email/bulk-capacity` | `routes/email.ts:671` | `M` | reps rejected; reports only the shared daily aggregate |
| GET | `/api/email/templates` | `routes/email.ts:736` | `U` | reps may read templates they own or templates whose `ownerId` is an admin |
| GET | `/api/email/templates/:id` | `routes/email.ts:751` | `U` | reps may read their own or admin-owned templates |
| POST | `/api/email/templates` | `routes/email.ts:769` | `U` | rep-created template is bound to `createdBy` and `ownerId: user.id` |
| PUT | `/api/email/templates/:id` | `routes/email.ts:792` | `U` | reps may modify only `ownerId === user.id` |
| DELETE | `/api/email/templates/:id` | `routes/email.ts:825` | `U` | reps may delete only `ownerId === user.id` |
| POST | `/api/email/templates/:id/preview` | `routes/email.ts:851` | `U` | reps may preview their own or admin-owned templates and, if a lead is supplied, require `lead.assignedRepId === user.id` |
| POST | `/api/email/test-send` | `routes/email.ts:752` | `A` | reps rejected |
| GET | `/api/leads/:id/emails` | `routes/email.ts:819` | `L` | `lead.assignedRepId === user.id` for reps |
| POST | `/api/email/seed-starter` | `routes/email.ts:1005` | `A` | reps rejected |
| GET | `/api/drip/sequences` | `routes/drip.ts:103` | `U` | reps may read sequences they own or sequences whose `ownerId` is an admin |
| POST | `/api/drip/sequences` | `routes/drip.ts:120` | `U` | persisted `createdBy` and `ownerId: user.id` |
| GET | `/api/drip/sequences/:id` | `routes/drip.ts:147` | `U` | reps may read their own/admin-owned sequences only when every embedded template is also own/admin-owned |
| PUT | `/api/drip/sequences/:id` | `routes/drip.ts:182` | `U` | reps may modify only `ownerId === user.id` |
| DELETE | `/api/drip/sequences/:id` | `routes/drip.ts:220` | `U` | reps may delete only `ownerId === user.id` |
| PUT | `/api/drip/sequences/:id/steps` | `routes/drip.ts:237` | `U` | reps may modify only own sequences and may use only own/admin-owned templates |
| GET | `/api/leads/:id/drip` | `routes/drip.ts:273` | `L` | reps require `lead.assignedRepId === user.id` and may read only own/admin-owned enrollment sequences |
| POST | `/api/leads/:id/drip/enroll` | `routes/drip.ts:315` | `L` | reps require `lead.assignedRepId === user.id`, an own/admin-owned sequence, and own/admin-owned templates in every step |
| POST | `/api/leads/:id/drip/unenroll` | `routes/drip.ts:364` | `L` | `lead.assignedRepId === user.id` for reps |
| POST | `/api/sendgrid/webhook` | `routes/sendgrid.ts:72` | `G` | signed provider callback |
| GET | `/api/leads` | `routes/leads.ts:263` | `L` | SQL adds `eq(leadsTable.assignedRepId, user.id)` |
| POST | `/api/leads` | `routes/leads.ts:265` | `U` | only admin/manager may supply `assignedRepId` |
| POST | `/api/leads/capture` | `routes/leads.ts:319` | `I` | public website intake, rate limited and `CaptureLeadFromWebsiteBody.safeParse` |
| GET | `/api/leads/export` | `routes/leads.ts:420` | `L` | export `buildLeadsWhere` adds `eq(leadsTable.assignedRepId, user.id)` |
| POST | `/api/leads/bulk/status` | `routes/leads.ts:546` | `M` | reps rejected |
| POST | `/api/leads/bulk/assign` | `routes/leads.ts:590` | `M` | reps rejected |
| POST | `/api/leads/bulk/delete` | `routes/leads.ts:686` | `A` | reps rejected |
| POST | `/api/leads/:id/score` | `routes/leads.ts:703` | `L` | `lead.assignedRepId === user.id` for reps |
| GET | `/api/leads/:id` | `routes/leads.ts:724` | `L` | `lead.assignedRepId === user.id` for reps |
| PUT | `/api/leads/:id` | `routes/leads.ts:809` | `L` | `existing.assignedRepId === user.id` for reps |
| PUT | `/api/leads/:id/status` | `routes/leads.ts:879` | `L` | `existing.assignedRepId === user.id` for reps |
| PUT | `/api/leads/:id/assign` | `routes/leads.ts:1121` | `M` | reps rejected; cannot self-assign |
| GET | `/api/leads/:id/activity` | `routes/activity.ts:10` | `L` | `lead.assignedRepId === user.id` for reps |
| GET | `/api/leads/:id/notes` | `routes/notes.ts:11` | `L` | `lead.assignedRepId === user.id` for reps |
| POST | `/api/leads/:id/notes` | `routes/notes.ts:47` | `L` | `lead.assignedRepId === user.id` for reps |
| GET | `/api/leads/:id/tasks` | `routes/tasks.ts:26` | `L` | `lead.assignedRepId === user.id` for reps |
| POST | `/api/leads/:id/tasks` | `routes/tasks.ts:55` | `L` | `lead.assignedRepId === user.id` for reps |
| PUT | `/api/tasks/:taskId` | `routes/tasks.ts:103` | `L` | task lead must have `assignedRepId === user.id` for reps |
| GET | `/api/leads/:id/documents` | `routes/documents.ts:51` | `L` | `lead.assignedRepId === user.id` for reps |
| POST | `/api/leads/:id/documents` | `routes/documents.ts:80` | `L` | `lead.assignedRepId === user.id` for reps |
| PATCH | `/api/documents/:docId` | `routes/documents.ts:154` | `L` | document's lead must have `assignedRepId === user.id` for reps |
| GET | `/api/documents/:docId/download` | `routes/documents.ts:138` | `L` | document's lead must have `assignedRepId === user.id` for reps |
| GET | `/api/leads/:id/lender-package` | `routes/lenderPackage.ts:6` | `L` | handler checks `lead.assignedRepId === user.id` for reps (`lib/lenderPackage.ts:556-585`) |
| POST | `/api/leads/:id/lender-package` | `routes/lenderPackage.ts` | `L` | selected document IDs are verified against the lead; assigned reps only |
| GET | `/api/leads/:id/package-config` | `routes/lenderPackage.ts` | `L` | assigned reps only; admins/managers may access any lead |
| PUT | `/api/leads/:id/package-config` | `routes/lenderPackage.ts` | `L` | assigned reps only; admins/managers may access any lead |
| DELETE | `/api/leads/:id/package-config` | `routes/lenderPackage.ts` | `L` | assigned reps only; admins/managers may access any lead |
| GET | `/api/dashboard/summary` | `routes/dashboard.ts:57` | `M` | reps rejected |
| GET | `/api/dashboard/rep` | `routes/dashboard.ts:99` | `L` | rep path forces requested rep id to `user.id` |
| GET | `/api/dashboard/my-tasks` | `routes/dashboard.ts:146` | `L` | reps filter returned task leads by `lead.assignedRepId === user.id`; managers/admins use `tasksTable.userId === user.id` |
| GET | `/api/analytics/unassigned-inbound-count` | `routes/analytics.ts:31` | `A` | reps rejected |
| GET | `/api/analytics/summary` | `routes/analytics.ts:63` | `L` | rep forces `effectiveRepId = user.id` and `assignedRepId === user.id` |
| GET | `/api/analytics/pipeline` | `routes/analytics.ts:153` | `L` | rep forces `effectiveRepId = user.id` |
| GET | `/api/analytics/reps` | `routes/analytics.ts:333` | `M` | reps rejected |
| GET | `/api/analytics/sources` | `routes/analytics.ts:336` | `L` | reps add `leadsTable.assignedRepId === user.id` |
| GET | `/api/analytics/communications` | `routes/analytics.ts:383` | `U` | reps add `communicationsTable.userId === user.id` |
| GET | `/api/analytics/renewals` | `routes/analytics.ts:428` | `L` | reps add `leadsTable.assignedRepId === user.id` |
| GET | `/api/lenders` | `routes/lenders.ts:90` | `U` | N/A |
| POST | `/api/lenders` | `routes/lenders.ts:99` | `A` | reps rejected |
| PUT | `/api/lenders/:id` | `routes/lenders.ts:139` | `A` | reps rejected |
| DELETE | `/api/lenders/:id` | `routes/lenders.ts:159` | `A` | reps rejected |
| POST | `/api/admin/lenders/seed-new` | `routes/lenders.ts:197` | `A` | reps rejected |
| POST | `/api/leads/:id/match` | `routes/lenders.ts:227` | `L` | `lead.assignedRepId === user.id` for reps |
| GET | `/api/leads/:id/matches` | `routes/lenders.ts:256` | `L` | `lead.assignedRepId === user.id` for reps |
| POST | `/api/leads/:id/submissions` | `routes/lenders.ts:287` | `L` | `lead.assignedRepId === user.id` for reps |
| GET | `/api/leads/:id/submissions` | `routes/lenders.ts:326` | `L` | `lead.assignedRepId === user.id` for reps |
| PUT | `/api/submissions/:id` | `routes/lenders.ts:354` | `L` | submission lead's `assignedRepId === user.id` for reps |
| PATCH | `/api/submissions/:id` | `routes/lenders.ts` | `L` | submission lead's `assignedRepId === user.id` for reps |
| GET | `/api/submissions/:id/package` | `routes/lenders.ts` | `L` | submission lead's `assignedRepId === user.id` for reps; immutable object integrity checked |
| GET | `/api/deals/:id/submissions` | `routes/lenders.ts` | `D` | deal's `assignedTo === user.id` for reps |
| GET | `/api/flyer-templates` | `routes/flyer-templates.ts:212` | `U` | N/A (template list; not a lead/deal record) |
| GET | `/api/flyer-templates/:id` | `routes/flyer-templates.ts:230` | `U` | N/A (template detail; not a lead/deal record) |
| POST | `/api/flyer-templates` | `routes/flyer-templates.ts:243` | `A` | reps rejected |
| PUT | `/api/flyer-templates/:id` | `routes/flyer-templates.ts:264` | `A` | reps rejected |
| POST | `/api/flyers/generate` | `routes/flyers.ts:36` | `L` | reps require `lead.assignedRepId === user.id` |
| GET | `/api/flyers/:id/download` | `routes/flyers.ts:122` | `U` | reps require `flyer.userId === user.id` |
| POST | `/api/flyers/:id/email` | `routes/flyers.ts:158` | `U` | reps require `flyer.userId === user.id` |
| GET | `/api/flyers/:id` | `routes/flyers.ts:276` | `U` | reps require `flyer.userId === user.id` |
| GET | `/api/applications/consent-text` | `routes/applications.ts:79` | `P` | immutable public disclosure |
| POST | `/api/applications/submit` | `routes/applications.ts:128` | `I` | public multipart intake, 10/15 min, schema validation |
| GET | `/api/leads/:id/application` | `routes/applications.ts:555` | `L` | `lead.assignedRepId === user.id` for reps |
| GET | `/api/leads/:id/financials` | `routes/applications.ts:612` | `L` | `lead.assignedRepId === user.id` for reps |
| GET | `/api/applications/status/:token` | `routes/applications.ts:694` | `K` | unguessable application status token |
| POST | `/api/leads/:id/credit/consent` | `routes/credit.ts:156` | `L` | `lead.assignedRepId === user.id` for reps |
| POST | `/api/leads/:id/credit/pull` | `routes/credit.ts:200` | `L` | `lead.assignedRepId === user.id` for reps |
| GET | `/api/leads/:id/credit` | `routes/credit.ts:372` | `L` | `lead.assignedRepId === user.id` for reps |
| GET | `/api/credit/compliance-log` | `routes/credit.ts:410` | `A` | reps rejected |
| GET | `/api/credit/compliance-log/export` | `routes/credit.ts:470` | `A` | reps rejected |
| GET | `/api/workflow-rules` | `routes/workflowRules.ts:31` | `A` | reps rejected |
| POST | `/api/workflow-rules` | `routes/workflowRules.ts:42` | `A` | reps rejected |
| PUT | `/api/workflow-rules/:id` | `routes/workflowRules.ts:61` | `A` | reps rejected |
| DELETE | `/api/workflow-rules/:id` | `routes/workflowRules.ts:88` | `A` | reps rejected |
| GET | `/api/notifications/unread-count` | `routes/notifications.ts:10` | `U` | `notificationsTable.userId === user.id` |
| PUT | `/api/notifications/read-all` | `routes/notifications.ts:23` | `U` | `notificationsTable.userId === user.id` |
| GET | `/api/notifications` | `routes/notifications.ts:36` | `U` | `notificationsTable.userId === user.id` |
| PUT | `/api/notifications/:id/read` | `routes/notifications.ts:77` | `U` | update predicate includes `notificationsTable.userId === user.id` |
| POST | `/api/ai/pipeline-digest` | `routes/ai.ts:52` | `M` | reps rejected |
| GET | `/api/leads/:id/ai/briefing` | `routes/ai.ts:65` | `L` | `lead.assignedRepId === user.id` for reps |
| POST | `/api/leads/:id/ai/briefing` | `routes/ai.ts:85` | `L` | `lead.assignedRepId === user.id` for reps |
| POST | `/api/leads/:id/next-action` | `routes/ai.ts:114` | `L` | `lead.assignedRepId === user.id` for reps |
| POST | `/api/leads/:id/ai/draft` | `routes/ai.ts:135` | `L` | `lead.assignedRepId === user.id` for reps |
| GET | `/api/settings/company` | `routes/settings.ts:11` | `A` | reps rejected |
| PUT | `/api/settings/company` | `routes/settings.ts:24` | `A` | reps rejected |
| GET | `/api/settings/email-delivery` | `routes/settings.ts:91` | `A` | reps rejected |
| PUT | `/api/settings/email-delivery` | `routes/settings.ts:103` | `A` | reps rejected |
| GET | `/api/settings/lead-distribution` | `routes/settings.ts:148` | `A` | reps rejected |
| PUT | `/api/settings/lead-distribution` | `routes/settings.ts:160` | `A` | reps rejected |
| GET | `/api/admin/errors` | `routes/adminErrors.ts:10` | `A` | reps rejected |
| GET | `/api/admin/migrations/status` | `routes/adminMigrations.ts:12` | `A` | reps rejected |
| POST | `/api/admin/migrations/apply` | `routes/adminMigrations.ts:32` | `A` | reps rejected |
| GET | `/api/admin/backup/export` | `routes/adminBackup.ts:8` | `A` | reps rejected |
| GET | `/api/pii-access-log` | `routes/piiAccessLog.ts:11` | `A` | reps rejected |
| GET | `/api/pii-access-log/export` | `routes/piiAccessLog.ts:77` | `A` | reps rejected |
| GET | `/api/leads/:id/compliance-status` | `routes/adminGovernance.ts:22` | `M` | reps rejected |
| GET | `/api/admin/data-governance/retention-preview` | `routes/adminGovernance.ts:89` | `A` | reps rejected |
| POST | `/api/admin/data-governance/purge` | `routes/adminGovernance.ts:139` | `A` | reps rejected |
| DELETE | `/api/leads/:id/pii` | `routes/adminGovernance.ts:212` | `A` | reps rejected |
| DELETE | `/api/leads/:id/pii/force` | `routes/adminGovernance.ts:319` | `A` | reps rejected |
| GET | `/api/storage/public-objects/*filePath` | `routes/storage.ts:56` | `P` | separate allowlisted public-object namespace only |
| POST | `/api/storage/uploads/request-url` | `routes/storage.ts:23` | `U` | N/A |
| GET | `/api/storage/objects/*path` | `routes/storage.ts:90` | `L` | private lead-doc path: rep requires `lead.assignedRepId === user.id`; all other paths denied |
| GET | `/api/public/reps/:slug` | `routes/repPublic.ts:163` | `P` | public rep card; no lead/deal payload |
| GET | `/api/public/reps/:slug/qr.png` | `routes/repPublic.ts:191` | `P` | public QR image |
| GET | `/api/public/reps/:slug/qr.svg` | `routes/repPublic.ts:203` | `P` | public QR image |
| GET | `/api/public/reps/:slug/application-form.pdf` | `routes/repPublic.ts:126` | `P` | public rep application form |
| GET | `/api/admin/qr-verify` | `routes/repPublic.ts:306` | `A` | direct Clerk `userId`, then active non-pending local user and `role === "admin"` |
| GET | `/api/deals/export` | `routes/deals.ts:148` | `D` | SQL adds `eq(dealsTable.assignedTo, user.id)` for reps |
| GET | `/api/deals` | `routes/deals.ts:150` | `D` | SQL adds `eq(dealsTable.assignedTo, user.id)` for reps |
| POST | `/api/deals` | `routes/deals.ts:369` | `U` | rep may set `assignedTo` only to self; persisted value is `user.id` |
| GET | `/api/deals/:id` | `routes/deals.ts:420` | `D` | `canAccessDeal` requires `assignedTo === user.id` for reps |
| PUT | `/api/deals/:id` | `routes/deals.ts:571` | `D` | access predicate plus reps may not change `assignedTo` |
| POST | `/api/deals/:id/archive` | `routes/deals.ts:573` | `D` | `canAccessDeal` requires `assignedTo === user.id` for reps |
| DELETE | `/api/deals/:id` | `routes/deals.ts:605` | `A` | reps rejected |
| GET | `/api/deals/:id/activity` | `routes/deals.ts:625` | `D` | `canAccessDeal` requires `assignedTo === user.id` for reps |
| POST | `/api/leads/:id/convert-to-deal` | `routes/deals.ts:655` | `L` | source lead requires `assignedRepId === user.id`; resulting deal assigned to user |
| GET | `/api/deals/analytics` | `routes/deals.ts:739` | `D` | rep forces `effectiveRepId = user.id`, then `assignedTo === effectiveRepId` |
| POST | `/api/admin/deals/seed` | `routes/deals.ts:1079` | `A` | reps rejected |
| POST | `/api/admin/deals/reassign-seeded` | `routes/deals.ts:1195` | `A` | reps rejected |
| POST | `/api/admin/production-closeout` | `routes/adminProductionCloseout.ts:32` | `A` | reps rejected |

## Findings and verification

| Status | Finding | Evidence / disposition |
| --- | --- | --- |
| PASS | All `/admin` registrations require the exact admin role. | The 14 `/admin` rows above map to `A`; `repPublic.ts:306-325` applies the same exact predicate without `requireUser` to preserve its read-only health-check behavior. |
| FIXED | SendGrid accepted unsigned callbacks outside production when its verification key was absent. | `sendgrid.ts:20` previously returned `!IS_PROD`. It now fails closed when no key exists, and the route returns 403 before any write (`sendgrid.ts:17-34,72-74`). |
| FIXED | There was no router-wide regression barrier for newly registered mutations. | `routes/index.ts:64-85` now installs a Clerk-session mutation gate before every child router. The only exceptions are the explicit public form-intake and provider-callback paths in `PUBLIC_MUTATION_PATHS`. |
| FIXED | The public rep-card `GET` had a first-view activity-log insert. | `repPublic.ts:163-185` now resolves and returns the public card without a database write; public QR/form reads remain read-only. |
| PASS | Twilio callbacks verify Twilio signatures. | All six callback paths use `T`; token minting is authenticated and is not a callback. |
| PASS | Clerk webhooks. | No Clerk webhook registration exists in `artifacts/api-server/src/routes` (0 to verify). Clerk user authentication is established by `clerkMiddleware` in `app.ts:95-102`; the API mutation gate uses Clerk `getAuth(req).userId`. |
| PASS | Reps cannot self-assign leads. | `/leads/:id/assign` is manager/admin-only (`leads.ts:1039-1043`); `createAssignLeadHandler` makes that behavior directly testable. |
| FIXED | Rep-owned email templates and drip sequences were readable across reps. | Marketing ownership uses `ownerId`: reps may read their own or admin-owned resources and may CRUD only their own. Template-backed sends and drip enrollment enforce the same rule for every referenced template (`email.ts:531-802`; `drip.ts:103-346`). |
| PASS | Router-walk regression coverage. | `src/lib/authMatrix.test.ts` recursively walks the real composed router, pins the 161 registration count, requires exact method/path equality with this matrix, and uses a branded mocked Clerk request context with the actual production mutation gate. It makes a denied request for every private mutation, plus an authenticated probe, without mounting a test-only preempting guard. It also exercises rep self-assignment denial plus unsigned SendGrid and Twilio callback denial. |
| PASS | Router-walk test isolation. | `flyer-templates.ts:202-209` honors the test-only `DISABLE_FLYER_TEMPLATE_SEED=true` guard used before the composed router is imported, so route inspection cannot trigger its legacy module-load seed write. |

**Re-enumeration result:** 161 registrations and 161 matrix rows. This
reconciliation is route-inventory evidence, not exhaustive authorization proof.
Runtime suite/typecheck status must be recorded from their actual command
results; no unresolved Section A source-audit finding is currently listed here.