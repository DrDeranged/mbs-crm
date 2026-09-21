---
name: Migration-model parity
description: Why schema parity checks must not exclude operational tables.
---

Schema parity checks must cover application and operational tables without exclusions.

**Why:** Excluding a table can let destructive production drift pass validation.

**How to apply:** When changing schema validation, keep its table scope complete and treat any proposed destructive diff as a release blocker.