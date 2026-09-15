---
name: Lender package safety
description: Explicit document category selection and legacy signature evidence decisions.
---

Treat the persisted document category as authoritative for lender packages, not the
upload key or filename. Filenames may suggest a category in the upload form, but the
user must be able to correct that suggestion before uploading.

**Why:** Rep-uploaded statements do not carry the applicant flow's bankstatement key
prefix. Requiring that prefix omitted legitimate documents from production packages.
Filename matching remains unreliable and must not become an automatic package rule.

**How to apply:** Use historical key patterns only for legacy-category backfill.
Select current package documents by category and list unreadable PDFs as omissions
rather than silently dropping them. This is not content-level SSN detection.

Never infer a missing historical signing timestamp from submission time or infer a missing signature method.

**Why:** Legacy nullable metadata cannot establish signature evidence; substituting plausible values creates a false audit record.

**How to apply:** Render unavailable evidence honestly while preserving explicitly stored values for newer applications.