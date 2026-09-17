---
name: Orval whitespace drift
description: Rerunning API codegen can add blank lines to the generated React client even when the OpenAPI contract is unchanged.
---

Treat whitespace-only changes in the generated React API client as generator drift, not a contract change.

**Why:** A verification-only codegen run added hundreds of blank lines while producing no schema or behavior changes.

**How to apply:** After codegen, inspect the generated diff. Keep real contract changes, but restore whitespace-only drift rather than committing it.