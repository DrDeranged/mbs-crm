# Desktop workspace release proof

**Verdict: PASS; not published.**

- Strict mobile comparisons: **36/36**, no new exceptions; retained certified revision 2af927ca2830926bf325cef2eecfffc24ab5c110.
- Screenshots: **50 target + 20 matched mobile baseline** at 390/768/1024/1280/1440, Light and Dark.
- Requested browser scenarios: **14/14 latest results passed**, with original failures and focused corrections retained.
- Mobile iOS and Android manifests and compiled API literals: **https://app.my-business-solutions.com**; obsolete host absent. SHA-256 evidence: mobile-build-proof.json.
- Actual production lazy chunk aborted: **one reload recovers**, repeat same-build failure adds **zero reloads**; new-build/non-chunk policy unit-tested.
- Full **11-gate preflight PASS**, actual exit **0**. Complete authoritative transcript: preflight.txt.

## Scope and limits
- Real development Clerk session obtained by ticket; no password/SSO certification
- Idle softphone UI and desktop/mobile OS handoff without a registered device; available-device action policy unit-tested. No carrier call or native dialer invoked.
- Disposable schema-only browser fixture clones, synthetic records, provider credentials stripped, local storage bytes verified; external delivery blocked
- No publishing, live deployment configuration changes or production writes
- No application schema changes or migrations added/applied; existing preflight rehearsal uses disposable clones

## Browser evidence
- **PASS** desktop: authorized palette covers company/contact/email/phone, deals, lenders, brokers and pages — reports/desktop-workspace-release/journeys/pre-rail-fix/rail-palette-diagnostic.log
- **PASS** desktop: equal readable columns and independent lead activity at exact breakpoints — reports/desktop-workspace-release/journeys/pre-third-focused/final-focused.log
- **PASS** desktop: funded deal action-bar upload persists metadata and exact bytes — reports/desktop-workspace-release/journeys/pre-final-focused/focused-continuation.log
- **PASS** desktop: phone handoff on mobile and desktop without a registered softphone — reports/desktop-workspace-release/journeys/pre-final-focused/initial-browser-pass.log
- **PASS** desktop: rail hover delays, no reflow, pin persistence, keyboard and account isolation — reports/desktop-workspace-release/journeys/final-rail.log
- **PASS** journey: admin sign-in, per-account theme/system/reduced motion and sign-out isolation — reports/desktop-workspace-release/journeys/pre-final-focused/initial-browser-pass.log
- **PASS** journey: create campaign, preview and approve via UI/API/DB without launching — reports/desktop-workspace-release/journeys/pre-final-focused/focused-continuation.log
- **PASS** journey: create lead in UI and Run Match with DB-backed results — reports/desktop-workspace-release/journeys/pre-final-focused/initial-browser-pass.log
- **PASS** journey: existing call-forwarding profile saves through UI and persists — reports/desktop-workspace-release/journeys/pre-final-focused/initial-browser-pass.log
- **PASS** journey: Log partner submission persists an actual manual submission — reports/desktop-workspace-release/journeys/pre-third-focused/final-focused.log
- **PASS** journey: mobile dialog close target and rich editor keyboard focus — reports/desktop-workspace-release/journeys/pre-final-focused/initial-browser-pass.log
- **PASS** journey: normal lead-document multipart upload persists DB metadata and local provider bytes — reports/desktop-workspace-release/journeys/pre-final-focused/initial-browser-pass.log
- **PASS** journey: public application submit persists application, lead and typed signature — reports/desktop-workspace-release/journeys/pre-third-focused/final-focused.log
- **PASS** journey: softphone opens idle without a dial or call request — reports/desktop-workspace-release/journeys/pre-final-focused/initial-browser-pass.log

## Actual final preflight tail

```text
[2K[1G[⡿] Pulling schema from database...
[2K[1G[⢿] Pulling schema from database...
[2K[1G[⣻] Pulling schema from database...
[2K[1G[⣽] Pulling schema from database...
[2K[1G[⣷] Pulling schema from database...
[2K[1G[⣯] Pulling schema from database...
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

PREFLIGHT_EXIT_CODE=0
```

## Reproduce

- Build API/web from these source files with production NODE_ENV and BASE_PATH=/.
- Run pnpm exec playwright test --config playwright.desktop-workspace.config.ts --grep 'journey:|desktop:' using development Clerk and disposable fixtures. Never enable live delivery.
- Run node scripts/desktop-workspace/capture.mjs; retained baseline directory is .local/certification-2af927c/baselines/target-2af927c. --baseline-only / --target-only reuse the opposite evidence phase.
- Run node scripts/desktop-workspace/chunk-proof.mjs.
- For a fresh iOS/Android export, use a free METRO_PORT and EXPO_PUBLIC_DOMAIN=app.my-business-solutions.com, run the mobile build, then node scripts/desktop-workspace/mobile-proof.mjs.
- Run pnpm preflight, retain its full transcript and actual exit status, then node scripts/desktop-workspace/report.mjs.

GitHub push receipt is generated after the commit and verified separately to avoid a self-referential commit hash. Source and evidence blob hashes are checked against the returned remote tree.
