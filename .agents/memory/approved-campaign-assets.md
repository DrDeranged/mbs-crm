---
name: Approved campaign assets
description: Integrity rule for campaign flyers included in approval-gated delivery.
---

Campaign approvals must bind uploaded or built-in creative to a server-computed content digest and immutable object generation. Client-supplied path, type, and size metadata are not sufficient.

**Why:** A presigned object can be overwritten without changing campaign metadata. Sending it later would bypass the approved content snapshot.

**How to apply:** Resolve flyer bytes on preview/approval, include digest and generation in the approval hash/snapshot, re-verify them before launch, and attach those verified bytes to the outgoing message.