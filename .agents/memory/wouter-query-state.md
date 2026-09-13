---
name: Wouter query-state handoffs
description: How to reliably open UI state after navigating with a query parameter.
---

When a cross-page action uses a query string to request UI state (for example, navigate to a list page and open a dialog), read the query from `window.location.search` or Wouter's dedicated query helper. Do not assume `useLocation()` includes the query string.

**Why:** Wouter's location hook returns the routed pathname, which can make a navigation such as `/leads?import=1` render the destination page without exposing the flag to a pathname-only check.

**How to apply:** Use the pathname from `useLocation()` to detect the destination route, then parse the browser query string in an effect that opens the requested UI state.