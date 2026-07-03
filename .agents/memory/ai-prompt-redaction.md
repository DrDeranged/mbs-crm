---
name: AI prompt redaction scope
description: When building an AI feature that must not expose sensitive data, redact every free-text field, not just DB columns known to be sensitive.
---

When a feature has a "never expose SSN/DOB/address/raw payloads to the AI provider" requirement, it's not enough to exclude obviously-sensitive structured columns (SSN field, DOB field, address field). Any free-text field a human can type into is also a leak vector:

- Rep-authored notes
- SMS/email message bodies
- Email subject lines
- User-supplied "instruction" or "custom prompt" text passed alongside a generation request

**Why:** a code review caught that redaction was first applied only to notes/SMS bodies, but a user-typed "instruction" field and email subjects were still passed to the AI unredacted — a rep could paste a full SSN or address into either.

**How to apply:** write one shared `redactSensitiveText()` (regex-based: SSN patterns, date-like DOB patterns, long digit runs for account numbers, street-address patterns, ZIP) and apply it uniformly to *every* string that originates from free-text user input before it's concatenated into an AI prompt — including ones added later by feature requests (like an "additional instruction" box). Audit all call sites that build the prompt, not just the first draft.
