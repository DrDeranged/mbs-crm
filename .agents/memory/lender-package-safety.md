---
name: Lender package safety
description: Trusted upload-key document selection and legacy signature evidence decisions.
---

Treat the trusted upload key as the document category for lender-package bank statements: only
keys under `/documents/bankstatement-` with PDF metadata are eligible. A filename is display
metadata, not a category.

**Why:** The upload workflow assigns the bankstatement key category to bank statement documents.
Filename matching is unreliable and can both omit valid statements and classify unrelated documents.

**How to apply:** Require the trusted upload-key category and PDF check, then list omissions rather
than silently dropping them. This is a selection safeguard, not content-level SSN detection.

Never infer a missing historical signing timestamp from submission time or infer a missing signature method.

**Why:** Legacy nullable metadata cannot establish signature evidence; substituting plausible values creates a false audit record.

**How to apply:** Render unavailable evidence honestly while preserving explicitly stored values for newer applications.