---
name: Web hook test resolution
description: Real Node test-runner constraints when exercising hooks that import the generated client.
---

Exercise new hook regressions under the project's actual test command before running the full preflight.

**Why:** A hook test passed when launched with tsx, but failed under native Node type stripping because the generated client has extensionless TypeScript imports. Type stripping does not provide that resolution.

**How to apply:** For tests needing that import graph, use the existing workspace TypeScript resolver locally. Do not change the entire test runner or add a dependency just to make one hook test resolve.
