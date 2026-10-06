# Offline classification — first structure browser capture

**Source:** `runs/structure-final`  
**Review method:** retained JSON and screenshots only. No browser rerun. No product
or shared-runner changes.  
**Machine-readable detail:** `structure-delta-classification.json`

## Verdict

The original structure child result remains **FAIL (74 assertions)**. It is not
valid to report 36/36 passing, and the retained comparison is **FAIL/unverified**
until a canonical, semantically comparable capture is available. The original
`structure-raw-deltas.json` and child results were not rewritten. No baseline,
exemption, or allowlist was broadened.

The 74 failures break down exactly as:

| Assertion class | Count |
| --- | ---: |
| Strict additions/removals comparison across the 36 canonical cases | 36 |
| Retained-control-order comparison across the same cases | 36 |
| Route/role/viewport inventory comparison | 1 |
| Console-error assertion | 1 |
| **Total** | **74** |

## What the retained evidence establishes

- `before/controls.json` is identical to `before/role-controls.json`: the
  canonical static 36-case inventory was copied as the “before” controls; there
  is no same-run before screenshot/DOM capture.
- The browser-captured `after/controls.json` has 60 cases. The extra 24 are
  `deal-detail`, `new-deal`, `credit-compliance`, and `campaign-audience` for
  each of three roles at two widths. They have no matching canonical before
  case. The inventory assertion is therefore a capture-plan/baseline mismatch,
  not proof that the product dropped or added those routes.
- The 390px dashboard delta does **not** prove the sidebar links were removed.
  The retained mobile screenshot shows the compact state with an Open navigation
  control; the 768px screenshot shows the sidebar. The supplementary
  `navigation-controls.json` matches the role-appropriate canonical navigation
  projection for all 18 cases it records. This resolves the sidebar
  interpretation only; it does not validate the full control comparison.
- The candidate capture used synthetic fixture data: six staff, 34 source leads,
  and six deals. Names such as Nate Rep, Nate Manager, Zoe Rep, and Merged
  Target, plus their synthetic lead/deal rows, are dataset-dependent differences,
  not standalone evidence of product-code changes.

## Deltas kept visible

The raw output includes the explicitly requested Lead Source additions (6),
Search referrer additions (6), Share referral link additions (6), and rep Retry
removals (4). These are the allowed changes; they do not justify exceptions for
other controls.

Two unresolved candidate differences remain visible:

1. **Open softphone:** an added candidate control in 27 canonical cases, absent
   from the corresponding archived controls and not among the approved changes.
   Treat it as an unapproved candidate product-surface delta pending
   authorization; do not dismiss it as the mobile sidebar or fixture data.
2. **Apply option accessible names:** six cases change spacing in the candidate
   control names (for example, “Working CapitalMerchant…” → “Working
   Capital Merchant…”). This may be a useful label/content change or a
   collector/text-normalization difference. With no same-state before DOM, it
   remains unresolved and is not exempted.

## Request errors vs. console warnings

For this retained structure run, `after/http-errors.ndjson` is empty and
`after/assertions.json` has `httpErrors: []`: **zero 4xx/5xx records** are
available to bucket by role/page. The captured artifacts do not contain eight
request-error rows, so none are fabricated here.

The separate failed console assertion is six Radix accessibility warnings:
“DialogContent requires a DialogTitle…”, two each for admin, manager, and rep.
Those entries contain role but no page/route. They are console warnings, not
HTTP statuses; they must not be placed in the request-error ledger.

## Operational status

The frozen pinned build pair is verified and the recorded 11-gate preflight is
PASS. The database clone remains a separate production-readiness failure:
`sourceKind=schema-only` does not meet the actual-production-clone requirement.
Main is running the independent core phase. This review did not start or rerun
any browser phase.
