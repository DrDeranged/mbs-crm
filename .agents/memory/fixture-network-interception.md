---
name: Fixture network interception
description: Prevent misleading empty-state results in PWA browser fixtures using mocked HTTP responses.
---

For mocked HTTP checks in the CRM PWA, block service workers in the fixture browser context and prove that the expected list, count and mutation endpoints were intercepted before relying on UI assertions.

**Why:** A signed-in fixture showed real empty notification panels while the test expected synthetic rows. Those timeouts were harness failures, not evidence that the notification interaction failed. PWA workers can bypass page-level interception, and endpoint patterns must cover nested count/read paths.

**How to apply:** Record intercepted methods/paths, use complete endpoint matching and distinguish setup failures from application assertion failures.