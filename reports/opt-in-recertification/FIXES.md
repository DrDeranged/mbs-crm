# Fixes before publication

Source candidate: `b3975aea8761ce5cdb43ec3206fe995ee012883a`.
No publication was performed.

## Optional reply capture

The shared email sender no longer rejects a campaign send because reply capture
is disabled or unconfigured. Capture requires both a nonblank Parse secret and
the exact enable flag `true`. Otherwise, the configured campaign Reply-To is
retained. Normal consent, suppression, send-enable and cap checks remain intact.

The real-sender regression invokes `doSendEmail` under seven configurations:
absent secret/flag; absent secret with enabled flag; empty secret; whitespace
secret; valid fixture secret with absent flag; disabled flag; fully enabled.
All seven must send successfully. Only the last uses a tokenised address and
persists matching token provenance. Provider delivery and database writes are
mocked; no live email was sent.

See `sender-regression-evidence.json` and the full preflight transcript.
The read-only production configuration check found neither Parse setting
configured. This candidate was not deployed, so candidate sender tests are not
a claim that the old published sender has changed.

## Exact mobile approvals

The original certified inventory and the existing appearance/record-action
exemptions remain the references. User-approved differences are only:

- Lead Detail: Search referrer input and Share referral link button, once each
  for admin, manager and rep at 390/768: 12 additions.
- Rep Leads and Pipeline at 390/768: remove one exact enabled Retry button per
  case, formerly caused by the forbidden directory request: four removals.

The manifest and harness require these exact counts, compare all other
controls in order, and do not filter arbitrary Retry buttons.

## Correct role-gated directory queries

The old reproduced browser run showed rep requests to `/api/users` on Leads,
Lead Detail, Pipeline and Settings. API denial was correct; the UI requests
were defects. Query gating is now aligned with the relevant manager/admin
control permissions. Rep Leads/Pipeline no longer render the unrecoverable
directory-error Retry state. API permissions were not weakened.

The PWA hook also handles an absent registration object when an embedded/test
browser blocks service-worker registration. The final browser report must
verify that the candidate has no resulting registration console exceptions.

## Desktop row history

The immediate parent of `853f4e4` is
`1316888e5ead2f19986fa6fc1d6abe6755c43fe2`.
Its desktop TableRow tags had zero whole-row onClick handlers. Record
navigation used links inside cells; a cursor-pointer class was not a handler.
No whole-row navigation was restored. The final journey checks name/company
links, phone/email propagation, and blank-row background remaining on Leads.

See `row-history.json` for the historical source blob and SHA-256.

## Verification boundaries

The complete 11-gate preflight exited zero for this source. Its full suite
passed 724 tests, skipped one opt-in online hosting check, and failed none.
All 881 tracked runtime source files match the GitHub candidate; immutable
build hashes and the different local snapshot are recorded explicitly.

Interrupted browser attempts are not passes. Final-target screenshots,
structure comparisons, HTTP classifications and historical campaign checks
must be read from the final completed run, not prior-candidate diagnostics.

Migration rehearsal used the schema-only fallback, not a verified production
data export. `productionDataRehearsalCertified` is false. Passing this preflight
does not remove that release-certification limitation.
