---
name: Production clone schema authority
description: Which production schema evidence to trust when publish preflight and read-only production queries disagree.
---

For publish readiness, treat a managed clone restored from an actual production backup as the schema comparison source of truth. A schema-only fallback is not evidence about the live production schema or data.

**Why:** A read-only production metadata query reported the safe `users.role` default while the managed clone still contained the legacy default. Only the clone exposed the divergence that Publish needed reconciled, and preflight passed after an explicit migration aligned it.

**How to apply:** If `executeSql` production metadata and `db:divergence` disagree, inspect the clone’s exact column signature, reconcile it through a normal migration, and require a complete `PREFLIGHT PASS` before recommending publish.

Check the clone source provenance before reporting production rehearsal.

**Why:** A full eleven-gate run can pass using the historical schema-only fallback. The database name and gate label still say production clone, but that does not certify an actual production snapshot.

**How to apply:** Retain the clone source kind and fingerprint with certification evidence. If the source is schema-only, report that limitation explicitly and leave production-data rehearsal unverified.