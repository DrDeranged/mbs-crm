---
name: Partial migration recovery
description: Durable policy for recovering partially applied SQL migrations without creating checksum drift or hiding failures.
---

Never edit a migration that has been applied or recorded as failed in any environment. Complete its intent in a later fully idempotent migration. Persist migration failures and expose them through operational health until resolved.

**Why:** A partially applied partner migration left durable DDL behind, then failed on a duplicate constraint and blocked every later migration while the failure was visible only in boot logs.

**How to apply:** Guard schema creation with `IF NOT EXISTS`, catalog checks, or duplicate-object handling. Keep immutable legacy exceptions checksum-pinned so edits fail lint rather than silently changing history. If a later recovery migration repairs prerequisites needed by intervening migrations, a narrowly mapped supersession path must run that recovery before continuing; never skip arbitrary failed migrations based only on a duplicate-object error.