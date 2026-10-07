# Deals pipeline focused regression — 2026-10-07

> This records the first, incomplete browser pass. The compact-fit assertion
> conflicted with the later decision to preserve readable card widths at
> 1024px and scroll horizontally. See `final-verification.md` for the passing
> follow-up checks; do not use the verdict below as the final release verdict.

## Verdict: blocked by compact horizontal overflow at 1024×600

Ran the focused Playwright regression with `startSandbox({ build: true, port: 4372 })`.
All seeded deals and synthetic Clerk users were in the disposable database clone.
The first test stopped at the compact-fit assertion, so the full viewport/theme/
density matrix was not completed.

### Reproduction and observed geometry

- Sign in as synthetic admin, open `/deals`, set viewport to **1024×600**,
  Compact enabled, light theme.
- The 9 compact columns do not fit in the desktop board viewport:
  - Board viewport `clientWidth`: **968px**
  - Board `scrollWidth`: **1360px**
  - Inner grid width / scroll width: **1344px**
  - Each of the nine stage columns: **144px**
- The screenshot shows later stages outside the viewport (the rightmost stages
  are not simultaneously visible); compact mode therefore still overflows
  horizontally instead of fitting.
- Saved evidence: `compact-debug-1024x600.png`.

### Assertions completed before the failure

- All 24 unlinked Submitted synthetic business labels appeared in the board.
- The blank-name unlinked record rendered without a numbered deal label.
- No `Deal #<number>` label was found in the Submitted stage.
- Authorized linked fixture identity rendered the fixture company, contact,
  phone, and email.
- Build and test runner started successfully. No browser page error or HTTP
  error was reported before the assertion; Playwright output included only
  Clerk's development telemetry notice.

### Other observed partial checks

- In an earlier run of the same disposable-clone test suite, a synthetic drag
  from Submitted to Approved updated the deal via the API and remained in
  Approved after reload. Evidence: `deal-drag-drop-persisted.png`.
- At 390px and 768px, a separate run found the desktop-only board absent and
  the existing mobile/tablet Kanban horizontally scrollable.
- The table view rendered in that earlier run, but table overflow geometry was
  not verified.

Manager/rep identity authorization, rep `/api/users` request absence, private
linked-field absence, email composer/dialer behavior, all remaining desktop
viewport/theme/density combinations, and keyboard End behavior remain
unverified in this focused pass.

### Cleanup and source scope

`cleanup.json` confirms **3 synthetic Clerk users deleted**, disposable database
dropped, and temporary sandbox directory removed. The inspected product diff
contained no mobile control additions; the relevant UI/CSS hunks were confined
to the desktop pipeline and shared deal-list loading. No product code was
changed by this testing run.

Reusable regression files added for review:

- `tests/deals-pipeline-fix.spec.ts`
- `playwright.deals-pipeline-fix.config.ts`
