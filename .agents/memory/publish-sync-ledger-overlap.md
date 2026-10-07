---
name: Publish schema sync and legacy ledger overlap
description: Managed publish can materialize the model schema before a legacy migration runner sees it.
---

Do not infer missing schema objects from a failed or pending migration ledger row. Replit's managed publish schema synchronization can create the model objects before the legacy application runner executes.

**Why:** The user confirmed a production incident where publish synchronization pre-created attribution objects, the legacy runner failed on an existing column, and rollback left the schema objects present but the migration ledger failed/pending.

**How to apply:** Inspect actual catalog definitions as well as ledger state, and rehearse model-object precreation before migration execution. Preserve applied migration checksums. Do not add production startup DDL or direct managed-production ledger mutations; use the supported managed publish schema flow.

Zero-DDL recovery evidence must include PostgreSQL's own DDL logging through
application boot, not just a query-string counter or an unchanged catalog hash.

**Why:** Ledger `ON CONFLICT DO UPDATE` can be miscounted as procedural DDL, while
a genuinely executed no-op `DO` block or `CREATE ... IF NOT EXISTS` can leave the
catalog unchanged. Neither alone proves startup performed no schema DDL.

**How to apply:** Rehearse metadata adoption in a disposable local cluster,
compare catalog fingerprints, and independently count server-observed schema
statements over both recovery and boot. Restrict model-sync simulations to that
isolated cluster; never relax the application's production schema-path guard.
