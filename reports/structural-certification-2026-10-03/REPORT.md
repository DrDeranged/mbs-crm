# Structural certification — PASS: 36/36

Fresh browser rerun on 2026-10-03 of scripts/visual-refresh/structure.mjs.
Baseline: `2993f17`, before the contact-action and visual-refresh merges.
Application payload: GitHub `2af927ca2830926bf325cef2eecfffc24ab5c110`.
The new commit updates verification scripts, approved exceptions and reports only;
no web application, API, permissions, database, or business behavior was changed.
Nothing was published.

## Result

- **36/36 PASS** — six pages × two widths × three roles.
- Before runner exit: 0; after runner exit: 0.
- Unapproved differences: **0**.
- Approved exact replacement spans: 69.
- Guard regressions: **9/9 passed**, including rejected removals, reordering,
  changed destinations/states, empty inventories and unexpected container controls.
- Apply now waits for its financing question, both financing buttons and Next
  before collecting a stable inventory. Apply has no structural exception.

## Documented approval

The user explicitly approved the intended contact-action changes on Leads, Deals,
Lead detail and Dashboard: clickable company/contact names, phone links and
email-to-composer. The existing Settings theme selector and record action bars
are also approved.

The [human-readable exception list](../../scripts/visual-refresh/STRUCTURE_EXCEPTIONS.md)
and [frozen machine-readable list](../../scripts/visual-refresh/approved-structure-exceptions.json)
encode the exact expected descriptor changes, by page, width and role. The
manifest SHA-256 is `634220386231a21851c23eeceaffb92be2cc1f708071fa5db5d22403543c17d7`.
It is not regenerated during a run and does not broadly ignore all contact
links, labels or approved containers.

## Dashboard assignment-control audit

**PASS. No assignment control was removed or reordered.**
Across all six Dashboard inventories, every tag, role, type, href and disabled
state is identical at the same index, and the control count is unchanged.
The two admin assignment labels are the only assignment-label changes:

- `New owner for Fixture Equipment LLC` →
  `New owner for Fixture Equipment LLC — Synthetic Contact`
- `New owner for Fixture Services LLC` →
  `New owner for Fixture Services LLC — Sample Applicant`

The two existing lead-link labels use the same company-first naming. Manager/rep
Dashboard inventories have no descriptor changes. Assignment callbacks were not
changed by this certification; the original contact-action source diff shows
the existing shared label changing to the company-first formatter.

### Explicit removed/reordered controls outside Dashboard

- **Lead detail, 390px, all three roles:** the old unlabeled floating Softphone
  launcher is suppressed on mobile record detail because the approved record
  action bar supplies Call. Its three exact removals are encoded; desktop
  launchers remain. This is not a Dashboard or assignment-control removal.
- **Lead-detail header:** the original email/phone pair becomes phone/email,
  while their destinations become the approved Call/composer links. This exact
  contact-pair replacement is encoded; other surviving controls retain order.
- **Leads:** the former composite row link is replaced by company/contact
  identity links and separate phone/email links; this is encoded as replacement
  spans, not as permission to remove unrelated row controls.

| Comparison | Counts | Same tag/role/type/href/disabled at every index | Label-only changes |
| --- | --- | --- | ---: |
| dashboard-390-admin | 44 → 44 | YES | 4 |
| dashboard-768-admin | 44 → 44 | YES | 4 |
| dashboard-390-manager | 29 → 29 | YES | 0 |
| dashboard-768-manager | 29 → 29 | YES | 0 |
| dashboard-390-rep | 25 → 25 | YES | 0 |
| dashboard-768-rep | 25 → 25 | YES | 0 |

This is a comparison of matched synthetic fixture states, not exhaustive
coverage of every conditional Dashboard widget. The original contact changes
also replace an overdue-voicemail Call button with a phone link and link its lead
name when that widget has data. Those are the approved contact actions, not
assignment-control removals or reordering; that conditional branch is not
populated in these 36 fixture comparisons.

## Full comparison matrix

| Page / width / role | Before | After | Approved replacement spans | Separately checked controls | Verdict |
| --- | ---: | ---: | ---: | ---: | --- |
| dashboard-390-admin | 44 | 44 | 2 | 0 | PASS |
| leads-390-admin | 71 | 79 | 7 | 0 | PASS |
| lead-detail-390-admin | 51 | 50 | 3 | 14 | PASS |
| pipeline-390-admin | 39 | 47 | 2 | 0 | PASS |
| apply-390-admin | 5 | 5 | 0 | 0 | PASS |
| settings-390-admin | 83 | 83 | 0 | 1 | PASS |
| dashboard-768-admin | 44 | 44 | 2 | 0 | PASS |
| leads-768-admin | 71 | 79 | 7 | 0 | PASS |
| lead-detail-768-admin | 51 | 51 | 2 | 14 | PASS |
| pipeline-768-admin | 39 | 47 | 2 | 0 | PASS |
| apply-768-admin | 5 | 5 | 0 | 0 | PASS |
| settings-768-admin | 83 | 83 | 0 | 1 | PASS |
| dashboard-390-manager | 29 | 29 | 0 | 0 | PASS |
| leads-390-manager | 63 | 71 | 7 | 0 | PASS |
| lead-detail-390-manager | 43 | 42 | 3 | 14 | PASS |
| pipeline-390-manager | 30 | 38 | 2 | 0 | PASS |
| apply-390-manager | 5 | 5 | 0 | 0 | PASS |
| settings-390-manager | 28 | 28 | 0 | 1 | PASS |
| dashboard-768-manager | 29 | 29 | 0 | 0 | PASS |
| leads-768-manager | 63 | 71 | 7 | 0 | PASS |
| lead-detail-768-manager | 43 | 43 | 2 | 14 | PASS |
| pipeline-768-manager | 30 | 38 | 2 | 0 | PASS |
| apply-768-manager | 5 | 5 | 0 | 0 | PASS |
| settings-768-manager | 28 | 28 | 0 | 1 | PASS |
| dashboard-390-rep | 25 | 25 | 0 | 0 | PASS |
| leads-390-rep | 54 | 62 | 5 | 0 | PASS |
| lead-detail-390-rep | 40 | 39 | 3 | 14 | PASS |
| pipeline-390-rep | 29 | 37 | 2 | 0 | PASS |
| apply-390-rep | 5 | 5 | 0 | 0 | PASS |
| settings-390-rep | 26 | 26 | 0 | 1 | PASS |
| dashboard-768-rep | 25 | 25 | 0 | 0 | PASS |
| leads-768-rep | 54 | 62 | 5 | 0 | PASS |
| lead-detail-768-rep | 40 | 40 | 2 | 14 | PASS |
| pipeline-768-rep | 29 | 37 | 2 | 0 | PASS |
| apply-768-rep | 5 | 5 | 0 | 0 | PASS |
| settings-768-rep | 26 | 26 | 0 | 1 | PASS |

## Evidence

- [Comparison results and Dashboard index audit](structural-comparison.json)
- [Summary and unapproved-difference list](SUMMARY.json)
- [Fresh baseline inventories](before/role-controls.json)
- [Fresh target inventories](after/role-controls.json)
- [Baseline separately checked controls](before/exempt-controls.json)
- [Target separately checked controls](after/exempt-controls.json)
- [Baseline runner transcript](STRUCTURE_BEFORE.txt)
- [Target runner transcript](STRUCTURE_AFTER.txt)
- [Comparison guard tests](COMPARISON_TESTS.txt)
- [Original contact-action Dashboard source diff](DASHBOARD_NAMING_DIFF.txt)

The prior eleven-gate preflight, end-to-end flows, contrast and 96-image screenshot
matrix were not rerun: their application inputs remain unchanged. The original
failed structure report remains historical evidence of the pre-approval rules
and Apply readiness failure; this fresh report supersedes its structural verdict
only after the user's explicit approval.
