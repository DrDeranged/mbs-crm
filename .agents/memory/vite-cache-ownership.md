---
name: Vite optimized cache ownership
description: Missing optimized files can break lazy routes while the development server and initial page remain healthy.
---

Keep the live development optimizer cache separate from one-off build and verification caches.

**Why:** A running server retained valid transformed-module URLs after its optimized-dependency directory disappeared. Already-cached imports still returned 200, but cold chart/date imports returned Vite's 504 dependency response and rejected the dashboard's lazy import. Server uptime, memory checks and public sign-in captures did not detect this frontend failure. The exact process that removed the original directory was not established.

**How to apply:** For repeated lazy-route failures, inspect both the failed module requests and the physical optimized files before blaming workspace capacity or application data. Verify cold route dependencies remain available across a concurrent build; a page reload alone cannot repair a server's stale optimizer state.