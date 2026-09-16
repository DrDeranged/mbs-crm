# SCRUB ROUND 2 — D. Routing rules

| Requirement | Status | Evidence |
| --- | --- | --- |
| Routing setting defaults are manual, 7 stale days, and auto-reassignment off | PASS | `lib/db/migrations/023_routing_and_marketing_ownership.sql:5-9`; `artifacts/api-server/src/lib/leadRouting.ts:8-12` |
| Only ordinary website inbound leads round-robin; QR-card and prospect-list sources do not | PASS | `artifacts/api-server/src/lib/leadRouting.ts:21-31`; `artifacts/api-server/src/lib/leadDistribution.ts:76-77`; `artifacts/api-server/src/routes/applications.ts:235-254`; `artifacts/api-server/src/routes/leads.ts:372-380` |
| Admin dashboard exposes a stale queue with direct reassignment action | PASS | `artifacts/mbs-crm/src/pages/dashboard.tsx:252-315` |
| Automatic stale reassignment requires round-robin plus explicit auto flag and logs old/new rep | PASS | `artifacts/api-server/src/lib/staleLeadReassignment.ts:18-88`; scheduled at `artifacts/api-server/src/index.ts:81-88` |
| Reps cannot self-assign | PASS | `artifacts/api-server/src/routes/leads.ts:1047-1050`; `artifacts/api-server/src/lib/authMatrix.test.ts:153-185` |
| Drip/template resources have `owner_id`; reps CRUD own, read admin-owned | PASS | `lib/db/migrations/023_routing_and_marketing_ownership.sql:11-24`; `artifacts/api-server/src/lib/authHelpers.ts:43-62`; `artifacts/api-server/src/routes/drip.ts:84-247`; `artifacts/api-server/src/routes/email.ts:531-801` |
| Reps can enroll only their own leads and only use readable sequences/templates | PASS | `artifacts/api-server/src/routes/drip.ts:296-340`; `artifacts/api-server/src/routes/drip.ts:225-241`; revalidated at send time in `artifacts/api-server/src/lib/dripJob.ts:109-135` |
| Routing, ownership, actual API 403s, and the core stale-query builder have focused regression tests | PASS | `artifacts/api-server/src/lib/scrub-round2-d.test.ts:22-224` |

No production records were read or changed by this implementation.