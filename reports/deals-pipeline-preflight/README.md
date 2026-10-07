# Combined Deals pipeline preflight

Base GitHub main: 7f0c433f8e32977eda16640a34a6d1685933983f
Previously pushed pipeline tree: 428c88969bae5667373292deec51fdd7c8e16dd4
Certified candidate: 8003ce473fa38b56e76636b650c38c4cf784e4f8
Exact Git tree: 314dc1c757f320a85909c883b75eb1f899b8b79a
Invocation: pnpm preflight (normal environment, isolated exact Git checkout)

All 11 ordered gates passed, exit 0. Migration recovery and campaign flyer work from the base remain intact. Four migration-recovery scenarios passed and reached phase ready. Source files and Git commit/tree metadata were checked against GitHub; no development-source substitution was used.

## Clone provenance

DB clone source: schema-only

A schema-only fallback is not a live production-data rehearsal. The metadata-matched production-profile recovery fixture is separate from actual production snapshot coverage. No production records changed and nothing was published.

## Full-suite correction

The initial run stopped at gate 4 because two linked-deal tests still expected the old generic Deal labels. Candidate 8003ce473fa38b56e76636b650c38c4cf784e4f8 updates only their expected unavailable-contact labels and one test title. All ownership, hidden linked lead, and blocked upload assertions remain intact. The full eleven-gate run was restarted, not resumed midstream.

## Evidence

- preflight-transcript.txt: complete successful transcript, sensitive URL/credential patterns redacted.
- preflight-tail.txt: final raw-output tail with the migration recovery result.
- initial-preflight-failed.txt: retained initial failed attempt.
- source-pin.json and candidate.json: exact source and tree metadata.
- gate-results.json: command-associated real gate markers (not unit-test mock output).
- migration-rehearsals.json: actual gate 10 recovery results.
- changed-files.txt: complete file list relative to 7f0c433, including this evidence.
