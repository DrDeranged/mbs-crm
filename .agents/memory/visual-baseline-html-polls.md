---
name: Visual baseline HTML polling
description: Keep a frozen UI baseline's version checks consistent with its retained bundles.
---

When certifying a frozen UI baseline against a newer running app, freeze same-origin HTML fetches as well as document navigation and static assets.

**Why:** The app's update detector independently fetches the canonical HTML. Mixing an old bundle with current HTML announces an update and adds interactive banner controls, invalidating an otherwise exact mobile inventory comparison.

**How to apply:** Serve the retained HTML for both browser navigation and HTML version polling. Fail explicitly if a requested retained asset is absent; never silently substitute bytes from the newer app or exempt the resulting controls.