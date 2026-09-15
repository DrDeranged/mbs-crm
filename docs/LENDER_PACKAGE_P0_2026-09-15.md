# Lender-package P0: native PDF and document categories

## Scope and release decision

**SHIP — code changes verified; not deployed.** Migration 019 must be reviewed and
applied before a future production publish of the category-dependent API.
Neither development nor production data/schema was changed during this cycle.
No dependencies were added. The model string, consent source, and lender rules
were not changed.

## A. Native rendering

- Lender-package cover, Finance Application, and omission report use pdf-lib.
- Authenticated and public rep application-form endpoints share the native
  application renderer. No production application-form or lender-package
  rendering path imports Puppeteer or the flyer HTML-to-PDF renderer.
- Helvetica/Helvetica-Bold, navy section bars, green title rule, and field cells.
- Consent is imported directly from consentText.ts; extracted PDF text includes
  the entire original paragraph and footer.
- SSNs are masked. Stored typed/PNG signatures use stored signing metadata,
  without synthesizing missing historical evidence.
- Blank applications retain a signature/date block.
- Every final merged page has the prepared-by footer with final page totals.
- A synthetic signed application was rendered and visually inspected as a
  single Letter page; no production applicant data was used.

## B. Categories

- Category required for rep uploads; editable suggestion is bank_statement for
  filenames containing bank/statement, otherwise other.
- Applicant statement uploads and signed HTML records explicitly set categories.
- Documents display category chips with an inline selector and persisted update.
- PATCH ownership guards preserve cross-lead rep denial.
- Migration 019 adds a default/check constraint and historical-key backfill.
  Re-running the migration does not overwrite subsequent user categorizations.
- Package order: cover, native application, invoice/quote, bank statements,
  driver's license, tax returns. Selection never relies on filename/key tags.
- Unreadable selected documents are listed in paginated final omission pages.

## C. Errors and diagnostics

- Package failures log message, stack, and causal error server-side.
- JSON failures include a safe reason: renderer_unavailable, no_application,
  merge_failed:<filename>, or package_failed for unexpected failures.
- Only admin toast titles display mapped safe reasons; other roles see generic
  text. Unknown/raw error text is not reflected into toast titles.
- Deep health exposes nativeRenderer and a separate Puppeteer launch probe.
  Launch has a five-second timeout and ten-minute result cache, including
  failures. Concurrent probes share one launch, and late browsers are closed.
- The native package never depends on this browser-health diagnostic.

## D. Verification

Release snapshot created from the Git index, excluding unfinished auth-audit
files. The snapshot used installed workspace dependencies; nothing was installed.
The existing lender-test-only union narrowing is included so typechecking does
not fail on an unrelated union access; seed values and matcher rules are untouched.

Commands and tails:

```text
pnpm --filter @workspace/api-server test
tests 112
pass 112
fail 0
skipped 0

node --test --experimental-strip-types --loader ./test-loader.mjs src/routes/applicationForm.test.ts
tests 5
pass 5
fail 0

pnpm --filter @workspace/mbs-crm test
tests 30
pass 30
fail 0

pnpm typecheck
api-server: Done
mbs-crm: Done
mbs-crm-mobile: Done
mockup-sandbox: Done
scripts: Done
Exit code: 0
```

Specific regressions:
- Three rep-uploaded statements without bankstatement key tags, plus a two-page
  invoice, produce seven pages in the required order.
- Native output starts with `%PDF-` while Puppeteer launch is mocked to throw.
- Authenticated/public application forms render with that same browser failure.
- Forty omitted documents paginate rather than fail the entire package.
- Consent/footer text preservation, SSN masking, and final page totals.
- Historical category mapping and category-update ownership.
- Cross-lead rep package access remains 403.
- Safe error responses, admin-only toast reasons, and health probe cache/timeout.

## Limits / preserved workspace state

- Migration SQL was inspected and its mapping checked by tests, but not executed
  against a database under the code-only constraint.
- No production package, upload, inline edit, or health probe was invoked.
- Authenticated UI interactions were not browser-tested against live data.
- The broader dirty-workspace API suite still has two failures in the unrelated,
  uncommitted authMatrix tests due to unsupported enum imports. Those tests and
  auth-audit edits are not included in this release snapshot or these commits.