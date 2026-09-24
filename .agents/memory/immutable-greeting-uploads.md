---
name: Immutable greeting uploads
description: Why media validated from a temporary signed upload must not be played from that same object.
---

Validate greeting audio from a staging object, then copy the accepted bytes into a new server-owned playback object. Never save the staging object's path as the live greeting.

**Why:** A short-lived signed PUT remains usable after validation. If the live greeting shares that object, an uploader can replace approved bytes during the grant's remaining lifetime. Twilio could then play audio that was never validated.

**How to apply:** For any direct-to-storage upload whose accepted bytes become a trusted immutable asset, cap reads, validate actual content and size, then publish a copy that no client upload grant can overwrite.