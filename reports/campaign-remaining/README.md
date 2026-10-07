# Cancelled/paused campaign recovery

## Scope

Admin-only **Send remaining recipients as a new campaign** is available on
cancelled/paused campaign detail and the campaign list menu. It creates a draft,
copies the template/content reference, flyer selection/mode, and configured
Reply-To, and requires the normal preview/approval/launch flow.

Membership is a server-owned fixed subset of the original live-launch queue.
Dry-run recipients, original sent recipients, failed/excluded recipients,
unsubscribed leads, suppressed addresses, and duplicate addresses are excluded.
Previous provider attempts are excluded conservatively, including ambiguous
delivery outcomes. Preview and launch recheck the source/delivery family and
current suppression. Root campaign locking and delivery-history checks prevent
an original/resumed campaign and recovery drafts from racing past duplicate checks.
The source campaign is unchanged; creating a draft does not create an approval,
launch, or delivery.

Running-campaign cancellation now requires confirmation naming the campaign and
its current queued count, including deferred recipients. Counts exclude dry runs.
Both detail and list entry points use the confirmation; dismissal does not cancel.

## Evidence and authority

- `preflight-full.log`: authoritative final 11-gate invocation against an isolated,
  dependency-restored GitHub-main snapshot plus this scoped feature.
- `remote-baseline.json`: exact remote parent, root tree, blob verification, and
  imported Git ancestry. Unrelated local lender-package contracts are excluded.
- `certified-source.json`: certified application source revision and per-file
  digests; final push verification binds GitHub blobs to those digests.
- `focused-tests.log`: raw focused safety assertions extracted from the final suite.
- `browser-results.md`: raw development fixture assertions and screenshot IDs.
- `preflight-tail.log`: unedited final transcript tail.
- `push-verification.json`: verified application commit/ref, changed-file scope,
  and blob verification after a non-force main update. Reports are attached by a
  direct evidence-only child commit; its final main hash is reported separately.

Earlier attempts are preserved honestly:

- `preflight-attempt-1.log`: stopped at the authorization inventory count; fixed.
- `preflight-attempt-2-interrupted.log`: intentionally interrupted to add dry-run
  exclusion and correct live queued counts; not certification evidence.
- `preflight-attempt-3-superseded.log`: passed but superseded by the dropdown
  callback-lifetime regression fix; not the final authoritative source.

The browser fixture's functional assertions passed before the additional dry-run
and dropdown-lifetime protections; those protections have dedicated final-source
regressions and are included in the final preflight. Browser checks are not
represented as an exact-byte run of an untouched final source snapshot.

The database clone gate reported `DB clone source: schema-only`. Attribution
rehearsal scenarios used isolated metadata-matched fixtures, explicitly not live
production data. Their raw ledger/catalog evidence and ready-state boot outcomes
remain in the complete transcript; this is not a claim of a fresh production-data
backup or live production certification.

## Browser isolation caveat

Normal authenticated startup initialized Twilio Voice in the development browser.
No campaign email/SMS delivery or launch was invoked, but this violated the stricter
no-provider-request harness constraint. Functional assertions are PASS; the
original harness-isolation verdict remains FAIL. All disposable database rows and
both Clerk-side test identities were cleaned up. See the complete browser report.

Production was not mutated, no production recovery campaign was created, no
campaign message was sent/resubmitted, and nothing was published.
