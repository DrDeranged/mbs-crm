---
name: Lender package safety
description: Conservative document selection and legacy signature evidence decisions.
---

Prefer omitting uncertain documents from lender packages rather than broadening filename matching.

**Why:** The user explicitly requires protection against accidentally appending tax, identity, or other documents containing unmasked SSNs. A generic “statement” filename is not evidence of a bank statement.

**How to apply:** Keep explicit bank-statement identification and sensitive-name exclusions until a trustworthy document classification workflow exists; list omissions rather than silently dropping them. This is a selection safeguard, not content-level SSN detection.

Never infer a missing historical signing timestamp from submission time or infer a missing signature method.

**Why:** Legacy nullable metadata cannot establish signature evidence; substituting plausible values creates a false audit record.

**How to apply:** Render unavailable evidence honestly while preserving explicitly stored values for newer applications.