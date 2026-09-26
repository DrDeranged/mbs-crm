---
name: Approved campaign assets
description: Integrity rule for campaign flyers included in approval-gated delivery.
---

Campaign approvals must bind uploaded or built-in creative to a server-computed content digest and immutable object generation. Client-supplied path, type, and size metadata are not sufficient.

**Why:** A presigned object can be overwritten without changing campaign metadata. Sending it later would bypass the approved content snapshot.

**How to apply:** Resolve flyer bytes on preview/approval, include digest and generation in the approval hash/snapshot, and re-verify them before launch. Attach verified bytes only in Attach mode.

Published library flyers used for Link delivery must keep their identity immutable for the lifetime of any signed URL, not just their bytes. Never fall back to a known development signing key.

**Why:** A generic template edit or archive can invalidate an already-issued link before its expiry even when the object itself has not changed; a known signing key would let outsiders forge links.

**How to apply:** Publish validated copies at server-owned keys, prevent generic mutation of published flyer records, require a configured signing secret, and verify the signed identity and current object generation/digest when serving the URL.