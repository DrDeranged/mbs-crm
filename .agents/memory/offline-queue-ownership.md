---
name: Offline queue ownership
description: Account boundaries and legacy migration policy for mobile offline changes.
---

Offline mutations should be associated with the account that queued them and replayed only when that account is signed in. Older entries with no owner must remain blocked for review rather than being automatically claimed by whichever account signs in next.

**Why:** On a shared device, automatically replaying an ownerless or another account's queued change sends customer data under the wrong identity. The old storage format does not contain enough evidence to infer the correct account, and deleting those changes silently would also lose work.

**How to apply:** Preserve ownership checks in any offline queue, retry, sign-out, account-switch, or migration change. If adding legacy recovery, require an explicit, safe review flow rather than silent automatic replay.