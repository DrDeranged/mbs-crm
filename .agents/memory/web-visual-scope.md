---
name: Web visual scope
description: Scope and evidence constraints for visual-only web CRM refreshes.
---

Web CRM visual-only work must preserve existing interactive controls and their relative DOM/tab order, including persistent lead/deal contact actions. The approved appearance preference control belongs inside existing Settings, defaults to system and is isolated per signed-in account in the current browser; cross-device sync is not requested.

**Why:** The user explicitly permits presentation changes, not workflow redesign, and approved only the Settings appearance control as new interactive structure.

**How to apply:** Keep Expo, routes, fetching, validation, business behavior, permissions and database schemas out of visual-only edits. Freeze matched protected-page baselines before visual changes. Public sign-in captures and mocked visual fixtures do not prove authenticated persistence. Never send live calls, messages, emails, campaigns or credit requests to gather visual-refresh evidence.

Protected-page visual evidence must wait for the route's initial data-loading slots to finish and its control inventory to stabilize, not only for the initial navigation to become network-idle.

**Why:** Authentication can finish after the initial navigation settles and then start protected-page queries. Capturing at that point produces inconsistent control inventories despite identical synthetic fixtures.

**How to apply:** Keep the original loading/request behavior intact; make the evidence runner wait for an identified loaded page state before comparing screenshots or ordered controls.

Freeze baseline builds in ignored workspace storage, not only in temporary directories.

**Why:** A temporary baseline disappeared across a workspace handoff even though its screenshots and measurement reports survived. That prevented reproducing a matched before/after benchmark.

**How to apply:** Preserve the baseline revision and rebuild recipe alongside the evidence; check the frozen build exists before creating synthetic accounts or disposable databases.

Persistence evidence must wait for a successful mutation response before inspecting stored records or bytes.

**Why:** A selected upload filename can appear before the upload succeeds. Treating that label as completion produced a misleading UI assertion followed by a missing database record.

**How to apply:** Keep visual fixtures separate from persistence proof, match controls against their actual accessible names, and await the relevant completed response rather than optimistic labels.