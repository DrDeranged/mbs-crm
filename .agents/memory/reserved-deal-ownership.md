---
name: Reserved-deal ownership convergence
description: Closeout ownership repair and reserved-rep sign-in reconciliation must agree on the final assignment state.
---

Once a reserved representative is active and owns a marked deal, maintenance must preserve that assignment. Assignment activity must be derived only from rows actually changed by a conditional update. Ownership closeout must operate only on rows that still match the seeded markers, tolerate converted or deleted seed rows, and fail only when no recognizable seeded rows remain.

**Why:** Closeout cleared valid Calvin assignments while sign-in reconciliation restored them, creating repeated clear/reconcile activity pairs on every cycle. Seeded deals are also expected to become real deals over time, so requiring the original full seed set makes routine closeout fail on normal business progress.

**How to apply:** Treat either an unassigned marked reservation or ownership by the matching reserved rep as valid. Count and verify only rows that still satisfy their seed markers, report the missing remainder as converted or deleted, and never log assignment activity from a pre-update candidate list.