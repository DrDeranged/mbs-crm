# Lead detail refactor audit

## Scope and baseline

- Baseline commit: `2bdccc9916d08401544abbc3153c208bac4e8ee8`
- Baseline source: `artifacts/mbs-crm/src/pages/lead-detail.tsx`
- Refactor type: source-only extraction. No endpoint, mutation payload, permission rule,
  route, user-visible label, or production dependency was added.
- `LeadDetailProvider` is the one page context. It owns only the original page
  route id, lead query result/loading state, and status mutation/dialog state.
  Assignment and Consent retain their own `useGetMe` calls, and Convert retains
  its own `useLocation` subscription. Panels continue to own their own query,
  mutation, and tab-local state; no panel fetch was lifted into the provider.

## Exact line counts

Counts were taken with `git show <baseline>:<file> | wc -l` for the baseline and
`wc -l <file>` after extraction. The baseline had one source file; all files below
are the post-refactor files.

| File | Before | After |
| --- | ---: | ---: |
| `artifacts/mbs-crm/src/pages/lead-detail.tsx` | 2957 | 103 |
| `artifacts/mbs-crm/src/pages/lead-detail/context.tsx` | — | 107 |
| `artifacts/mbs-crm/src/pages/lead-detail/header.tsx` | — | 225 |
| `artifacts/mbs-crm/src/pages/lead-detail/edit-dialog.tsx` | — | 107 |
| `artifacts/mbs-crm/src/pages/lead-detail/info.tsx` | — | 253 |
| `artifacts/mbs-crm/src/pages/lead-detail/notes.tsx` | — | 68 |
| `artifacts/mbs-crm/src/pages/lead-detail/tasks.tsx` | — | 108 |
| `artifacts/mbs-crm/src/pages/lead-detail/documents.tsx` | — | 178 |
| `artifacts/mbs-crm/src/pages/lead-detail/activity.tsx` | — | 38 |
| `artifacts/mbs-crm/src/pages/lead-detail/communications.tsx` | — | 530 |
| `artifacts/mbs-crm/src/pages/lead-detail/matching.tsx` | — | 259 |
| `artifacts/mbs-crm/src/pages/lead-detail/marketing.tsx` | — | 241 |
| `artifacts/mbs-crm/src/pages/lead-detail/application.tsx` | — | 193 |
| `artifacts/mbs-crm/src/pages/lead-detail/credit.tsx` | — | 294 |
| `artifacts/mbs-crm/src/pages/lead-detail/financials.tsx` | — | 156 |
| `artifacts/mbs-crm/src/pages/lead-detail/consent.tsx` | — | 200 |
| `artifacts/mbs-crm/src/pages/lead-detail/deals.tsx` | — | 118 |

## Exhaustive UI inventory and mapping

The old line ranges below refer to the baseline file at the baseline commit. A
range includes the named function's local controls and its loading, empty, and
error branches.

| Old range/function | New component/file | UI and behavior inventory |
| --- | --- | --- |
| 55–73 `formatStatus`, `apiBase`, `ScoreBar` | `ScoreBar` in `info.tsx`; module `apiBase` in `documents.tsx`; `formatStatus` in `consent.tsx` | Score bar score/100, High/Medium/Low labels and colored progress track; lender-package API base URL; consent status capitalization. Consent retains its separate component-local API base URL. |
| 75–120 `LeadAssignmentPicker` | `LeadAssignmentPicker` in `header.tsx` | Manager/admin-only active-rep selector, current assignment, pending assignment state, success/error toasts, lead/activity invalidation. Auth retains its original local `useGetMe` query. |
| 123–348 `LeadInfo` | `LeadInfo` in `info.tsx` | AI Deal Briefing card; Generate/Regenerate Briefing; Next best action generation; briefing snapshot, financial picture, engagement, risks, actions, generated timestamp, and no-briefing empty state; Lead Score card, Recalculate action, criteria bars, scored timestamp, and no-score empty state; Contact & Deal Details fields; related-deals panel. |
| 351–406 `LeadNotes` | `LeadNotes` in `notes.tsx` | Add-note textarea/form, Adding… pending label, note loading skeletons, no-notes empty state, author/time/body note cards, create success clearing and list/activity invalidation, error toast. |
| 409–501 `LeadTasks` | `LeadTasks` in `tasks.tsx` | New Task dialog, title and optional due-date inputs, Save/Cancel controls, pending state, task loading skeletons, no-tasks empty state, task cards, completion checkbox mutation, dates, and create/update invalidation/toasts. |
| 504–666 `LeadDocuments` | `LeadDocuments` in `documents.tsx` | Documents heading; Lender Package PDF button, unavailable tooltip/no-application branch, PDF generation pending/error handling and filename; Upload file control and pending label; document loading skeletons, no-documents empty state, file metadata, and download controls. |
| 668–698 `LeadActivity` | `LeadActivity` in `activity.tsx` | Activity loading skeletons, no-activity empty state, timeline markers, activity message/user/entity text, and formatted timestamps. |
| 701–716 `EmailStatusBadge` | `EmailStatusBadge` in `communications.tsx` | Queued, sent, delivered, opened, clicked, bounced, unsubscribed, and fallback status colors. |
| 719–798 `LeadDripStatus` | `LeadDripStatus` in `communications.tsx` | Drip enrollment status, sequence/step/status badges, next-send/due-now text, Unenroll action, active-sequence selector, Enroll action, and enrollment loading/feedback behavior. |
| 801–818 `CallNoteBlock` | `CallNoteBlock` in `communications.tsx` | Expand/collapse long call notes at the original 140-character threshold. |
| 821–1210 `LeadCommunications` | `LeadCommunications` in `communications.tsx` | Call button; calls/SMS thread loading and empty state; inbound/outbound/type/status/duration/outcome badges; call notes, recording audio, and user attribution; email thread and status badges; SMS/Email compose toggle; no-email disabled branch; AI draft popover/instruction/generation; SMS body/send; email template selector/preview and custom editor/send; send pending states, validation, toasts and list/activity invalidations; drip enrollment subpanel. |
| 1213–1220 `editFormSchema` | `edit-dialog.tsx` | The same zod fields and validation for first name, last name, email, phone, company, and application type. |
| 1222–1305 `EditLeadDialog` | `EditLeadDialog` in `edit-dialog.tsx` | Edit Details trigger/dialog, controlled form fields, financing type selector, Cancel/Save Changes, pending state, and success/error invalidation/toasts. |
| 1307–1553 `LeadLenderMatch` | `LeadLenderMatch` in `matching.tsx` | Confirm Submission dialog and Cancel/Yes, Submit; Run Match action and pending state; match loading skeletons; no-matches empty state; ranked lender cards, stars, match/criteria counts, Submit/Submitted controls; criteria chips and expanded criteria detail; lender submission status badges, status actions, and query invalidation. |
| 1556–1559 `applyFieldValues` | `marketing.tsx` | Exact template placeholder substitution helper. |
| 1561–1784 `LeadMarketing` | `LeadMarketing` in `marketing.tsx` | Marketing flyer card; template selector and program labels; variable-field customization; live preview Show/Hide and iframe; Export PDF and pending state; Email to Lead/emailed/sending branches; no-email explanation; generated-success notice and download/email mutations. |
| 1786–1970 `LeadApplication` | `LeadApplication` in `application.tsx` | Application loading spinner; no-application error/empty card; application-link copy control and toast; application header/type badge/signed-document download; business, owner, financing-request, consents/signature, and other application detail cards; conditional fields and consent indicators. |
| 1972–1997 `CreditScoreGauge` | `credit.tsx` | Excellent/Good/Fair/Poor gauge labels and SVG score visualization. |
| 1999–2252 `LeadCredit` | `LeadCredit` in `credit.tsx` | Credit consent dialog/checkbox and Pull Credit controls; soft/hard pull actions and pending states; latest score/gauge; tradeline table; completed-pull fallback; last-pull error and Try Again; pull-history table with date/type/user/score/status badges; loading and no-credit-data states. |
| 2254–2404 `LeadFinancials` | `LeadFinancials` in `financials.tsx` | Financial loading spinner; no-bank-statement empty card; health indicator (Strong/Fair/High Risk); summary cards; monthly breakdown; existing-positions table/card and financial data formatting. |
| 2406–2594 `LeadConsent` | `LeadConsent` in `consent.tsx` | Manager/admin permission gate and unauthorized empty state; Consent & Communication Status card; credit/application consent indicators; communication permission indicators; RTBF/PII scrub controls, confirmation/error/compliance-hold messaging, Force Scrub path, loading labels, and status refresh. |
| 2596–2665 `ConvertToDealDialog` | `ConvertToDealDialog` in `deals.tsx` | Convert to Deal trigger/dialog; deal name, amount, expected GM fields; Cancel/Create Deal and pending state; success toast, lead/deals invalidation, and deal navigation; failure toast. |
| 2667–2698 `LeadDeals` | `LeadDeals` in `deals.tsx` | Related Deals card; loading skeleton; no-linked-deals empty state; deal links, amounts, stages, and created dates. |
| 2700–2854 `LeadDetail` header/status block | `LeadDetailProvider` in `context.tsx` and `HeaderCard` in `header.tsx` | Lead query loading/not-found branches; back link; name/company/email/phone/last-activity header; assignment selector; status selector with every original label (New Lead, Contacted, App Received, In Underwriting, Approved, Funded, Declined, Follow Up); Convert/Edit triggers; funded amount dialog, validation, Cancel/Confirm, pending state, status/activity invalidation and toasts. |
| 2856–2895 `LeadDetail` deal summary | `LeadSummary` in `header.tsx` | Deal Summary card with Financing Type, Source, Assigned To avatar/name or Unassigned, and Created fields. |
| 2897–2957 `LeadDetail` tab shell | `LeadDetailContent` in `lead-detail.tsx` | Same default Info tab and 12 tab labels/icons: Info, Notes, Tasks, Docs, Comms, Activity, Lenders, Marketing, App, Financials, Credit, Consent. Each `TabsContent` mounts only its extracted panel, preserving panel-local hook/state ownership and the existing loading/error/empty branches. |

## AST/source-parity audit

The extraction was made by slicing the baseline function ranges and comparing
the resulting function bodies structurally (function name, statements,
expressions, JSX tree, string literals, and hook calls). The comparison ignores
the file import preamble, `export` modifiers, and the context destructuring
statements that replace old props. The structural comparison found 20 moved
function bodies with parity after those normalizations; the deviations are
listed below.

The following moved bodies were structurally identical under that comparison:
`ScoreBar`, `LeadAssignmentPicker`, `LeadInfo`, `LeadNotes`, `LeadTasks`,
`LeadDocuments`, `LeadActivity`, `EmailStatusBadge`, `LeadDripStatus`,
`CallNoteBlock`, `EditLeadDialog`, `LeadLenderMatch`, `LeadMarketing`,
`LeadApplication`, `CreditScoreGauge`, `LeadCredit`, `LeadFinancials`, `LeadConsent`,
`ConvertToDealDialog`, and `LeadDeals`. The `editFormSchema` and
`applyFieldValues` helpers were also moved byte-for-byte; they are not counted
as component function bodies.

Recorded deviations are limited to the requested refactor seams:

1. Panel signatures now call `useLeadDetail()` and destructure `id`/`lead`
   instead of receiving `leadId`/`lead` props.
2. `LeadInfo` renders `<LeadDeals />` rather than passing the now-shared lead
   props.
3. `LeadCommunications` derives `leadPhone` and `leadEmail` from the shared
   lead context instead of receiving those values from the page shell.
4. `LeadConsent` retains its component-local `apiBase`, matching the baseline
   declaration immediately after `useToast`; Documents retains its separate
   module-level constant.
5. The old page function's header/status JSX and summary JSX were moved into
   `HeaderCard` and `LeadSummary`; their DOM strings, controls, handlers, and
   labels are unchanged. The old page's status state and handlers are now in
   `LeadDetailProvider`.
6. The page now wraps its same loading/not-found/content tree in
   `LeadDetailProvider` and renders panels without prop drilling. No panel query
   or mutation was moved into the provider.

## Screenshot-free verification checklist

### Source parity (completed by inspection)

- [x] Baseline commit and exact line counts recorded.
- [x] Every baseline function is mapped to a new file/component.
- [x] All baseline tabs, labels, buttons, selectors, links, dialogs, fields,
      badges, tables, loading skeletons/spinners, errors, and empty states are
      represented in the inventory above.
- [x] The original page lead/id/status state is exposed through one
      `useLeadDetail` context hook; Assignment/Consent auth and Convert location
      subscriptions remain local to their original mounted components.
- [x] Panel-local API hooks and local state remain inside mounted panels.
- [x] Imports are component-scoped rather than a copied all-page import block.
- [x] The pre-existing untracked attached audit instruction was left untouched.
- [x] No screenshots were taken for the verification below.

### Test and typecheck results

- [x] Frontend existing suite: 13 passed, 0 failed.
- [x] API-server existing suite: 49 passed, 0 failed.
- [x] Full workspace typecheck passed (API, CRM, mobile, sandbox, scripts).
- [x] `git diff --check` passed.

### Screenshot-free browser checklist

The available development test account was pending approval. These checks used
ephemeral browser-only GET fixtures, not authenticated live-data verification.
No application code or database records were changed for the checks. No send,
save, upload, export, credit pull, matching, or scrub control was activated.
The final targeted check blocked all non-GET API calls, including Twilio token
initialization. Initial fixture-shape errors were corrected without code changes.

| Tab/panel | Result | Rendered fields/controls checked |
| --- | --- | --- |
| Info | PASS, fixture-backed | Briefing and next-action controls, no-briefing state; score/recalculate and no-score state; contact/deal fields; Related Deals empty state. |
| Notes | PASS, fixture-backed | Note textarea, disabled Add Note, no-notes state. |
| Tasks | PASS, fixture-backed | Checklist & Tasks, New Task entry point, no-tasks state. |
| Docs | PASS, fixture-backed | Documents, disabled Lender Package with No application on file, Upload, no-documents state. |
| Comms | PASS, fixture-backed | Call control; outbound sent SMS/body/attribution; SMS/Email and Template/Custom toggles; draft/composer/send controls; drip sequence selector and Enroll. |
| Activity | PASS, fixture-backed | No-activity branch. Populated timeline preserved by source comparison. |
| Lenders | PASS, fixture-backed | Lender Matching, explanation, Run Match, no-matches branch. |
| Marketing | PASS, fixture-backed | Flyer selector, Customize Fields with Headline and Funding Amount, Live Preview/Show Preview, Export PDF. |
| App | PASS, fixture-backed | No-application guidance, application URL, Copy. Populated application fields preserved by source comparison. |
| Financials | PASS, fixture-backed | No-bank-statement guidance; populated tables preserved by source comparison. |
| Credit | PASS, fixture-backed | Experian guidance, authorization checkbox, soft/hard options, disabled Pull Credit Report. |
| Consent | PASS, fixture-backed | Safe Load Consent Status GET; credit/TCPA/application/terms indicators, Email/SMS/Credit permissions, Refresh. |
| Edit dialog | PASS, fixture-backed | First/last name, email, phone, company, financing type, Cancel/Save/close. Opened and cancelled without saving. |
| Convert dialog | PASS, fixture-backed | Deal name, amount, expected GM, Cancel/Create. Opened and cancelled without creating. |

Limits: the manager fixture did not render admin-only RTBF controls; email
status badges/template previews and generated flyer states were not exercised.
Those branches are accounted for in the source-parity inventory, not claimed as
browser-tested. Unrelated GETs returned 403 under the fixture session. Final
Comms/Marketing/Consent rendering had no uncaught component exceptions.
