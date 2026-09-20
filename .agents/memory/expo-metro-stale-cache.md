---
name: Expo Metro resolution after pnpm changes
description: Diagnose Metro "Unable to resolve" errors by checking both workspace links and the running cache
---

For Metro "Unable to resolve" errors after pnpm changes, verify that the package's workspace `node_modules` link actually exists before treating the error as a stale-cache problem. A dependency can be present in both `package.json` and `pnpm-lock.yaml` while its package-level link is absent after a partial or interrupted install.

**Why:** Two failures look identical: the pnpm link may genuinely be missing, or Metro may still cache an old symlink target after an upgrade. Restarting cannot repair a missing link, and reinstalling is unnecessary when only the running cache is stale.

**How to apply:** Check the package link under the mobile artifact's `node_modules`. If absent, restore the filtered workspace install from the lockfile. Then restart the `artifacts/mbs-crm-mobile: expo` workflow after any pnpm package change so Metro re-resolves the new targets.
