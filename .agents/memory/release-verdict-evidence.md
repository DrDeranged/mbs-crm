---
name: Release verdict evidence
description: Reporting rule for release-readiness verdicts.
---

Never issue a SHIP verdict in an Agent report unless the complete output from the authoritative preflight run is attached to that report.

**Why:** A summarized or previously observed green run is not sufficient evidence for release readiness; the exact transcript must show every ordered gate and the final PASS.

**How to apply:** Persist the final preflight output as an attachable report, verify all stage markers and the final PASS, and attach it in the same response as any SHIP verdict.

Run the full preflight with its normal environment rather than forcing production mode globally.

**Why:** Production-only email origin validation can falsely fail provider unit tests when the production URL is intentionally absent. Production build settings belong to build commands, not the entire test runner.

**How to apply:** Record the actual invocation and retain failed harness attempts alongside the final authoritative transcript.

Associate preflight markers with actual workspace command invocations.

**Why:** The full suite tests the preflight runner itself and emits mocked gate markers and verdicts. Counting every matching log line overcounts gates and can mistake simulated results for real execution.

**How to apply:** Verify the ordered eleven real command-associated gates and final outer verdict; retain the entire transcript without deleting unit-test output.