---
name: SendGrid webhook key rotation
description: How to diagnose valid-looking SendGrid Event Webhook requests that consistently fail signature verification.
---

Do not use a URL-only Event Webhook API test notification as proof of signature verification; it can send sample events without signature headers. Passing the existing webhook's `id` along with its URL to the official test endpoint can produce a signed callback. Confirm the production callback is accepted and event rows are retained, rather than trusting the API's 204 response alone.

If signature headers and exact raw-body bytes reach the app, the configured public-key fingerprint matches the key displayed by SendGrid, and verification still fails, rotate the Signed Event Webhook key in SendGrid instead of weakening verification.

**Why:** A URL-only test returned 204 but its callback lacked signature headers and failed closed; the same endpoint with the saved webhook ID returned 204 and its signed callback was accepted and retained. SendGrid can also sign delivery events with a private key that no longer corresponds to the displayed verification key. Re-enabling signing generates a new key pair, so doing it merely to inspect state immediately makes the deployed key stale.

**How to apply:** First prove headers and raw bytes are present and compare only a safe key fingerprint. Read the current public key without toggling signing. If signed events still fail ECDSA verification, rotate once, update the configured verification key, publish the API service, and certify with one controlled real send. Continue failing closed throughout.

Key length and the first six base64 characters are not an equality check.

**Why:** Different ECDSA public keys can have the same encoded length and DER-header prefix. A stale deployed key and the current provider key can therefore match both requested metadata fields while rejecting every signed event.

**How to apply:** Compare the normalized-key SHA-256 fingerprint from the live verifier with the current read-only SendGrid configuration. If those differ, replace the configured verification key with the existing provider key before considering any signing-key rotation. Raw-body presence and matching Content-Length prove capture, not byte-for-byte transit integrity; the accepted provider-signed callback supplies that final proof.