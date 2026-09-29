---
name: Trusted public URLs
description: Prevent request-header origin spoofing in links and server-rendered documents.
---

External URLs included in email, tracking, or server-rendered PDF HTML must be resolved from configured public URLs or a trusted platform domain. Do not use `Host`, `X-Forwarded-Host`, or `X-Forwarded-Proto` as a fallback. Outbound email is stricter than other public URLs: in production it must use the configured canonical CRM origin, never a platform deployment domain.

**Why:** A user can control those headers in some deployments. Passing the resulting URL to a server-side renderer turns a logo or document asset into an SSRF target; it can also send outbound email links to an attacker-controlled host. Platform domains are stable enough for other public links but expose an internal host in customer email.

**How to apply:** Validate configured URLs and normalize them to an origin. In production, require HTTPS. For non-email public links a platform-provided deployment domain remains a permissible fallback. For email require the canonical app origin in production and permit localhost-only fallback in development; check rendered content at the dispatch boundary.