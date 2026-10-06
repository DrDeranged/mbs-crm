# Fresh supplemental HTTP/console review

This is a manual review of only `run/http-events.ndjson`, `run/console-events.ndjson`, and `run/source-branch-validation.json` from the Main-managed supplemental run. The runner exited 1 before it could write its integrated final HTTP/console classification. Attempt 6's old 143 primitive console events were not imported or reclassified; their request URLs are unrecoverable.

## HTTP status inventory

The raw supplemental trace contains 41 `cdp-status` records: 28 `503 POST /api/twilio/token`, two `503 GET /api/settings/telephony/owned-numbers`, and eleven `404 GET /api/leads/[REDACTED_ID]/application`. There were zero 403 responses and no other HTTP error status in this trace.

| Count | Request | Page / role scope | Response detail and review |
|---:|---|---|---|
| 28 | `POST /api/twilio/token` → 503 | Candidate 390px route pages and admin functional journey; admin, manager, and rep | All 28 direct Playwright response records say `{"error":"Twilio token unavailable","reason":"missing:TWILIO_ACCOUNT_SID"}`. This matches the isolated schema-only fixture's expected missing-credential branch. |
| 2 | `GET /api/settings/telephony/owned-numbers` → 503 | `/settings`, admin; one candidate route capture and one functional-journey visit | Both direct response records say `{"error":"Twilio owned-number lookup unavailable"}`. The source branch is present in the successful source-branch proof. |
| 11 | `GET /api/leads/[REDACTED_ID]/application` → 404 | `/leads/[REDACTED_ID]`; manager 2, rep 2, admin 2 in route capture; admin 5 in the functional journey | Four direct Playwright response records give `{"error":"No application on file"}`. Seven additional body-reason records carry that same message but lack role/page/request fields, so those seven request-to-body associations are explicitly ambiguous rather than asserted as exact. The source-proven fixture route is the expected missing-application 404 branch. |

The manual review treats the 28/2 responses as directly classified and the seven unscoped 404-body associations as ambiguous. It does **not** claim the runner's final classifier passed: no `runtime-error-classification.json`, `http-response-errors.json`, or `console-response-correlations.json` was emitted.

## Console and request checks

- All 41 fresh console events were HTTP resource-status messages (30 for 503; 11 for 404). Matching raw status records by role, URL origin/path, page path, status, and a two-second window yielded 41 matched, 30 unique, 11 ambiguous, and zero unmatched. Ambiguity is concentrated in repeated same-role application requests; it is not evidence of an unmatched console error.
- Zero candidate rep `GET /api/users` requests; zero service-worker console errors; zero 403 responses.
- `request-failures.ndjson` separately records four `net::ERR_ABORTED` GETs (`/api/deals`, `/api/referrals/lead/1`, `/api/leads/[REDACTED_ID]/campaign-engagement`, and `/api/leads/[REDACTED_ID]/campaign-replies`) from the lead-detail page during the journey. These are request-abort records, not HTTP responses; the associated link/navigation journey checks completed.
- CDP request IDs are session-local but the supplemental trace assigned them a shared global event-ID namespace. Raw status records retain role/path/page/time, but some event IDs collide across parallel contexts and must not be used alone to join response bodies. This explains the seven explicit 404 ambiguities.

## Other observed outcomes

The 22 recorded Leads journey steps completed, including filters, sort, blank-row no-op, list/detail tel/email behavior, links, theme switching, and all eight screenshots. The screenshots were inspected: light/dark layouts render at all four widths; at 768px the phone column is visibly clipped at the right edge of the content area, while 1280px and 1440px fit. The 390px captures show the scrollable list continuing below the viewport.

The campaign journey did not reach the Campaign page or Results/Sent=13 assertion. Fixture insertion failed first; see the run log and combined summary. Cleanup was verified: all three supplemental synthetic Clerk users were deleted and absent, and fixture database `visual_refresh_fixture_610_1791254290346` was absent. `original-evidence-integrity.json` confirms all five original attempt-6 structural evidence files are unchanged.
