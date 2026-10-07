# Audience-aware campaign flyer links

Certified source: aef093f674f6b5e6f51223ff8f42ecff9a3773c5
Base GitHub main containing migration recovery: dc70517b53d9493e40e110e12b5e13086253a9a9
Exact tree: c616f5ba58d2587f00346b3bda6da380ce7c889a

## Delivered

- Selected published flyer audience vendor: View our vendor program →.
- Selected published flyer audience end_user: See your financing options →.
- Optional template override: {{flyer_link|Custom text}}. Accepted when templates are created/edited and during campaign approval.
- Override wins for either audience. Plain-text and HTML alternatives agree; custom HTML characters and URL parameters are escaped in HTML.
- Multiple overrides in one body work independently; blank override uses the audience default. No available link removes the marker rather than exposing it.
- Legacy unspecified audience uses the vendor default. Unchanged vendor approval hashes stay compatible. End-user audience is bound into the approval snapshot; existing end-user approvals require renewed approval because the outgoing copy changes.
- Migration recovery remains present and unchanged: 067/068 immutable, 069 recovery intact. No unrelated local changes included.

## Verification

Focused campaign and email-readiness tests: 39 passed, 0 failed. Full exact-candidate 11-gate preflight: PASS, exit 0. Recovery production-profile, model-sync, partial-profile and fresh-empty rehearsals all PASS and boot HTTP 200 / phase ready. Production-profile and model-sync each record zero query-boundary and PostgreSQL-observed schema DDL statements.

Clone provenance from the actual gate, excluding mock unit-test output:
DB clone source: schema-only

The production-profile is a fixture matching the verified production schema/ledger metadata, not live customer data. Schema-only fallback is not a fresh production-backed data clone. This does not grant publish approval.

## Evidence

- focused-tests.txt: complete focused test console output.
- preflight-transcript.txt: complete successful final-build transcript, credential-like values sanitized.
- preflight-tail.txt: final raw transcript lines.
- source-pin.json: frozen source SHA/tree and intended file manifest.
- migration-rehearsals.json: full before/after ledgers, fingerprints, DDL counts and boot results.

Not published. No managed production writes.
