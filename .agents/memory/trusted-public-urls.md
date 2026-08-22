---
name: Trusted public URLs
description: Prevent request-header origin spoofing in links and server-rendered documents.
---

External URLs included in email, tracking, or server-rendered PDF HTML must be resolved from configured public URLs or a trusted platform domain. Do not use `Host`, `X-Forwarded-Host`, or `X-Forwarded-Proto` as a fallback.

**Why:** A user can control those headers in some deployments. Passing the resulting URL to a server-side renderer turns a logo or document asset into an SSRF target; it can also send outbound email links to an attacker-controlled host.

**How to apply:** Validate configured URLs and normalize them to an origin. In production, require HTTPS. Use a platform-provided deployment domain as the only fallback, with a localhost-only fallback reserved for development.