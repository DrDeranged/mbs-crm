# Campaign-only continuation — separate execution review

## Verdict and boundaries

Main launched the prepared `--campaign-only` task (`CERT_CAMPAIGN_PORT=4340`, task `9603edb7-1b92-448e-a66e-74003e461b43`; log `/tmp/replit-background-tasks/9603edb7-1b92-448e-a66e-74003e461b43.log`). The task exited **1** and that marker is retained at `campaign-only-run/main-persistent-exit.txt`. Do not rewrite it as exit 0 or merge it into the earlier failed supplement.

The application-level campaign Results journey did complete and its Sent=13/API/UI checks passed. The managed command's overall exit 1 came later from its HTTP/console correlation assertion treating two instrumentation representations of the same expected response as two different response records. This is a runner-classification defect, not an unexpected Campaign Results/API response. The classifier did not pass as implemented; the raw events below are explicitly reconciled rather than silently changing the task result.

## SQL, fixture, API, and UI evidence

- `campaign-only-run/campaign-sql-preflight.json` is `PASS`: the generated campaign SQL executed in the fresh guarded schema-only fixture inside an explicit `BEGIN`/`ROLLBACK` transaction **before Chromium was launched**.
- `campaign-only-run/campaign-fixture-verification.json` records the subsequent fixture seed and verification: one launch, 13 recipients, and 13 sends. No production records were used.
- `campaign-only-run/campaign-api-results.json`: Results API **200**, Metrics API **200**; `eligible=13`, `excluded=0`, `sent=13`, `failed=0`, `deferred=0`; one launch; metrics `sent=13`, `trackingSince=null`.
- `campaign-only-run/campaign-results-verification.json`: page title `Vendors — Heavy Equipment`, Results selected, legacy Results Sent and new Sent KPI both `13`; the tracking disclosure says “Historical tracking not available” and unknown historical metrics are “Not tracked.”
- `campaign-only-run/screenshots/campaign-5-results.png` visibly shows the completed campaign, Results selection, and Sent **13**. Combined screenshot inventory is nine: the eight retained Leads PNGs (`leads-{390,768,1280,1440}-{light,dark}.png`) plus this campaign Results screenshot (light theme). No Leads capture was repeated.
- Cleanup is verified in `campaign-only-run/cleanup-verification.json`: all three synthetic Clerk users deleted/absent and fixture database `visual_refresh_fixture_1903_1791255048704` absent. `original-evidence-integrity.json` confirms the five attempt-6 files remain unchanged.

## Why the separate task still exited 1

`campaign-only-run/http-events.ndjson` contains one `cdp-status` and one `playwright-response` for the same admin `POST /api/twilio/token` at `/campaigns/5` (same `http-1`, same URL/status, timestamps 1 ms apart). The direct Playwright response body explicitly reports `503`, `Twilio token unavailable`, reason `missing:TWILIO_ACCOUNT_SID`; this is the expected fixture credential omission. There is one matching browser console message for that 503.

The runner's in-memory classifier emitted one row for each protocol representation: the CDP-only row retained `reason: null` and was labeled `defect: unexpected status/path/reason`, while the Playwright row was correctly classified as expected. Crucially, the strict record's `reasonOrExplicitAmbiguity` says “Duplicate same-role/page/phase response; this response body was unavailable” and its `supportingResponse` identifies `eventId=http-1`, `status=503`, and the exact missing-`TWILIO_ACCOUNT_SID` reason. This matched response is supporting evidence only; the CDP row is not rewritten with an invented body. Console correlation then saw two matching rows with the same event ID and marked the single expected 503 console message as ambiguous/defective. Those two rows are not evidence of two unexpected endpoint failures. Offline normalization deduplicates the protocol representations by role/phase/method/status/URL/page/event ID and the 1 ms timestamp delta, classifying one expected fixture response with explicit response ambiguity. There are no page exceptions or service-worker errors. The task's strict runtime-classifier assertions remain false and its exit 1 is not retroactively replaced.

## Integrated interpretation

Keep the evidence as separate executions: attempt 6 structural comparison **36/36**; first supplemental task exit **1** after **18/18** candidate route visits, **22/22** Leads journey checks, and eight Leads screenshots (its original campaign SQL quote defect is preserved as historical; Main fixed the helper); this campaign-only execution reached and verified **Sent=13** but its trace-classifier assertion caused exit **1**. The first attempt-6 count of 143 primitive console events and the separate original 229 primitive console entries remain attribution limits; neither was retro-guessed.

This validates the pinned app/UI behavior against an anonymized **schema-only** fixture. It is not a real production-data rehearsal (`realProductionBackup=false`, `productionDataRehearsalCertified=false`) and does not establish production-data behavior, release readiness, or ship readiness. No product source was changed.
