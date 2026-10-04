---
name: Web visual scope
description: Scope and evidence constraints for visual-only web CRM refreshes.
---

Web CRM visual-only work must preserve existing interactive controls and their relative DOM/tab order, including persistent lead/deal contact actions. The approved appearance preference control belongs inside existing Settings, defaults to Light for unsaved/invalid choices and is isolated per signed-in account in the current browser; explicit System, Light and Dark choices stay honored. Cross-device sync is not requested.

**Why:** The user explicitly permits presentation changes, not workflow redesign, and approved only the Settings appearance control as new interactive structure.

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