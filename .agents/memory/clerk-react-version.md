---
name: Clerk React Version Compatibility
description: @clerk/react@5.54.0 was a broken release; v6.x is the correct stable version. API changed significantly between v5 and v6.
---

## Rule

Always install `@clerk/react@^6` (currently `6.10.3`). Never use `5.54.0` — it was a broken release with broken `@clerk/shared` imports.

**Why:** `@clerk/react@5.54.0` published a release with import mismatches in `@clerk/shared` (wrong casing `loadClerkUiScript` vs `loadClerkUIScript`, and missing context exports like `SessionContext`). It was never working.

## API Changes (v5 → v6)

- `SignedIn`, `SignedOut`, `RedirectToSignIn` → removed. Use `<Show when="signed-in">` / `<Show when="signed-out">`
- `publishableKey` for ClerkProvider → use `publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY)` from `@clerk/react/internal`
- Add `proxyUrl={import.meta.env.VITE_CLERK_PROXY_URL}` unconditionally to `<ClerkProvider>`
- Sign-in/sign-up routes must be `/sign-in/*?` and `/sign-up/*?` (optional wildcard, exact pattern)
- `<SignIn routing="path" path={`${basePath}/sign-in`} />` — path must be full browser path

## Dependencies

- `@clerk/react@6.x` requires `@clerk/shared@4.x` (also recently published, needs `minimumReleaseAgeExclude`)
- API server using `@clerk/shared/keys` needs `@clerk/shared@^4.19.1` directly in its `package.json`
- Both `@clerk/react` and `@clerk/shared` must be in `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`

**How to apply:** Any time Clerk is set up or updated in this project, use v6 patterns above.
