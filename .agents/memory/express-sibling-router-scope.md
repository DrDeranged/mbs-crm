---
name: Express sibling router middleware scope
description: Prevent one feature router's validation middleware from intercepting unrelated sibling routes
---

Middleware registered with `router.use(...)` inside a feature router still runs for every request passed into that router when the feature router itself is mounted without a path prefix. Scope feature-wide middleware to the feature's actual route prefix.

**Why:** A strict analytics query validator intercepted notification and system-health requests mounted later in the parent router, returning misleading 400 errors even though those endpoints and their own input schemas were correct.

**How to apply:** When a child router is mounted with `parent.use(childRouter)`, use `child.use("/feature-prefix", middleware)` or validate inside each handler. Include an integration test that mounts the child before an unrelated sibling route and confirms the sibling request passes through.