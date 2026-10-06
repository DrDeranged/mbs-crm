# Eight screenshots completed

Source: fd9816d3bf32fc221d11e2eb532be87cc585a968.

**8/8:** Leads at 390, 768, 1280 and 1440 pixels, light and dark.
See screenshots-evidence.json and the self-contained leads-gallery.html.
Each proof records viewport, actual theme, /leads URL, real API 200 readiness,
visible mobile cards or the applicable tablet/desktop table, and PNG SHA-256.

Four light captures are retained from shots-only-2026-10-06T04-47-56-071Z-10079.
That collector subsequently failed because it tried to use the Settings theme
control while still on Leads; its exit remains 1. Four dark captures completed
in shots-only-2026-10-06T04-51-24-064Z-10339, exit 0. The latter collector explicitly
returns to Settings before choosing the theme and supports a dark-only scope.
No role/interaction/campaign/preflight checks were repeated for this continuation.

The earlier collector failures are preserved: a missing bundled Chromium path
(before any browser launched), desktop-only readiness at 390, and fit-table-only
readiness at 768. The final collector uses system Chromium, actual mobile cards,
and visible lead anchors in either the legacy tablet table or the desktop fit table.
These were harness failures, not product changes.

Both accepted screenshot sections have zero observed 403/404/503, console errors,
page exceptions and request failures. Light: 213 HTTP 200 and 12 redirects;
dark: 248 HTTP 200 and 14 redirects. Their disposable fixtures were closed.
These are authenticated synthetic-admin captures with two fixture leads, not
production records. All frozen frontend/API pins stayed unchanged.

This is a combined, section-provenanced result, not a retroactive passing exit for
any failed aggregate runner. The schema-only migration limitation remains.
