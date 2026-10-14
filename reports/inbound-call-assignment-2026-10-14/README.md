# Inbound-call lead assignment fix

## Certified source

- GitHub main parent: `123902cc290984dfdb2e89ebc07b413e2bd26a9e`.
- Certified source commit: `e65e9a2619dfa7b1812d319d7740d60709f1e351`.
- Certified source tree: `ce04a216a684ba88d8f2f4086f03ddcbd57f38ae`.
- Workspace starting point was recorded separately; all five modified pre-existing files matched the verified GitHub parent before applying this scoped change.
- Certification ran in a complete remote-parent checkout with its own frozen-lockfile dependency installation. Its tracked tree remained clean after preflight.

## Root cause and behavior

Call callbacks inserted leads directly, without the existing inbound round-robin selector. Separately, the shared assignment-indicator/badge predicate recognized only aged website/QR leads, not `inbound-call`.

- Answered, missed and voicemail creation paths now use one transactional call-lead resolver.
- New call leads use the same persisted rotation, eligible active rep/manager pool and optional admin setting as USFA intake.
- Manual mode or an empty eligible pool leaves the lead unassigned and immediately eligible for the assignment queue.
- Existing linked or phone-matched leads keep their owner. Retried callbacks and later calls from the same phone reuse the lead without consuming another rotation slot.
- New lead insertion, rotation cursor changes and communication linking share a transaction; a phone-specific advisory lock serializes call creation.
- Anonymous voicemail calls retain their previous `unknown` phone fallback and remain distinct across different calls.
- The queue/badge source cohort now includes `inbound-call` and the canonical `usfundadvisor` source alongside website/QR.
- Call leads qualify immediately, irrespective of age. Existing website/QR overdue-assignment alerts retain their 24-hour threshold; USFA uses that same threshold.
- Existing calls-today activity totals (answered/missed/voicemail) are unchanged. The missing unassigned-lead component is fixed.

## Backfill without a migration

Queue membership and the badge's unassigned-lead count are computed from the same eligibility predicate. It now includes **every existing unassigned `inbound-call` lead**, without a creation-date cutoff.

Therefore historical records enter the queue on the next read after deployment; no migration, batch write, owner reassignment, timestamp rewrite or history change is needed. This task did not publish or mutate production records. The reported production example IDs were not queried; legacy-ID tests use synthetic fixtures, not live data.

## Verification

- `focused-tests.log`: **17 passed, 0 failed**.
- New tests cover manual queue entry, persisted round-robin rotation, active-role filtering, optional admins, empty-pool fallback, callback retries, later-call deduplication, preserved owners, anonymous callers, legacy eligibility and the shared SQL predicate.
- Existing website/QR cutoff and voicemail behavior tests passed.
- API typecheck passed.
- `pnpm run preflight`: **all 11 gates passed** on the certified source.
- Final API suite: 511 tests, 510 passed, 1 skipped, 0 failed. Full raw suite and gate output is in `preflight.log`.
- Four attribution recovery rehearsals, migration rehearsal and final database-divergence gate passed.
- Development API was restarted and returned `{"status":"ok","phase":"ready"}` from `/api/healthz`.
- No schema/model/migration, OpenAPI, frontend or permission changes. `migration-changes.txt` is intentionally empty.
- No external call, SMS or email was sent by the focused tests.

The actual production-clone gate used its **schema-only development-derived fallback**, not live production data. Recovery rehearsals use isolated metadata-matched fixtures. Unit-test output may print simulated backup-source messages; those are not the provenance of the actual clone gate.

## Evidence

- `preflight.log`: complete final 11-gate transcript.
- `preflight-tail.log`: verbatim final tail.
- `focused-tests.log`: targeted test output.
- `changed-files.txt`: seven source files changed against GitHub main.
- `migration-changes.txt`: empty migration/model diff.

The pushed logs were checked for credential, session, credential-bearing connection-string and SSN-value patterns before staging.
