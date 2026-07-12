---
name: xlsx no-patch vulnerability
description: xlsx HIGH vulns have no npm-published patch; requires manual library replacement
---

The `xlsx` (SheetJS community edition) package has two HIGH vulnerabilities:
- GHSA-4r6h-8v6p-xvw6: Prototype Pollution
- GHSA-5pgg-2g8v-p4x9: ReDoS

**Why:** "Patched versions: <0.0.0" in pnpm audit means no patched release exists in the npm registry. The official fix is only available in SheetJS Pro (paid) or switching to an alternative like `exceljs`.

**How to apply:** Do NOT run `pnpm audit --fix` — it will not help. To resolve, replace xlsx with `exceljs` or another alternative in `artifacts/api-server`. Document the known risk in the security register until replaced.
