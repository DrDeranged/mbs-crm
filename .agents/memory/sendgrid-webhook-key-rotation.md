---
name: SendGrid webhook key rotation
description: How to diagnose valid-looking SendGrid Event Webhook requests that consistently fail signature verification.
---

Do not use the generic Event Webhook API test notification as proof of signature verification; it can send sample events without signature headers. Use a saved integration test or a real controlled send and confirm the production callback plus retained event record.

If signature headers and exact raw-body bytes reach the app, the configured public-key fingerprint matches the key displayed by SendGrid, and verification still fails, rotate the Signed Event Webhook key in SendGrid instead of weakening verification.

**Why:** The generic test endpoint can successfully queue a callback without either signature header. SendGrid can also sign delivery events with a private key that no longer corresponds to the displayed verification key. Re-enabling signing generates a new key pair, so doing it merely to inspect state immediately makes the deployed key stale.

**How to apply:** First prove headers and raw bytes are present and compare only a safe key fingerprint. Read the current public key without toggling signing. If signed events still fail ECDSA verification, rotate once, update the configured verification key, publish the API service, and certify with one controlled real send. Continue failing closed throughout.