# Deals pipeline fix — focused verification, 2026-10-07

**Result:** focused checks pass. No production records changed, and nothing
was published. These checks preceded the requested GitHub push; its exact
source manifest is in `github-source-pin.json`. This is not a full preflight
or a production certification.

## What changed

- Desktop Kanban stages have bounded vertical scrolling; wheel and keyboard
  End reach the final card. The header and totals footer remain accessible.
  Compact cards retain a readable minimum width, so the board also scrolls
  horizontally at 1024px and 1280px rather than squeezing nine columns into
  unusable cards. Comfortable mode uses wider cards. Nine compact columns fit
  the tested 1440px viewport.
- The deal list automatically loads later API pages; it is not silently capped
  at the endpoint's default 25 deals or the requested 100-deal page size.
- Unlinked deals display their own stored, non-numbered business labels instead
  of a generic “Deal.” Company/contact/phone/email fields come only from an
  authorized linked lead. Missing or inaccessible links are not guessed, and
  reps cannot search a linked deal's stored label without lead access.

## Results

- API route tests: **7 passed, 0 failed** (`api-tests.txt`).
- Web identity and board tests: **11 passed, 0 failed** (`web-tests.txt`).
- API and web typechecks: **passed** (`api-typecheck.txt`,
  `web-typecheck.txt`). `git diff --check`: **passed**.
- Authenticated disposable-clone browser: desktop scrolling, wheel, keyboard,
  card identity, and responsive/density matrix **passed** at 1024×600,
  1280×720, and 1440×900 in light and dark, compact and comfortable
  (`desktop-and-drag-results.json`; 12 screenshots named `desktop-*.png`).
- Submitted → Approved drag persisted after reload; 390px/768px retained their
  narrow-layout order and horizontal Kanban behavior (same browser result and
  `deal-drag-drop-persisted.png`).
- Manager and rep identity checks, table horizontal overflow, phone/email
  handoff without triggering the card, rep suppression of private linked
  contact fields and `/api/users` requests: **passed**
  (`role-and-mobile-results.json`; `deals-table.png`,
  `rep-private-identity-check.png`). Each role had an isolated browser context.
- A separate fixture with **111** authorized deals was fetched as pages of
  **100 + 11**; all 111 distinct card links rendered, and keyboard End reached
  the bottom (`playwright-results.json`, `multipage-run.log`).
- Each browser run cleaned up its three synthetic Clerk users, disposable
  database, and temporary directory (`cleanup.json`). Authenticated tests
  operated against the isolated clone; they did not write production data.
- Final development workflows are running. API `/api/healthz` returned
  `{"status":"ok","phase":"ready"}` with 69 applied migrations.

The first browser pass stopped at an overstrict assertion requiring all nine
columns to fit simultaneously at 1024px. That produced narrow, unreadable
cards, so the final acceptance rule uses horizontal scrolling at shorter
desktop widths. A later role test's first attempt used a second Clerk ticket
on the same signed-in page; the follow-up used separate contexts and passed.
The raw earlier failure remains in `focused-run-results.md`; the passing
follow-up results are listed above.

## Production data limitation

The read-only audit in `production-identity-audit.md` found 26 of 30 stored
deals without a linked lead, although all 26 have a stored business label.
Those names now display. Contact data cannot appear for those records until
each is connected to the correct lead through an authorized data workflow.
No name-based lead matching or production backfill was performed.
