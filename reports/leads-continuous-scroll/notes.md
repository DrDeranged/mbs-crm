# MBS CRM Leads continuous-scroll test

Date: current test session
Scope: Synthetic read-only fixture data in a Clerk-authenticated browser; no customer records or mutations.

## Observations

- At 1280x720, desktop Leads initially rendered 50 of 137. The `Leads list` region overflowed (scrollHeight 3085px, clientHeight 314px); no Previous/Next buttons were present.
- Scrolling fetched desktop pages 1, 2, and 3 at limit=50. The final list contained 137 rows and 137 unique detail IDs (91000–91136); ID 91000 remained first. The header and filters remained visible while the table region scrolled.
- Search `NeedleBeacon` sent `search=NeedleBeacon`, limit=50, page=1, and returned only synthetic lead 91001. The region reset to scrollTop=0.
- Clearing search restored 50 rows at scrollTop=0; scrolling the unfiltered desktop list then showed 100 loaded. Captured desktop page requests include page=1 and page=2 at limit=50.
- Status `contacted` returned only synthetic lead 91001. Activity sort changed `sortBy` from `updatedAt` to `lastActivityAt`; `sortOrder` remained `desc`.
- Clicking the company/name link navigated to `/leads/91000`, not an email-compose URL. No phone/email action was initiated.
- At 390x844 and 768x900, the paginated path displayed 20 rows, Previous/Next controls, and 137 total. Next advanced to entries 21–40. Captured mobile requests include page=1 and page=2 at limit=20; 768px had no `Leads list` infinite-scroll region.

## Captured request parameters

- Desktop: `limit=50`, `sortBy=updatedAt`, `sortOrder=desc`, pages 1–3.
- Search: `search=NeedleBeacon`, `limit=50`, `sortBy=updatedAt`, `sortOrder=desc`, `page=1`.
- Status: `status=contacted`, `limit=50`, `sortBy=updatedAt`, `sortOrder=desc`, `page=1`.
- Sorted: `status=contacted`, `limit=50`, `sortBy=lastActivityAt`, `sortOrder=desc`, `page=1`.
- Mobile/tablet: `limit=20`, `sortBy=updatedAt`, `sortOrder=desc`, pages 1 and 2.

## Issues / caveats

- Some browser resources logged HTTP 403 errors. Clerk emitted development-key and structural-CSS warnings; service-worker registration was blocked as requested.
- During Vite hot updates, React logged a Hooks-order change in Leads and an error boundary appeared. A reload restored the Leads view and subsequent checks completed.
- At 768x900 the paginated table was horizontally clipped/scrollable beside the desktop sidebar.
- Evidence screenshots are available as browser-session observations `m6r7c4` (desktop 1280x720), `c4v2c5` (mobile 390x844), and `31l77a` (768x900). The browser tool did not expose a supported way to write those captured images to this directory.
