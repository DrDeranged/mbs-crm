---
name: Expo tabs auth boundary
description: Preventing signed-out Expo Router launches from mounting protected tab screens before redirecting.
---

Guard the tabs layout itself with the resolved Clerk auth state before rendering tab children. Keep the root layout responsible for navigation between the sign-in route and the tabs group.

**Why:** In Expo Router, a route-group index can own the root URL. An effect-based redirect in the root layout may run only after tab children mount, causing signed-out protected requests. Replacing the root layout with a redirect can also leave web preview launch on an empty transition state.

**How to apply:** For authenticated tab apps, return no content while auth loads and return a sign-in redirect from the tabs layout when signed out. Let the root stack stay mounted and perform the route replacement after auth resolves.