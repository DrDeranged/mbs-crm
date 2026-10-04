# GitHub 6f7c861 Certification

**Verdict: NOT CERTIFIED**

Certified source: `6f7c8611ed4087a14e62ff99a0f5dbb5f3b33835`, including parent `a149ae9308e626cda886934b5f5520b0b54d7252`. The source proof verifies 963 committed source files. All tests used the frozen production frontend and an isolated synthetic Clerk/database fixture. No application source changes, live communications or publishing.

## Results
- Full authoritative preflight: PASS; 11/11 gates reached; exit 0.
- Strict mobile control inventory: 30/36 against retained certified baseline `2af927ca2830926bf325cef2eecfffc24ab5c110`, including existing exemptions and archival inventories; no new exemptions.
- Header theme toggle below 1024px: absent (PASS); DOM checked at 390, 768 and 1023px for all three roles, including hidden controls.
- Tables: all eight requested captures contain rendered tables and synthetic rows.
- Theme: 10/10 assertions passed. A fresh account with OS Dark defaults to Light. Header toggle and mobile Settings stay in sync; both Light and Dark persist after reload. Desktop Settings deliberately has no duplicate appearance selector. Preferences are browser-local and account-scoped, not cross-device.

## Certification blocker
The strict archived inventory remains 30/36, not 36/36. Six Leads cases (390/768px for admin, manager and rep) differ only in two API-calculated idle labels: actual `19d idle` versus certified `18d idle`. All 36 target-versus-fresh-retained-baseline comparisons match, including exemptions. The focused recheck fixed the browser clock to the certified date, which corrected browser-relative labels but could not change the API's current-date idle calculation. No label normalization or new exemptions were introduced. This is a fixture clock limitation, but it remains a failed strict requirement and prevents an unqualified certification.

## Table scroll measurements
| Page | Width | Sidebar | Table horizontal scroll | Whole-page horizontal scroll |
|---|---:|---|---|---|
| leads | 1280 | collapsed | Yes | No |
| leads | 1280 | pinned | Yes | No |
| leads | 1366 | collapsed | Yes | No |
| leads | 1366 | pinned | Yes | No |
| deals | 1280 | collapsed | Yes | No |
| deals | 1280 | pinned | Yes | No |
| deals | 1366 | collapsed | Yes | No |
| deals | 1366 | pinned | Yes | No |

## Authoritative preflight tail
```text
[2K[1G[⣯] Pulling schema from database...
[2K[1G[⣟] Pulling schema from database...
[2K[1G[⡿] Pulling schema from database...
[2K[1G[✓] Pulling schema from database...
Schema parity OK: SQL runner and complete Drizzle schema set match
EMPTY-SCHEMA users.role default: pending
EMPTY-SCHEMA 000-TO-LATEST REHEARSAL PASS
[⣷] Pulling schema from database...
[2K[1G[⣯] Pulling schema from database...
[2K[1G[⣟] Pulling schema from database...
[2K[1G[⡿] Pulling schema from database...
[2K[1G[⢿] Pulling schema from database...
[2K[1G[⣻] Pulling schema from database...
[2K[1G[⣽] Pulling schema from database...
[2K[1G[⣷] Pulling schema from database...
[2K[1G[⣯] Pulling schema from database...
[2K[1G[⣟] Pulling schema from database...
[2K[1G[⡿] Pulling schema from database...
[2K[1G[⢿] Pulling schema from database...
[2K[1G[⣻] Pulling schema from database...
[2K[1G[⣽] Pulling schema from database...
[2K[1G[⣷] Pulling schema from database...
[2K[1G[⣯] Pulling schema from database...
[2K[1G[⣟] Pulling schema from database...
[2K[1G[⡿] Pulling schema from database...
[2K[1G[✓] Pulling schema from database...
Schema parity OK: SQL runner and complete Drizzle schema set match
POPULATED-SCHEMA initial no-ledger reconciliation: applied=61, ledger=66|1, baseline SQL skipped
POPULATED-SCHEMA retry: applied=0, adopted=000_baseline (a07aee3fbf5a174ff94c05859a401cac808b0c89435fd834e4bae09e75117902), constraints/indexes unchanged (60/710|228|184)
MIGRATION REHEARSAL PASS
PREFLIGHT 11/11: database divergence

> workspace@0.0.0 db:divergence /home/runner/workspace
> pnpm --silent --dir scripts exec tsx ./src/db-divergence.ts

Clone-only ledger rows: none
Dev-only ledger rows: none
Changed ledger rows: none
Clone-only tables: none
Dev-only tables: none
Clone-only columns: none
Dev-only columns: none
Changed columns: none
DB DIVERGENCE PASS
PREFLIGHT PASS
```

## Evidence and reproducibility
- Full transcript: [preflight.txt](preflight.txt); eleven-stage result: [preflight-result.json](preflight-result.json).
- [Source proof](source-proof.json), [mobile comparisons](mobile-comparisons.json), [table geometry](table-geometry.json), [theme assertions](theme-assertions.json), [browser verdict](browser-verdict.md).
- [Screenshots](screenshots/); [self-contained visual report](certification.html).
- [Browser reproduction](reproduce-browser.mjs). Retained baseline and target bundles are stored in ignored workspace certification directories. Match the fixture clock documented in the comparison proof; do not silently normalize date labels or broaden exemptions.
- Original harness failures are retained in initial-preflight and initial-browser-pass. The first preflight incorrectly inherited production NODE_ENV; the normal preflight invocation is recorded in the final result. Initial Deals captures were board view and replaced with actual Table view. Date-sensitive Leads inventories were rechecked with the certified clock; previously valid comparisons and theme evidence were retained.
- Credential-shaped values and connection strings are redacted from transcripts. No traces, HARs, cookies, tickets or live CRM data are attached.
