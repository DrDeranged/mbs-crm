---
name: Lender delivery safety
description: Immutable packet and ambiguous-email rules for lender submission changes.
---

Preserve the exact sent PDF in private storage; never implement historical downloads by rebuilding from current lead data. Newly generated lender packages include available full SSNs for every otherwise-authorized package user.

**Why:** Lead details and documents change after sending. Full SSNs are now a standard protected-package disclosure rather than an administrator-only option, so ordinary lead authorization—not a separate unmask role gate—controls access.

**How to apply:** Keep historical and live packet downloads authorization-checked, integrity-checked where stored, audited, and explicitly non-cacheable.

Treat a timeout or unknown provider failure as an uncertain delivery, not a confirmed failure eligible for automatic retry.

**Why:** A provider can accept an email before the client loses its connection. A database failure after acceptance also cannot undo the send.

**How to apply:** Retain the durable pre-send reservation for uncertain outcomes and post-send finalization failures; only a proven rejection may release retry eligibility.