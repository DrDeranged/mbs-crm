---
name: Fixture authentication lifecycle
description: Browser-session and teardown boundaries for disposable Clerk fixtures.
---

Use a fresh browser context for each fixture role when signing in with Clerk
tickets. A valid ticket does not override an already active browser session.
Fixture teardown must be idempotent: an already-deleted test user must not
prevent cleanup of the other users or the isolated database.

**Why:** Reusing the admin context caused “You're already signed in” during
manager verification. An interrupted run also left a database behind after its
test users were deleted; a retry encountered a user-not-found response.

**How to apply:** Keep role contexts isolated, treat test-user deletion 404s as
already cleaned, and attempt every fixture cleanup step even if one fails.
These requirements are not guaranteed by older shared helpers.
