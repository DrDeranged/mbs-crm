---
name: Pending encryption secret
description: Reminder to verify the SSN encryption secret without assuming Twilio credentials are absent
---

# Pending Secrets

Earlier user guidance was to defer credentials until they were ready. The project environment now lists the Twilio credentials as available; do not assume they are still pending. Check the encryption secret through the approved secrets flow before work that requires it.

## Secrets needed

| Secret | Purpose | Notes |
|--------|---------|-------|
| `ENCRYPTION_KEY` | AES-256-GCM for SSN encryption | 64-char hex (32 bytes). Pre-generated value in session history. App gracefully degrades — SSN stored as null if missing |

## Why
SSN encryption throws if ENCRYPTION_KEY is missing, so the applications route needs a try/catch guard around encrypt() calls.
