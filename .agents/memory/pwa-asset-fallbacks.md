---
name: Published PWA asset fallbacks
description: Preventing stale app shells and cached HTML under removed hashed JavaScript filenames.
---

The published static host can respond with `200 text/html` (the SPA shell) for a removed `/assets/*.js` URL. Do not treat HTTP success alone as proof of a usable JavaScript asset, and do not cache the HTML under that asset's URL.

**Why:** A cache-first service worker can continue serving an outdated entry bundle after a republish; the older entry references a removed route chunk, which the static host answers with HTML and the browser rejects as a module. Cache-first handling can make the wrong response persist.

**How to apply:** Serve the navigation shell and entry bundle network-first with `no-store`; allow cache-first only for immutable secondary asset names, verify their MIME type before caching, and offer one guarded reload on a failed dynamic import. Compare the live index's asset references against those assets before calling a release inconsistent.