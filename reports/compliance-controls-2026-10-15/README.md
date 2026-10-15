# Compliance controls certification

## Scope

- Manager/admin single-lead Consent controls and selected-lead bulk opt-out:
  setting and clearing require a nonblank reason (maximum 2,000 characters).
  The existing unsubscribe flag is reused. Each lead receives an actor/time/
  reason audit entry in the same transaction as the flag update; a failed audit
  rolls back the change. Opting out also stops active drip work and queued email
  rows for those leads. Clearing does not restart them or override another
  opted-out record with the same normalized address.
- Campaign audience rules now persist `excludedLeadIds` in existing JSON.
  Manual exclusions take precedence over filters and picks, invalidate content/
  audience approval through the existing version/hash mechanism, and appear in
  Calculate as **Excluded manually**.
- `/tasks` lists open tasks with lead, owner and date, with all/overdue/today/
  upcoming filters. Date-only deadlines are classified using America/New_York
  and displayed without conversion to browser-local midnight. Manager/admin
  dashboard and task-list views are team-wide; rep views retain assigned-lead
  restrictions. Tasks without a due date remain in All open.
- KPI Sent, Results Sent and per-launch History Sent share the accepted-live-send
  reconciler. It deduplicates accepted email records against recipient records
  and includes the provider-acceptance/recipient-reconciliation interval.
  Test/dry-run traffic is not counted. Later bounces/unsubscribes do not undo a
  successful acceptance. Campaign detail uses the Results response for KPI Sent
  as well, avoiding cross-request timing differences. Running/paused data polls.

## Root causes

The previous manager dashboard selected tasks owned by the viewer only; the
admin dashboard selected only viewer-owned or unassigned tasks. There was no
USFA-source exclusion, but that ownership scope omitted otherwise open, overdue
tasks owned by other users. Both the dashboard and Tasks page now use one
visibility/date policy. This is a code/fixture finding, not a claim that an
unpublished change has altered production's reported 19 or 22.

Sent previously came from three paths: KPI reconciled accepted email/recipient
records, Results counted sent recipient rows, and Launch History displayed the
cached launch counter. They could disagree while delivery was in progress.

## Frozen source and provenance

- GitHub parent: `6dacbbfea0806f416646f5dcd09b79f970684733`
- Source commit: `6c9035941dda1ed94ecea792d2887274d6e7acd2`
- Preflight: isolated exact-parent checkout `/tmp/cc-cert`, with its own
  frozen-lockfile dependency installation.
- Protected browser runner: separate exact-source checkout `/tmp/cc-browser`,
  with its own dependencies/builds. This avoids concurrent build/cache mutation
  and two unrelated live-workspace layout differences.
- The authorization document was updated from GitHub's version, preserving its
  existing route inventory instead of overwriting it with local-only prose.
- No new migration or schema/model change is needed. Existing fields, JSON and
  audit records provide persistence.
- No publishing, production writes, actual campaign launches, or real email/SMS/
  call/credit-provider actions are authorized by this certification.

## Evidence

The complete authoritative preflight transcript is `preflight.log`; its tail is
`preflight-tail.log`. The browser runner, sanitized assertion report and protected
screenshots are retained alongside it. Expected forbidden permission probes are
distinguished from normal UI requests. Disposable fixture cleanup is reported.

Only the ordered outer `PREFLIGHT n/11` command invocations and final outer verdict
are authoritative. Unit tests of the harness also emit simulated gate markers.
Read the actual clone gate's provenance rather than interpreting simulated
production-clone test output as a live production-data snapshot.

## Results and limitations

- Full 11-gate preflight: **PASS**, exit 0, on source commit above.
- Full suites: **827 passed, 1 skipped, 0 failed** (API 518/519 with one
  skip; web 189/189; scripts 73/73; database 47/47).
- The real clone gate reported **schema-only**, 31 public base tables, 320
  columns, zero starting ledger rows. It was not a live production-data clone.
  Migration recovery rehearsals passed four isolated metadata-matched scenarios,
  including fresh-empty boot; divergence was empty.
- Focused authenticated fixture API check (`--api-only`): **7/7 PASS**, exit 0.
  It exercises the actual PATCH/Calculate endpoints for adding/removing a manual
  exclusion and the actual bulk/set/clear consent endpoints, verifying durable
  state, unrelated-lead isolation, reason/actor/timestamp audit, and Calculate's
  subsequent unsubscribe exclusion. See `api-verification.json` and
  `api-verification.log`.
- Supplemental browser journey: **partial, not an all-green browser certificate**.
  `assertions.json` retains 12 passing assertions and two failed harness steps,
  plus the raw earlier attempts. Passing checks include reason validation,
  persisted/audited manager consent, actual picked-only unsubscribe suppression,
  all four Tasks filters, team dashboard/Tasks agreement, and three-way Sent API
  values of 13 during execution, after completion, and before recipient
  reconciliation.
- The rep helper incorrectly waited for the manager-only Consent card to exist;
  the Sent UI helper incorrectly treated a non-semantic CardTitle as a heading.
  Both timed out before their intended assertions. Neither establishes an app
  defect or a passing UI check. The initial duplicate Calculate selector was
  corrected; a later disabled-button timeout was not reproduced by the narrow
  Review diagnostic: form/default/server values matched and Calculate was
  enabled before and after re-consent/reload. It remains a recorded failed
  browser attempt, not a silently discarded pass.
- Manual-exclusion and bulk mutations were confirmed through authenticated APIs,
  not claimed as end-to-end UI passes. The KPI/Results/History **API** equality is
  confirmed; their three visible UI numbers were not fully certified by this
  browser harness. Protected Consent and Tasks screenshots were visually checked,
  including the Tasks page at 390px.
- Captured 403/404/503 responses: none in these completed fixture requests.
  The rep UI timeout occurred before its planned forbidden API probes, so no
  all-role console-clean claim is made. Role denial and pending-user denial are
  covered by the automated application tests.
- Every attempt's cleanup reports three disposable Clerk users deleted and the
  isolated database/temp directory removed. No provider actions were invoked.
