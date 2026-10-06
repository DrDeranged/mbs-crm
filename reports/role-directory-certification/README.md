# Role-directory full certification (prepared; not launched)

This is a new, focused, single-run certification for the finalized candidate. **Do not launch** until Main has completed the 11-gate preflight, frozen immutable source/build pins, and replaced `launch-authorization.template.json` with `launch-authorization.json` containing `sourceFinalized=true`, `elevenGatePreflightExit=0`, `immutablePinsFrozen=true`, and `launchAuthorized=true`. The runner enforces that gate before fixture/browser creation.

`policy.json` keeps exactly the three previously approved structural exception categories—Search referrer input, Share referral link button, and the four rep Retry removals. The newly approved rep directory-control hiding is recorded separately as a role-policy requirement, not a wildcard or an added structural exception.

Main's `launch-authorization.json` must fill the template with both source-tree SHA-256 values (`artifacts/mbs-crm/src` and `artifacts/api-server/src`), the candidate web root/index/tree and API-dist hashes, target revision/local snapshot, unchanged 2af9 baseline tree hash, exact `policy.json` SHA-256, test-runner/sandbox/readiness-helper and historical-fixture file hashes, an unused fixture port, and `frozenAt`. `preflightEvidence` is `{ "path": "<workspace-relative 11-gate evidence file>", "exitCode": 0, "sha256": "<file SHA-256>" }`. The runner re-hashes all pinned trees/evidence before creating output, a database fixture, or a browser; `--check-ready-only` performs only those checks.

When authorized, `role-directory-certification.mjs` will:

1. Verify source/build/baseline/approval pins against the authorization file.
2. Create a fresh schema-only fixture with delivery/provider credentials stripped.
3. Validate the historical campaign INSERT SQL in an explicit fixture `BEGIN`/`ROLLBACK` transaction before Chromium, then seed and verify the isolated Campaign 5 rows with its original manager/admin ownership and 13/13 send totals.
4. Capture exactly 36 baseline and 36 candidate structural inventories (three roles × six routes × 390/768), applying only the three approved structural exception categories.
5. Exercise all 11 rep-directory policy routes; assert rep `GET /api/users` is zero from first route mount onward and directory-backed filters/pickers are absent. For `/campaigns/5`, require the real `Manager Access Required` UI and zero campaign-support HTTP requests; Campaign 5 remains manager/admin-only, with its original appropriate owner. Verify admins/managers retain enabled and usable controls, opening both the new-deal and existing-deal edit forms and using each picker without saving.
6. Run the Leads functional checks and save the eight 390/768/1280/1440 light/dark screenshots; then verify Campaign 5 Results/Metrics APIs and both Sent=13 KPIs as an admin.
7. Preserve raw Playwright responses with unique stable request IDs and CDP records with independent session/request IDs. CDP/Playwright rows are correlated as protocol representations, not counted as two requests. Candidate HTTP 403/404/503 counts must be zero in each source for every role; no statuses, logs, or credentials are suppressed or mocked.
8. Persist phase progress, request/response/console/page-error events, cleanup, exact assertion values, and a separate-execution report that states the fixture's schema-only provenance. The runner refuses to overwrite prior output.

The 143 attempt-6 and 229 original primitive console records remain unattributed. This new run will not reuse prior screenshots or route/journey passes. No production database is used; a passing app/UI run will not certify production-data behavior.
