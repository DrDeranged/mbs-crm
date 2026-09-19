---
name: Release verdict evidence
description: Reporting rule for release-readiness verdicts.
---

Never issue a SHIP verdict in an Agent report unless the complete output from the authoritative preflight run is attached to that report.

**Why:** A summarized or previously observed green run is not sufficient evidence for release readiness; the exact transcript must show every ordered gate and the final PASS.

**How to apply:** Persist the final preflight output as an attachable report, verify all stage markers and the final PASS, and attach it in the same response as any SHIP verdict.