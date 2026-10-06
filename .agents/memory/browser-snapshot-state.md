---
name: Browser snapshot state
description: Full-page captures can close transient Radix controls by changing the viewport.
---

Do not assume an open popover survives a full-page browser capture.

**Why:** Full-page captures can resize the viewport, and Radix Select closes its popup on resize. A correct option inventory can therefore be followed by a missing-option error even though application behavior is unchanged.

**How to apply:** Read an open menu's options before capture. Use viewport-only captures for open-menu evidence, or complete the selection before a full-page capture. Preserve failed evidence rather than weakening control comparisons.
