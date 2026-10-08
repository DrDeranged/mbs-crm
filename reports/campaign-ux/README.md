# Campaigns lifecycle certification

Certified application commit: `79dbc3e22750d28d9034115e9a7e8877279e194f`.
Baseline: GitHub main `5177557c4d807cb08b7a77200e5f1bbe0de196da`.
Application commit metadata and ancestry are preserved in the push.
The final main commit adds evidence and the browser reproduction script only.

## Delivered

- Admin-only archive/unarchive and confirmed draft deletion. Deletion is a
  tombstone, preserving audit and related records. Historical approval and any
  launch, including dry runs, prevent deletion.
- Archived campaigns hidden from lists and Compare by default; Show archived
  restores visibility. Results, send records, tracking and history remain.
- Single Content/Audience/Review/Launch stepper before launch. Launched campaigns
  default to Results and have only Results/Content/Audience tabs, with content
  and audience read-only.
- Existing recovery links replace creation; pending recovery is distinguished
  from actual sends. Cancelled results show not-sent, recovery-sent and exclusion
  counts/reasons instead of misleading queued totals.
- Compare labels include name, status and send/launch date or Not sent.

## Evidence

- `preflight-full.log`: complete passing 11-gate transcript, including production
  clone, migration rehearsal and final database divergence check.
- `browser/results.json`: 58/58 checks, no unexpected browser 403/404/503.
  Expected direct permission-denial and deleted-resource probes are labelled.
- `browser/campaigns-390.png`, `browser/campaigns-768.png`: responsive screenshots.
- `mobile-full.log`, `mobile/{before,after,comparison}.json`: 36/36 ordered control
  comparisons on the existing certified screens across admin/manager/rep and
  390/768 widths; zero new exceptions there. Campaign navigation and lifecycle
  controls are covered separately by the browser journey.
- `targeted-migration-rehearsal.log`: passing migration rehearsal, including all
  four attribution recovery scenarios and boot outcomes.
- `sql-regression.log`: actual SELECT compilation protects correlated approval,
  launch and send-date checks against Drizzle qualification rewriting.
- Earlier browser failures are retained separately for traceability; the final
  `results.json` is the passing result.
- `tests/campaign-ux-browser.mjs`: reproducible isolated browser journey.
- Six focused lifecycle-catalog checks passed: checksum pin, matching columns,
  missing columns, wrong type, wrong nullability and unexpected default.

## Migration and startup safety

070 contains only guarded additions of nullable archive/deletion timestamps.
067 and 068 were not edited. Managed startup still prohibits schema DDL.
Checksum-pinned, structurally verified prepared columns allow ledger-only 070
adoption. Missing/conflicting columns do not bypass that safeguard.

The historical production-profile fixture now explicitly logs the next-model
publishing stage before DDL-free recovery/boot checks; the independent
publish-model-sync fixture uses actual Drizzle model differences. PostgreSQL's
own DDL logging verifies zero startup DDL on prepared-schema cases.

Tests used disposable local databases and synthetic accounts, all cleaned up.
No production data was changed, no campaign was sent/resumed and no publishing
was performed.
