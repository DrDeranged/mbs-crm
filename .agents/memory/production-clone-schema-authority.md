---
name: Production clone schema authority
description: Which production schema evidence to trust when publish preflight and read-only production queries disagree.
---

For publish readiness, treat the managed production clone used by the authoritative preflight as the schema comparison source of truth.

**Why:** A read-only production metadata query reported the safe `users.role` default while the managed clone still contained the legacy default. Only the clone exposed the divergence that Publish needed reconciled, and preflight passed after an explicit migration aligned it.

**How to apply:** If `executeSql` production metadata and `db:divergence` disagree, inspect the clone’s exact column signature, reconcile it through a normal migration, and require a complete `PREFLIGHT PASS` before recommending publish.