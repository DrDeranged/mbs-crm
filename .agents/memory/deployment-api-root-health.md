---
name: Deployment API root health
description: Why the API mount root must return a successful lightweight health response.
---

Keep `GET /api` returning the same lightweight success response as the shallow health endpoint.

**Why:** Deployment monitoring was observed repeatedly probing the API mount root rather than the configured startup-health path. A 404 there produced a false outage even while the web root, authenticated API traffic, and `/api/healthz` remained healthy.

**How to apply:** When changing API routing or health checks, preserve a fast, unauthenticated, dependency-free 200 response at both the API mount root and the dedicated shallow health path.