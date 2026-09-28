---
name: Baseline migration adoption
description: Safe bootstrap migration behavior for empty databases versus existing installations.
---

A baseline migration that recreates the pre-runner schema belongs only on a genuinely empty public schema. On existing installations, record its checksum in the migration ledger without executing the baseline SQL.

**Why:** `CREATE TABLE IF NOT EXISTS` does not make the whole file safe on populated databases. Conditional foreign-key and index creation can validate old data, create unexpected objects, or hold locks. An empty-schema rehearsal alone cannot prove adoption is safe.

**How to apply:** Rehearse both an empty database through all migrations and a populated production-representative clone missing the baseline ledger entry. On the populated clone, assert no baseline SQL executed and compare application catalog tables, columns, constraints, and indexes before and after adoption.