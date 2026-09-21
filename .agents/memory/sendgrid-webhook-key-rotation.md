---
name: SendGrid webhook key rotation
description: How to diagnose valid-looking SendGrid Event Webhook requests that consistently fail signature verification.
---

If signature headers and exact raw-body bytes reach the app, the configured public-key fingerprint matches the key displayed by SendGrid, and verification still fails, rotate the Signed Event Webhook key in SendGrid instead of weakening verification.

**Why:** SendGrid can sign test and delivery events with a private key that no longer corresponds to the verification key shown in its webhook settings. Disabling Signed Event Webhook, saving, re-enabling it, saving, and updating the app with the newly generated public key restored successful verification.

**How to apply:** First prove headers and raw bytes are present and compare only a safe key fingerprint. If they match but ECDSA verification fails, rotate the SendGrid webhook signing key, update the configured verification key, publish, and confirm with Test Integration. Continue failing closed throughout.