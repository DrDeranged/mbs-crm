# Lender-package access certification

## Source and result

- GitHub main parent: `acff3c8b77e3216880e14cdab07f7df0dfa0a729`.
- Final certified source: `0d2b6ff0a7c44b2058bd11263d8cf847e68472c1`.
- Certified source tree: `e819adc74457e4ab877a0a4fd448b42732745ac7`.
- Final command: `pnpm run preflight`, from a complete, isolated GitHub-main checkout with its own frozen-lockfile dependency installation.
- Result: **PREFLIGHT PASS**, all 11 gates. See the complete `preflight.log` and the verbatim `preflight-tail.log`.
- No migrations or database-model changes; `migration-changes.txt` is intentionally empty.
- No publishing, production mutations, actual lender deliveries or external-provider sends.

The production-clone gate used a **schema-only development-derived clone**, not a live production-data snapshot. The recovery rehearsals use isolated metadata-matched fixtures; the raw log identifies their provenance. This is not a certification of live production records.

## Permission change

Active reps, managers and admins can generate, preview and send lender packages for any lead or linked deal, including unassigned and other-owned leads/deals. Pending and inactive users are blocked. Package-only context, selections and lender refresh endpoints support this without relaxing ordinary lead/deal/document access.

Existing PII audit calls remain in place for generation and send, retaining actor, time, lead and `ssnUnmasked: true`, without recording an SSN value. Private immutable PDFs, integrity verification, shared lead/lender send locking, duplicate protection and ambiguous-delivery retry barriers remain in place.

Ordinary document upload/recategorization, contact actions, lead/deal visibility, submission-status changes and approval-attachment access retain their existing permissions.

The required deal-package builder and its action-bar/API dependencies were already present in the workspace but absent from GitHub main. This feature-only push includes them; unrelated workspace history was not merged. `changed-files.txt` lists the 20 source files changed against the verified main parent.

## Tests

`focused-tests.log`: **55 tests passed, 0 failures**. Coverage includes:

- Rep generation and send for an unassigned lead.
- Rep generation and send for a lead assigned to another rep.
- Package generation/send through another-owned linked deal.
- Manager/admin access to unassigned and other-owned leads.
- Pending/inactive rejection before package database work or sends.
- Package-selection access across assignments.
- Actor/lead/SSN-unmask audit context with no SSN value.
- Existing duplicate, locking, immutable-packet and delivery-state safeguards.
- Ordinary lead redaction/document restrictions alongside package-only deal eligibility.

The final full suite additionally passed on the certified source; the API suite reports 502 tests, 501 passed, 1 skipped, 0 failed. The focused runtime log covers the tree incorporated into `3884d25532c7570bb7d42a82b3e64e54d7f053aa`; the final commits only make the generated default query key explicit and type the regression fixture, both checked by final preflight.

## Signed-in browser evidence

`browser-results.json` / `browser-check.log` and the two `*builder.png` screenshots record the successful focused pass on `3884d25532c7570bb7d42a82b3e64e54d7f053aa`, before those final query-key/fixture-type corrections.

- Rep deal linked to an unassigned lead: builder opens, real context/config requests return 200.
- Rep deal linked to a manager-owned lead: builder opens at 390px; real context/config requests return 200.
- Preview, Download and Send controls render; Send was disabled without a fixture lender and was not clicked.
- Rep Upload/Note/Task remain disabled; package document management remains disallowed.
- Deliberate ordinary `/api/leads/3/documents` and `/api/leads/4/documents` probes return expected 403.
- Manager/admin builders retain Add document/file-upload controls.
- No provider operation or file upload was triggered.
- All three disposable Clerk users, the disposable database and temporary fixture directory were cleaned up.

The first browser pass found a real redacted-linked-lead-ID issue. The corrected deal response exposes only a package capability boolean while retaining ordinary lead redaction; clicking the enabled action obtains the linked lead through the separately authorized package context.

Limit: the browser fixture had no documents, so document-row recategorization could not be exercised. Real PDF generation/send behavior is covered by handler tests with isolated storage/provider doubles, not a live SendGrid delivery.

Evidence was checked for credential, session, connection-string and SSN-value patterns before staging. Reports contain synthetic fixture data only.
