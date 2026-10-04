# GitHub main 6f7c861 browser certification — corrected evidence

Commit proof: 6f7c8611ed4087a14e62ff99a0f5dbb5f3b33835; 963 committed files matched; published: false. Target: .local/certification-6f7c861/target. Frozen baseline: .local/certification-2af927c/baselines/target-2af927c.

- **Strict mobile comparisons: FAIL — 30/36 exact.** Final mobile-comparisons.json preserves the original 30 measured comparison objects unchanged and replaces only six Leads keys from target and retained-baseline captures at 2026-10-03T18:00:00.000Z. Clock was set after login and observed at that exact time. Target and baseline match on all six; certified inventory still differs at two idle-label positions per key (target “19d idle”, certified “18d idle”). No normalization or exemptions were added. Exact diffs are recorded in mobile-comparisons.json; fixed-clock evidence is in mobile-clock-recheck.json.

- **Deals geometry corrected:** each of four captures explicitly selects the UI Table button and asserts visible table.deals-data-table, two body rows and synthetic fixture text before measuring. At 1280 and 1366, collapsed and pinned: horizontal scrolling yes, contained within table; whole page no horizontal overflow. Original valid Leads captures and geometry are retained. Corrected screenshots: screenshots/deals-1280-collapsed-table.png, screenshots/deals-1280-pinned-table.png, screenshots/deals-1366-collapsed-table.png, screenshots/deals-1366-pinned-table.png.

- Theme evidence and assertions were not rerun or modified; prior result remains in theme-assertions.json.
- Focused recapture: 0 missing baseline assets and 0 page render errors.
- Concurrent full preflight is external to this browser correction. It was not rerun or independently reclassified; see the main-agent preflight artifacts.

Original browser evidence is preserved under initial-browser-pass/. An intermediate correction-harness iteration accidentally recaptured all mobile routes; those extra captures are not used in final comparisons and are archived under correction-diagnostics/. The final JSON uses exactly six corrected Leads keys plus the untouched original 30 comparisons. No application source, workflows, packages, real CRM data, publish or push were changed.