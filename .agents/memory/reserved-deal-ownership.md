---
name: Reserved-deal ownership convergence
description: Closeout ownership repair and reserved-rep sign-in reconciliation must agree on the final assignment state.
---

Once a reserved representative is active and owns a marked deal, maintenance must preserve that assignment. Assignment activity must be derived only from rows actually changed by a conditional update.

**Why:** Closeout cleared valid Calvin assignments while sign-in reconciliation restored them, creating repeated clear/reconcile activity pairs on every cycle.

**How to apply:** Treat either an unassigned marked reservation or ownership by the matching reserved rep as valid. Never log assignment activity from a pre-update candidate list.