---
name: Email/Drip architecture
description: Key architectural decisions for email sending, drip automation, and security in the MBS CRM.
---

## Drip automation
- Drip job runs via `setInterval` in `src/index.ts` — not a worker thread; starts on boot.
- Auto-enrollment hook fires inside the `PUT /leads/:id/status` handler — wrapped in try/catch that logs warnings.

## SendGrid / email
- Without `SENDGRID_API_KEY`, emails are marked "sent" immediately — safe dev mode, no actual delivery.
- Without `SENDGRID_WEBHOOK_VERIFICATION_KEY`, webhook signature verification is skipped in dev but fails closed in production (`NODE_ENV=production`).

## Unsubscribe security
- **Why:** Unsigned unsubscribe URLs allow arbitrary email suppression.
- **How:** HMAC-SHA256 token over `sendId:email`, verified against the persisted email_sends row. In production, `UNSUB_SECRET` env var must be set — omitting it causes token generation to throw.
- Unsubscribe resolves by leadId (not email string) to avoid cross-account tampering.

## Click tracking
- Redirect target is validated as http/https — other schemes are blocked to prevent open redirect.
