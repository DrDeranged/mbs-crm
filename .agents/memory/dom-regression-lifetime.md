---
name: DOM regression process lifetime
description: Standalone bundled React/Radix checks can retain scheduling handles after DOM cleanup.
---

Standalone React/Radix DOM checks need an explicit process-completion strategy after successful assertions and teardown.

**Why:** A bundled Node DOM check completed all assertions and unmounted its tree, but retained scheduling handles prevented exit and blocked the following validation commands until timeout.

**How to apply:** For a standalone CLI, exit successfully only after all assertions and cleanup finish. Keep assertion failures on the nonzero exit path; never unconditionally exit successfully from a cleanup block.