---
name: Postgres array default parity
description: Equivalent PostgreSQL array defaults can be reported as drift by Drizzle Kit
---

For array defaults in append-only migrations, use a PostgreSQL literal representation that agrees with the Drizzle model. Drizzle Kit may still report a redundant SET DEFAULT for an empty text array even when the catalog already holds an equivalent default. Filter only that exact statement after checking the catalog value.

**Why:** A schema parity gate reported drift for a physically equivalent empty-array default; changing the model to an explicit SQL cast did not resolve the repeated proposal.

**How to apply:** Inspect the actual column default and compare it to the proposed statement before accepting an exact known-equivalence exception. Keep other default differences actionable.