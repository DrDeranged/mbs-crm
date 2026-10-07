---
name: Web visual scope
description: Scope and evidence constraints for visual-only web CRM refreshes.
---

Representatives must never request the user directory. Hide every directory-backed
rep filter or assignee picker for reps, including before identity finishes loading;
managers and admins retain those controls. This functional role-policy change is
explicitly approved in addition to the three structural exception categories:
Search referrer, Share referral link, and the exact rep Retry removals.

**Why:** The user explicitly rejected rep error panels and empty directory controls,
not just failed queries. Query disabling alone does not remove cached directory
data or prevent a manual refetch.

**How to apply:** Keep role checks on both requests and controls, including new/edit
forms and direct route visits. Do not weaken server RBAC or use a baseline update
to approve unrelated structural changes.

Web CRM visual-only work must preserve existing interactive controls and their relative DOM/tab order, including persistent lead/deal contact actions. On 2026-10-04, the user approved moving desktop light/dark switching to a top-bar icon beside Search and removing the desktop Settings appearance selector. Mobile web keeps its existing Settings appearance control. Unsaved/invalid choices still default to Light; existing System preferences remain honored until explicitly toggled. Cross-device sync is not requested.

**Why:** Presentation changes do not authorize workflow redesign. The desktop header theme control is an explicit approved exception, not permission to add or reorder unrelated controls or mobile navigation.

**How to apply:** Keep Expo, routes, fetching, validation, business behavior, permissions and database schemas out of visual-only edits. Freeze matched protected-page baselines before visual changes. Public sign-in captures and mocked visual fixtures do not prove authenticated persistence. Never send live calls, messages, emails, campaigns or credit requests to gather visual-refresh evidence.

For combined contact-action/visual certification, the user approves company-first clickable company/contact names, phone links and email-to-composer changes on Leads, Deals, Lead detail and Dashboard. Dashboard assignment controls may change their company-first labels only; removing or reordering them is not approved.

**Why:** The contact-action changes are intentional product requirements, not unwanted additions from the visual refresh. Treating them as regressions would undo approved usability work.

**How to apply:** Document exact approved differences separately from remaining controls; never turn the approval into a wildcard that accepts future unrelated additions, deletions or reordering.

Visual evidence must first prove that the expected route has rendered, then wait for its initial data-loading slots to finish and its control inventory to stabilize, not only for navigation to become network-idle.

**Why:** Authentication can finish after navigation settles and start protected queries. Lazy public routes can also appear stable with an empty inventory before rendering. Both produce false differences despite matched fixtures.

**How to apply:** Keep loading/request behavior intact. Require a page-specific landmark or expected controls before accepting stability, including public pages, and record harness failures separately from confirmed application differences.

Freeze baseline builds in ignored workspace storage, not only in temporary directories.

**Why:** A temporary baseline disappeared across a workspace handoff even though its screenshots and measurement reports survived. That prevented reproducing a matched before/after benchmark.

**How to apply:** Preserve the baseline revision and rebuild recipe alongside the evidence; check the frozen build exists before creating synthetic accounts or disposable databases.

Persistence evidence must wait for a successful mutation response before inspecting stored records or bytes.

**Why:** A selected upload filename can appear before the upload succeeds. Treating that label as completion produced a misleading UI assertion followed by a missing database record.

**How to apply:** Keep visual fixtures separate from persistence proof, match controls against their actual accessible names, and await the relevant completed response rather than optimistic labels.

Desktop workspace changes do not authorize new mobile controls or new structural exceptions. Below 1024px, compare against the certified post-contact baseline; do not expand the older pre-contact exception manifest.

**Why:** The user specifically requires the certified mobile navigation/control order to remain untouched while desktop-only rail and pin controls are introduced.

**How to apply:** Branch desktop-only controls out of the DOM below the breakpoint rather than merely CSS-hiding them, and compare existing exempt controls too.

The user explicitly approved two Lead Detail exceptions on 2026-10-05:
the INPUT named "Search referrer" and BUTTON named "Share referral link".
No other mobile control additions, removals or ordering changes are approved.

**Why:** These referral tools are intended additions, while the remaining
certified mobile control inventory must still match exactly.

**How to apply:** Compare these as a separate, exact two-control approved
inventory on Lead Detail only for each role at 390/768; require zero approved
additions on other pages and preserve the prior exemption inventory unchanged.

The user also approved removing the impossible rep-only Retry controls from
Leads and Pipeline on 2026-10-05.

**Why:** Those controls came from querying a manager-only user directory as a
rep; retrying could never resolve the permission denial.

**How to apply:** Gate directory queries by role rather than weakening the API
permission boundary. The exact removals are one Retry on each rep Leads and
Pipeline case at 390/768. No other removals are authorized.

Control-inventory and persistence proofs do not certify text readability. Dense
record layouts need geometry checks with fully populated rows and realistic
long addresses, company/contact names, status labels and ownership labels.

**Why:** A Leads table could preserve every control and pass workflow checks
while squeezing a break-anywhere email into a few characters per line and
making each row very tall. Content length and column competition matter.

**How to apply:** Inspect the actual narrow-desktop screenshots and measure
email line rectangles, row heights, clipping and scroll containment. Preserve
intentional wrapping in compact cards; let dense tables scroll rather than
compressing identifiers into character stacks.

For desktop Leads, the user approved a different constraint on 2026-10-05:
the title, filters, records, bulk actions and pagination must fit the viewport
at normal zoom. Responsive field grouping, keyboard-accessible full-value
details and adaptive pagination are authorized here; the older horizontal
table-scroll workaround does not satisfy this request. Below 1024px, preserve
the existing mobile/tablet controls and order. Long forms and other genuinely
long content may still scroll within the workspace.

**Why:** Preserving controls alone left unused side space, clipped columns and
records below the screen. Shrinking the whole app or hiding overflow is not an
acceptable substitute for fitting the visible page.

**How to apply:** Keep full contact and ownership values accessible, measure
actual row geometry and wrapped bulk controls, and reserve loading/footer
space independently of query data so page sizing cannot oscillate.

Viewport-fit certification must include hit-target checks for bottom controls,
not only scroll dimensions.

**Why:** A floating phone control intercepted pagination even when every
reported viewport/scroll dimension passed. Selection-dependent controls can
also change height while a page-size query is pending and trigger a sizing loop.

**How to apply:** Click pagination and selection-clear controls in narrow,
pinned and bulk states using synthetic fixtures; inspect overlay hit targets
without initiating a call. Preserve toolbar geometry through pending queries.

Include short laptop heights and open detail dialogs in viewport-fit checks,
not just tables or page widths. Long records may scroll, but dialog headings,
close controls, and action footers must remain accessible without sideways
scrolling or shrinking the whole interface.

**Why:** The user reported wasted bottom space on Lead Detail and a lender
package dialog whose contents slid sideways and whose lower controls did not
fit. A width-only or default-height check does not detect that experience.

**How to apply:** Check realistic long document names and a short desktop
viewport alongside phone sizing. Verify the scrollable content and the fixed
controls separately; reaching the end of a long panel does not mean earlier
content should remain visible at the same time.

On 2026-10-06, the user approved restoring continuous desktop Leads scrolling:
keep filters visible and load additional records while scrolling, rather than
forcing manual Next clicks after a viewport-sized handful of rows. This
supersedes the earlier adaptive-pagination interpretation; mobile is unchanged.

**Why:** Seven-row pages made browsing 577 leads unnecessarily repetitive.

**How to apply:** Fit the workspace shell without preventing the records region
from scrolling. Do not reintroduce viewport-derived desktop query limits.