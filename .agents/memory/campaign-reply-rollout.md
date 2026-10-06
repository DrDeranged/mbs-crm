---
name: Optional campaign reply capture
description: Required campaign behavior before inbound Parse credentials and activation are configured.
---

Unconfigured or disabled inbound reply capture must leave each campaign's configured Reply-To intact; it must not prevent ordinary campaign sends.

**Why:** The user explicitly required this behavior during certification on 2026-10-05. Reply capture is an optional rollout, not a prerequisite for existing campaign email delivery.

**How to apply:** Verify the missing-secret and disabled-flag cases with a prohibited-live-delivery fixture. Only route replies to the capture subdomain when both configuration and activation are present. Report a certification failure if ordinary sends are blocked instead of preserving their configured reply destination.
