# Final CRM certification — execution report

**Status: INCOMPLETE — structural stage passed; final certification did not complete.**

The requested run captured the full baseline and candidate structure matrix and passed the strict structural gate. Main's persistent runner then disappeared after a ShellExec backend disconnect, after writing the structural-stage artifacts but before the functional journeys and final HTTP/console classification. There is no runner exit marker or retained task log. Do not treat this structural-stage pass as a full certification pass, and do not infer a product failure from the interrupted process.

## Inputs and preflight

| Item | Verified value |
|---|---|
| Target source | `b3975aea8761ce5cdb43ec3206fe995ee012883a` |
| Local snapshot | `3d40d822dae9eeb103ba65923b4e445a7c8531a2` |
| Immutable web root | `/home/runner/workspace/.local/opt-in-recertification/public` |
| Web index SHA-256 | `704b9236468e84d7fd5c85f7c5305ee8659cc4ca2c2c87c5db7786d45ad5d6ca` |
| API dist SHA-256 | `fbb87d2f59917f20c4bf42f8dfd1da8149611add98d6269d189566cb09bfc79c` |
| Source binding | `final-source-binding.json`: 881 runtime files bound to the requested target |
| Preflight | Main reported all 11 gates exit 0; retained `preflight-exit.txt` is `0` |
| Cheap independent check | `check-final-sourceproof.mjs` PASS; confirmed pins/hashes, exact fixture-source branches, scope, schema-only clone provenance, and 36 archived exemption cases without browser/Clerk/fixture startup |
| Harness syntax | `node --check` PASS |

The Twilio proof was corrected to the actual code path: `ACCOUNT_SID` is read from `process.env`, the token route calls `getTwilioFailureReason()`, and the missing-SID branch returns the route's 503 with the `reason` field. The stale assertion failure from attempt 1 is retained as harness evidence; it was not a product behavior failure.

## Approved comparison scope

- Add exactly one Search referrer `INPUT` and one Share referral link `BUTTON` in each of six Lead Detail role/width cases: 12 total.
- Remove only the exact enabled `BUTTON[type=button]` named `Retry`, once in each of rep Leads/Pipeline at 390/768, from reference comparison positions only. Expected baseline/archive=4 each; candidate=0.
- Keep all other controls and the original exemption inventory unchanged and ordered across 36 role/page/width cases.

This scope is encoded in `../approval-manifest.json`. The browser comparison completed: `structurePass` is true; all 36 comparisons pass; additions are 12/12; the Retry reference/candidate totals are baseline 4, archive 4, candidate 0. `structure-differences.json` is empty. The baseline exemption inventory is separately compared without widening.

## Run attempts and observed coverage

| Attempt | Outcome |
|---|---|
| 1 | Stopped before fixture startup on the stale Twilio source-proof assertion. Full error retained in `corrected-run-failure.txt` and `launch-attempt-1-source-proof-failure.log`. |
| 2 | Created an isolated fixture DB but produced no certification results. The orphan DB was dropped; attempt log and cleanup note retained. |
| 3 | Detached process did not persist after its ShellExec action ended; no route captures/results. |
| 4 | Timed out at the tool ceiling with 36/72 baseline route visits and no candidate capture. Partial monitor/progress and cleanup record retained. |
| 5 | Timed out at the same ceiling with 36/72 baseline visits and no candidate capture. Partial monitor/progress and cleanup record retained. |

### Attempt 6 — partial structural pass

Main's persistent runner captured all 72 baseline/target visits, then wrote a strict structural pass: all 36 comparisons passed, additions=12/12, Retry baseline/archive/candidate counts=4/4/0, and `structure-differences.json` is empty. Target route capture shows fixture login and route rendering succeeded for admin, manager, and rep across all six pages and both widths.

The attempt-6 runner ended when the workspace reset (per Main's correction; this was not a product failure) before journeys and final HTTP/console classification. No exit marker or task log survived. Its retained JSON contains 143 raw console events (99 baseline; 44 target, comprising 32 resource-status 503 messages and 12 resource-status 404 messages). Their request URLs are unrecoverable; they remain uncorrelated and unclassified and were not retro-correlated by the later supplement. No `http-response-errors.json`, `console-response-correlations.json`, or `runtime-error-classification.json` was written for attempt 6.

The Leads/campaign journey phase did not run in attempt 6: `journeys` is empty and it has no target screenshots or campaign verification. The separate supplemental run below later covered Leads interactions/screenshots, but not the Campaign Results/Sent=13 assertion.

## Built-app smoke and Clerk key diagnosis

Preflight gate 7 is `built-app smoke` (`scripts/src/preflight.ts`); `playwright.smoke.config.ts` launches `scripts/src/smoke-server.ts`. That entrypoint builds with inherited `process.env`, `NODE_ENV=production`, `PORT`, and `BASE_PATH="/"`. A value-free scan found exactly one embedded publishable-key/host pair in each of the frozen target, known-working baseline, and current `artifacts/mbs-crm/dist/public`; all three key fingerprints and host fingerprints matched. No publishable-key/host mismatch was found. The target's 36 route captures also show fixture login succeeded across all three roles; this does not substitute for the missing functional journey.

## Supplemental continuation — evidence from separate executions; no single-run pass

The first Main-managed `../supplemental/supplemental-certification.mjs` task exited **1** after all 18 candidate-only 390px role/route visits, 22 recorded Leads journey steps, and eight Leads screenshots. `../supplemental/run/combined-summary.json` correctly marks `INCOMPLETE_OR_FAILED` and labels structure evidence as a separate attempt-6 result: 36/36 comparisons passed, additions=12/12, Retry baseline/archive/candidate=4/4/0. No single-run completion is claimed. Its `original-evidence-integrity.json` confirms all five attempt-6 structural evidence files are unchanged.

The first execution did not reach Campaign Results/Sent=13. Its historical fixture insertion failed before campaign navigation at `supplemental-certification.mjs:511–512`: the generated synthetic lead phone literal lacked its closing quote before the `Synthetic Campaign Recipient` value. Main fixed the helper phone fragment. This was a supplemental harness SQL construction defect, not an observed product journey failure; the transaction rolled back and the disposable DB was cleaned up.

Main then launched the separate `--campaign-only` continuation (port 4340); evidence is in `../supplemental/campaign-only-review.md`. Before Chromium, the helper executed the complete generated SQL in a fresh guarded schema-only fixture inside an explicit transaction and rolled it back (`campaign-sql-preflight.json`: PASS). It then seeded and verified one launch, 13 recipients, and 13 sends. Campaign Results and Metrics APIs both returned **200**; counts were `eligible=13`, `sent=13`, `failed=0`, with one launch. On the UI, the Results tab was selected and both legacy and new Sent KPIs showed **13**. The historical-tracking disclosure and “Not tracked” unknown metrics were visible. The retained campaign screenshot is `../supplemental/campaign-only-run/screenshots/campaign-5-results.png`. This continuation did not repeat any route, Leads journey, or prior screenshot.

The campaign-only managed task also exited **1** (`campaign-only-run/main-persistent-exit.txt`), but after the UI/API assertions passed. Its integrated classifier counted one actual expected Twilio token 503 twice—once from CDP and once from Playwright for the same request—then treated the single matching console message as defective because both instrumentation rows shared event ID `http-1`. The raw CDP row retains `reason: null`; the uniquely matching Playwright response provides `missing:TWILIO_ACCOUNT_SID` as supporting evidence, not an invented CDP body. The strict assertions and exit are preserved. This offline normalization is in `../supplemental/derived-campaign-review.json`; the narrative review is `../supplemental/campaign-only-review.md`.

The first-run raw-trace review is `../supplemental/fresh-http-console-review.md`; its machine-readable derivation is `../supplemental/derived-first-supplement-review.json`. It exhaustively classifies 41 fresh HTTP error statuses (28 expected `POST /api/twilio/token` 503 with `missing:TWILIO_ACCOUNT_SID`; two expected owned-number 503; eleven expected application 404 with `No application on file`; zero 403). Four application 404 bodies are directly tied to response records; seven body associations are explicitly ambiguous because parallel CDP sessions reused request IDs. All 41 console messages matched by role/URL/page/time (30 unique, 11 ambiguous, zero unmatched); zero rep `GET /api/users` and zero service-worker errors. The 143 attempt-6 primitive events and original 229 primitive console entries remain attribution limits; neither is retro-guessed.

Nine PNGs are retained across the separate tasks: the eight Leads screenshots cover light/dark at 390/768/1280/1440, and the additional light campaign screenshot visibly shows Sent=13. The earlier eight were inspected; the 768px table phone column is clipped at the right edge, while 1280/1440 fit, and the 390px list is vertically scrollable. The 22 completed Leads checks covered filters, sorting, links, blank-row no-op, tel/email propagation, and theme switching.

Both supplemental cleanups passed: the first fixture `visual_refresh_fixture_610_1791254290346` and campaign-only fixture `visual_refresh_fixture_1903_1791255048704` are absent; three synthetic Clerk users from each task were deleted and absent. The five attempt-6 structural evidence hashes remained unchanged. Including earlier interrupted attempts, 15 synthetic Clerk users were deleted and verified absent. Structure remains sourced from attempt 6, not a rerun.

## Cleanup, provenance, and constraints

- The orphan fixture databases from interrupted attempts and both supplemental runs were dropped; cleanup verified `visual_refresh_fixture_610_1791254290346` and `visual_refresh_fixture_1903_1791255048704` absent.
- Fifteen synthetic Clerk users created during interrupted fixture starts (six from attempts 4/5, three from attempt 6, and three in each of two supplemental executions) were deleted by exact ID and verified absent.
- The retained clone provenance says `sourceKind: schema-only`, `realProductionBackup: false`, and `productionDataRehearsalCertified: false`. This is not an actual production-data rehearsal and does not establish ship readiness.
- No product source was edited, no Git push/publish/customer communication occurred, and no additional application workflow restart was made for these supplement tasks. Test-only reporting/helper files were updated.
- The `final-cert-run/` folder has no screenshots; eight Leads PNGs are in `../supplemental/run/screenshots/` and the campaign Results PNG is in `../supplemental/campaign-only-run/screenshots/`.

**Certification boundary:** the pinned application/UI assertions described above were verified against an anonymized **schema-only** fixture (`realProductionBackup=false`; `productionDataRehearsalCertified=false`). This does not verify behavior against real production data and does not establish shipment/readiness. Preserve both task exit-1 markers, report the stage evidence separately, and do not represent the combined evidence as one successful run.

Certification remains incomplete: preserve attempt-6's 36/36 structural pass and the separate successful Leads supplement, then address only the failed campaign-fixture flow if continuing. Do not repeat the 72-route capture. No product source was changed; there was no product workflow restart, push, publish, or customer communication. The clone remains schema-only (`realProductionBackup: false`), not a production-data rehearsal or shipment certification.
