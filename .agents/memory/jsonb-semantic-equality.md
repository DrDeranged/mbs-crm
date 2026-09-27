---
name: JSONB semantic equality
description: Why JSON.stringify comparisons can falsely report changes after a PostgreSQL JSONB round-trip.
---

Compare persisted JSONB objects by their meaningful fields, not by their serialized key order, when reconciling external data.

**Why:** PostgreSQL JSONB can reorder object keys. A reconciliation that compared newly constructed objects with stored objects using `JSON.stringify` reported the same links as changed on every run even though their values matched.

**How to apply:** For idempotent repair/sync flows, compare scalar values and array order intentionally; within each object compare named fields (or use a canonical, stable serializer) rather than assuming database JSONB preserves insertion order.