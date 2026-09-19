---
name: Lender delivery safety
description: Immutable packet and ambiguous-email rules for lender submission changes.
---

Preserve the exact sent PDF in private storage; never implement historical downloads by rebuilding from current lead data.

**Why:** Lead details and documents change after sending, and an administrator's unmasked packet must not become accessible to a representative.

**How to apply:** Keep historical packet downloads authorization-checked, integrity-checked, audited, and non-cacheable.

Treat a timeout or unknown provider failure as an uncertain delivery, not a confirmed failure eligible for automatic retry.

**Why:** A provider can accept an email before the client loses its connection. A database failure after acceptance also cannot undo the send.

**How to apply:** Retain the durable pre-send reservation for uncertain outcomes and post-send finalization failures; only a proven rejection may release retry eligibility.