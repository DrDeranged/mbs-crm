---
name: Published API fingerprints
description: How to verify that a published static client and API process came from the intended matching revision.
---

Use an explicit, non-secret API revision in both startup logs and a response header on critical infrastructure routes. Verify that marker from the published URL before concluding that a production fix shipped.

**Why:** A deployment served the current static Clerk client while its API still exhibited an older proxy implementation: the expected startup diagnostics, request logging, structured error body, and proxy behavior were all absent. The client bundle alone gave a false signal that the whole release was current.

**How to apply:** For production-only auth, payment, webhook, or proxy fixes, check the live route's revision header and matching startup log after publishing. Do not report the production incident fixed until those markers and the user-visible flow both pass.