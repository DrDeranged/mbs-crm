---
name: Expo Metro stale cache after pnpm add
description: Metro shows "Unable to resolve" after pnpm package upgrade until workflow restart
---

After running `pnpm add --filter @workspace/mbs-crm-mobile <package>@<new-version>`, Metro Bundler may show "Unable to resolve '<package>'" errors for the web bundle target, even though the pnpm symlink in node_modules is correct.

**Why:** Metro caches module resolution in memory. After a pnpm upgrade, the symlink target path changes (new version hash in .pnpm store), but Metro's in-memory cache still holds the old path which no longer resolves.

**How to apply:** Restart the `artifacts/mbs-crm-mobile: expo` workflow after any pnpm package upgrade. This clears Metro's cache and forces re-resolution. The error is benign until restart — the native app bundle is unaffected; only the web bundle shows the error.
