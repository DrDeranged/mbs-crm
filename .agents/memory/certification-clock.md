---
name: Certification fixture clocks
description: Strict archived control labels can depend on both browser and API clocks.
---

Control inventories must account for both browser-relative dates and server-calculated idle days when comparing an archived certification.

**Why:** Matched current and frozen-baseline bundles had identical controls, but a day of elapsed time changed idle labels in six Leads inventories. Freezing the browser clock fixed browser-relative labels without changing API-calculated idle days, so the archived comparison still failed.

**How to apply:** Anchor synthetic record ages consistently with the certified fixture across both API and browser clocks. Never silently normalize labels, widen exemptions, or call a strict comparison passing merely because the differences look harmless. Preserve original failures and distinguish fresh retained-baseline parity from archived-inventory parity.