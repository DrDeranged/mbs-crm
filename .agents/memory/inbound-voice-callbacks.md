---
name: Inbound voice callback lifecycle
description: Provider callback ordering and hangup behavior that affect durable voicemail follow-up
---

Treat the parent call, recording completion, and transcription as independent events. A caller hangup can skip the Record action; recording and transcription callbacks can arrive in either order or be retried. Do not infer a missed call at dial timeout before checking for a completed recording, and do not send transcript-dependent mail from the first recording callback when transcription is still pending.

**Why:** A plausible happy-path TwiML flow can lose hangup follow-up or send a duplicate/empty-transcript alert when Twilio delivers callbacks in a different order.

**How to apply:** Reconcile aged inbound calls against the provider and use durable claims for recording side effects and notification dispatch. Test callback order and retries separately from TwiML rendering.