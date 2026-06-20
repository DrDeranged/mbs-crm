---
name: Pending secrets — user will add at end
description: List of all secrets that need to be set before Twilio and SSN encryption work in production
---

# Pending Secrets

User confirmed they will add all credentials at the end. Do not block builds on missing secrets.

## Secrets needed

| Secret | Purpose | Notes |
|--------|---------|-------|
| `ENCRYPTION_KEY` | AES-256-GCM for SSN encryption | 64-char hex (32 bytes). Pre-generated value in session history. App gracefully degrades — SSN stored as null if missing |
| `TWILIO_ACCOUNT_SID` | Twilio account | From Twilio console dashboard |
| `TWILIO_AUTH_TOKEN` | Twilio auth | From Twilio console dashboard |
| `TWILIO_PHONE_NUMBER` | Outbound caller ID | E.164 format e.g. +15550001234 |
| `TWILIO_TWIML_APP_SID` | TwiML App SID | Create in Twilio → Voice → TwiML Apps |
| `TWILIO_API_KEY` | Access Token key | Twilio console → Settings → API Keys |
| `TWILIO_API_SECRET` | Access Token secret | Created alongside TWILIO_API_KEY |

## Why
All Twilio routes return 503 when secrets are absent — no crashes, just disabled features.
SSN encryption throws if ENCRYPTION_KEY is missing, so the applications route needs a try/catch guard around encrypt() calls.
