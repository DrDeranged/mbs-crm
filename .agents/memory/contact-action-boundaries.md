---
name: Contact action boundaries
description: Product constraints for lead/deal contact actions and linked-lead ownership.
---

An authorized deal does not grant access to its linked lead. Lead-owned documents, notes, tasks and communications must use only a separately authorized linked lead. If that link is unavailable, explain the limitation rather than claiming success.

**Why:** The product requires reps to retain their existing record ownership boundaries even when deals and leads have different owners.

**How to apply:** Keep related-record enrichment and action targets permission-scoped. A terminal status is not an action authorization rule; preserve financial validation, signed-document immutability and application-scoped SMS consent independently.

Contact identity is company first, contact second. A truly unlinked deal may display its own stored, non-numbered business label; a linked deal whose lead is missing or inaccessible must retain a neutral unavailable label, never fall back to the stored name.

**Why:** Reps need consistent contact identification without changing stored business labels or historical evidence. The user reported legitimate legacy pipeline business names disappearing as “Deal”; preserving authorized deal-owned metadata must not expose an inaccessible linked lead.

**How to apply:** Use structured, authorized record data for current labels rather than editing historical text or inferring private contact details. Keep an unlinked business label separate from company/contact fields, do not invent lead links, and continue suppressing visible deal numbers.

Mobile-web contact calls always use the device's native phone link, including landscape/touch layouts. Desktop CRM calling requires an actually registered, idle device, not merely an open dialer. Detail action areas must stay usable while scrolling without another floating control covering them or form fields.

**Why:** Reps need reliable native calling on phones and genuinely available CRM calling on desktop; an apparently open dialer or overlapping control does not satisfy that requirement. A retained communication-history Call button previously bypassed shared routing despite passing helper tests.

**How to apply:** Keep device availability, viewport layout and related-record authorization separate. Rendering a number must never initiate a call. Check retained Call buttons as well as new links/toolbars, and exercise an actual component click rather than only the routing helper.