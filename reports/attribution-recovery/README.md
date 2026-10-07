# Campaign attribution recovery certification

Certified product-source commit: 2f002b1419b7862ac51cf951b9ae0b110c4c5c77
GitHub base preserved: e2255dffba0fa8dffb96660ceed5c345755bc53b
Exact complete Git tree verified: 101275cfd0e6ef9ea2ba17baa25dbc7a3993abf7

## Status

- Recovery 069: fully guarded/idempotent; 067 and 068 remain byte-identical.
- Failed 067 is superseded by verified 069 recovery. 068 follows 069; on a complete managed schema it is catalog-verified and recorded without replaying no-op DDL.
- Production startup is metadata-only: incomplete or conflicting schema fails closed, without startup DDL.
- Migration lint: original 067 exemption pinned by SHA-256; new unguarded table/index/column/constraint operations rejected. Regression tests include misleading guards, fake IF strings, ELSE branches and SQL spacing.
- Full 11-gate preflight: PASS, exit 0, on the exact GitHub candidate checkout.
- No publishing; no writes to managed production. Development migration metadata was applied locally.
- Unrelated local lead-detail/deal-package changes are excluded. Desktop scrolling from GitHub main is preserved.

## Rehearsals

| Scenario | Ledger before | Ledger after | PostgreSQL-observed DDL statements | Boot |
|---|---|---|---:|---|
| production-profile | 067=failed | 067=superseded, 068=applied, 069=applied | 0 | 200 / ready |
| publish-model-sync | 067/068/069 absent | 067=superseded, 068=applied, 069=applied | 0 | 200 / ready |
| partial-profile | 067=failed | 067=superseded, 068=applied, 069=applied | 3 | 200 / ready |
| fresh-empty | 067/068/069 absent | 067=applied, 068=applied, 069=applied | 65 | 200 / ready |

The production-profile fixture reproduces the user-verified metadata state: migrations through 066, failed 067, all 067 objects present, canonical 068 FK names, 068 absent. It is a schema/ledger-state fixture, not a copy of customer production data. Model-sync simulation generates real Drizzle model-diff SQL before recovery. Fresh-empty runs 000 through latest. Partial-profile additionally proves repair, and raw 069 SQL is replayed twice with unchanged catalog. Catalog drift rejection is covered.

The first two cases execute zero schema DDL in both recovery and application boot, independently checked with PostgreSQL log_statement=ddl and unchanged catalog fingerprints. Ledger transitions are metadata writes, not schema DDL.

## Clone provenance emitted by the standard preflight

DB clone source: backup
DB clone source: backup
DB clone source: schema-only

## Evidence

- preflight-transcript.txt: full successful 11-gate console transcript, with credential-like values sanitized.
- preflight-tail.txt: exact final transcript lines.
- rehearsals.json: complete ledger before/after, fingerprints, DDL counts and HTTP boot results.
- rehearsal-summary.json: compact raw measurements.
- source-pin.json: exact candidate SHA/tree and intentional source manifest.

Historical SHA-256:
- 067: f2990978aa8e8a905a11dd746986b21e89a97d428474651a703d97559b2988ba
- 068: 061300fbfd0a7a899ca5141094b960b1507703247aa103264912e62ce688df66

Earlier attempts exposed and resolved a broad DO-token counter, the isolated simulator's schema-path allowance, an old expected migration-head list, Git snapshot metadata reconstruction, and PostgreSQL's deep-checkout Unix socket path limit. The transcript here is the subsequent complete passing run, not a concatenation of partial gate results.
