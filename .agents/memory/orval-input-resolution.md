---
name: Orval input-resolution failure
description: Current Orval codegen fails before generation and deletes generated outputs as part of its clean step.
---

Do not rely on the current Orval command to validate or regenerate API clients until its input-resolution failure is repaired.

**Why:** Orval 8.9.1 rejects both relative and absolute OpenAPI YAML targets as invalid strings after first cleaning the React Query and Zod output folders.

**How to apply:** Preserve source-level OpenAPI changes, restore generated folders immediately after a failed codegen attempt, and treat repairing codegen as dedicated work rather than silently accepting deleted outputs.