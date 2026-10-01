---
name: Deployment API root health
description: Why the API mount root must return a successful lightweight health response.
---

Keep `GET /api` returning the same lightweight success response as the shallow health endpoint.

**Why:** Deployment monitoring was observed repeatedly probing the API mount root rather than the configured startup-health path. A 404 there produced a false outage even while the web root, authenticated API traffic, and `/api/healthz` remained healthy.

**How to apply:** When changing API routing or health checks, preserve a fast, unauthenticated, dependency-free 200 response at both the API mount root and the dedicated shallow health path.

Do not treat "listener opened" or a post-listen dynamic import as proof of responsive liveness. Measure HTTP responses throughout bootstrap, separately from application readiness.

**Why:** Publishing on a half-vCPU VM stalled even though local fresh-process tests completed in seconds. Module evaluation after `import()` still blocked the listening thread; production probes saw timeouts between port opening and application readiness.

**How to apply:** Keep heavy initialization off the public listener's event loop, retain business/schema readiness gating, and regression-test repeated liveness probes during imports. Local timings are not production VM timings.