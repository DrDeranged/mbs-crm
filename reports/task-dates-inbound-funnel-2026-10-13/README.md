# Task dates, inbound badge and funnel fixes

No migration was added or edited. Nothing was published.

## Task dates

Company calendar: America/New_York. Date-only deadlines stay date-only.
Today uses the company's local date; overdue uses **due_date < today**, not
`<= today`. Completed tasks are excluded. The rep dashboard, task reminders
and automatically created intake task deadlines now use the same calendar.
Lead Detail formats date-only deadlines without converting UTC midnight into
the previous browser-local day.

Previously the general task dashboard used a UTC date and included today's
tasks in overdue. The rep dashboard mixed server-local midnight with a UTC date.

`focused-tests.log`: 17 passing tests, including the real task handler for
admin/manager/rep at 7 PM and 11 PM ET, summer/winter, local midnight, 23-hour
and 25-hour DST days, incomplete/completed tasks, call classification and
compiled correlated pipeline queries.

## Inbound badge

Previously: admin-only count of **unassigned website/QR-card leads more than
24 hours old**. It did not count calls. That existing intake predicate and
admin-only access remain unchanged.

Now: intake count plus distinct inbound calls created during today's
America/New_York calendar day, including answered, missed, voicemail and
in-progress/other calls. Provider-call lifecycle duplicates are counted once.
The UI separately labels leads needing assignment and calls today; answered
calls are not mislabelled as unassigned leads. Outbound calls, yesterday's
calls and tomorrow's calls are excluded.

Synthetic HTTP results: **2 intake leads + 4 distinct calls = Inbound 6**.
Call breakdown: **1 answered, 1 missed, 1 voicemail, 1 in progress**.
The existing Calls Today panel agrees. Rep call metrics remain lead-scoped.

## Dashboard funnel

Previously: counts grouped only by the lead's **current status**:
Contacted = `contacted`; Submitted = `submitted_to_underwriting`. Neither
Contacted history nor actual lender submission records were consulted.

Now:
- Contacted: current `contacted` OR recorded transition to `contacted`.
- Submitted: current `submitted_to_underwriting` OR at least one row in
  `lender_submissions`, including manually logged submissions.
- Each lead counts once even if several history or submission rows exist.
- Queued/failed delivery attempts alone do not count as submissions.
- Existing lead-creation date cohort and assigned-rep filters remain.
- Other stages retain their existing current-status semantics. This is not
  a redesign into a cumulative conversion funnel.

Synthetic HTTP results for both admin and manager:
**Contacted 3, Submitted 3**; with `rep_id=3`: **Contacted 2, Submitted 2**.
An old-cohort lead and a different rep's lead are correctly excluded from the
filtered counts. These are fixture results, not claims about production counts.

## SSN/package review — report only

No package-generation or SSN-security source was changed by this task.

- `GET /leads/:id/application` removes encrypted SSN fields from its response,
  returning `ownerSsnMasked` / `secondaryOwnerSsnMasked` using last-four masking.
  A decryption failure returns fully masked text. Lead Detail's Application
  tab displays the masked owner SSN, not plaintext.
- **No full-SSN reveal control/endpoint was found on the CRM Lead Detail page.**
  An audited CRM reveal therefore cannot be confirmed as an existing feature.
- The separate short-lived, bearer-token USFA applicant-prefill route can
  return full SSN. It awaits its SSN access audit before returning the data.
  This is not a Lead Detail reveal control.
- Package handlers authenticate through `requireUser`, which rejects
  anonymous, inactive and pending users. Today's approved staff roles are
  rep/manager/admin; rep ownership checks apply. They rely on this shared
  authentication boundary rather than a separate explicit three-role
  allowlist in every package handler.
- SSN-bearing package exports invoke PII audit logging with `ssnUnmasked:true`
  and without recording the SSN value. Selected-package generation also
  awaits its activity entry.
- **The package PII logger is best-effort:** `logPiiAccess` starts an asynchronous
  insert and catches failures. Invocation is confirmed, but a durable audit
  before PDF response is **not guaranteed**. This was reported, not changed.

## Verification and evidence

- `preflight.log`: complete authoritative 11-gate preflight transcript,
  including production clone and migration/boot rehearsals.
- `preflight-tail.log`: raw final tail.
- `fixture-results.json`: raw HTTP results from a disposable, schema-only
  development clone with synthetic admin/manager/rep users.
- `fixture-check.log`: assertions and cleanup result.
- `dashboard-admin.png`, `dashboard-mobile.png`: authenticated synthetic UI.
- Fixture external delivery was blocked; no production data was changed and
  no real email/call was sent.
- All three dashboard roles had **zero 403/404/503 requests** in this fixture.
- Temporary Clerk users and fixture database were deleted.

GitHub upload preserves existing unrelated main files, including package
sources. The three API contract files have pre-existing local-only package
differences; only this task's inbound response delta is merged into main's
versions. The upload verifies the complete resulting tree and uses a normal,
non-force ref update. See `github-push.json` for the verified source commit hash
and file list. A subsequent evidence-only commit records that verification.
