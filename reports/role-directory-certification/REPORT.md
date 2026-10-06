# Role-directory and release checks

Source under test: **fd9816d3bf32fc221d11e2eb532be87cc585a968**.
All 886 runtime/configuration source files match its GitHub tree.
Nothing was published. No live campaign was sent.

## Implemented behavior

- Reps do not query the user directory, including while identity is unresolved.
  Cached directory data and manual directory refetch are also guarded.
- Directory-backed rep filters and new/edit assignee pickers are hidden for reps.
  Managers and admins retain their directory-backed controls.
- The approved structure policy has exactly three exception categories:
  Search referrer, Share referral link, and rep Retry removal. The explicitly
  requested rep-directory hiding is a separate narrowly scoped role policy.
- An accessible lead with no application returns 200/null, not a normal-state 404.
- Browser telephony checks authenticated readiness before requesting an
  unconfigured token or owned-number service. Genuine provider errors are not
  converted into successful responses.
- Direct rep campaign navigation renders the manager-access restriction without
  mounting manager-only campaign queries.
- Deal-submission metadata reads follow the documented deal-access boundary:
  admin/manager readers, or the assigned rep. Unassigned reps and pending users
  remain denied. Lender-package and submission-mutating permissions are unchanged.

## Passed sections and provenance

1. **Full 11-gate preflight: PASS**, exit 0, on the source above.
   Unit totals: **729 passed, 1 skipped, 0 failed**. Build smoke also passed.
   The migration ledger includes migrations 067–068.
2. **Mobile structure: 36/36 PASS**, six pages, 390/768, admin/manager/rep.
   Captures came from 4598003. Its frontend source, frozen web bundle and HTML
   remain byte-identical on fd9816d. Both HTTP observation streams show zero
   structural-case requests to the only subsequently changed endpoint,
   GET /api/deals/:id/submissions. This is retained evidence, not a new capture.
3. **Rep policy: 11 routes**, no directory controls, zero /api/users list requests.
   Direct Campaign 5 navigation showed Manager Access Required and zero child
   campaign-support reads.
4. **Fresh role/security checks: 13 completed** on fd9816d. Admin/manager/assigned
   rep submission reads returned 200. Manager/admin representative filters and
   new/edit assignee controls passed; edits were cancelled without saving.
5. **Leads interactions: 13 passed**, with real API bodies and DOM IDs:
   name/company search, contacted/type/rep filters and resets, oldest sorting,
   blank-row no-op, phone action, email/detail communication, and name/company
   detail navigation. Repeated query states reuse previously observed 200 bodies
   and verify DOM/filter state rather than inventing a new HTTP response.
6. **Historical Campaign 5 Results/Metrics: PASS**, both 200, Sent 13 in the
   existing Results display and new Performance KPI panel. This is a synthetic
   reconstruction of the existing historical snapshot, not a live-production UI
   session. Unavailable historical click/reply/conversion metrics say Not tracked.

The immediate pre-853f4e4 source, 1316888, had no desktop TableRow onClick handler.
Whole-row navigation was therefore not restored. Name/company navigation and
independent contact actions passed; blank-row clicks remain no-ops.

## Browser error classification

Authorized UI paths for **admin, manager and rep** have **zero observed
403/404/503 responses and zero console errors** in retained/fresh valid sections.
This is not a claim that every raw historical/probe event is zero.

- Original manager Deal Detail GET /api/deals/:id/submissions: two 403 requests
  and two matching console events. **Defect**, fixed by fd9816d; fresh manager
  reads returned 200 and the picker checks passed. Original failures are preserved.
- Explicit unassigned-rep and pending-user security probes: one 403 each and one
  matching console event each. **Expected access-denial probes**, not UI queries.
- Four requests were aborted during detail navigation: /api/deals,
  /api/referrals/lead/1, /api/leads/:id/campaign-engagement and
  /api/leads/:id/campaign-replies. They are retained as net::ERR_ABORTED request
  failures, not reclassified as clean HTTP responses or 403/404/503 errors.
- Old baseline errors are from the separately identified old application build.
  API workflow GET / probes are platform requests, not browser certification
  navigation. No backend RBAC was weakened to silence those probes.

## Reply capture

The unchanged real-sender regression runs in this source's full preflight:
seven configurations cover absent/blank/disabled settings and explicit opt-in.
Unconfigured capture sends with the campaign's configured Reply-To; explicit
enabled capture plus a usable secret produces the tokenised address. Capture-off
does not reject a send.

The read-only production configuration snapshot checked at
2026-10-06T02:04:45.699Z found neither inbound Parse secret nor enabled flag.
See ../opt-in-recertification/production-capture-configuration.json and
sender-regression-evidence.json. No production setting was changed; prospective
fixed sender behavior was tested without publishing or sending live mail.

## Migration tail and limitation

Actual gate 9 reports **DB clone source: schema-only**. Gate 10 passed migration
rehearsal and gate 11 passed divergence:

```text
POPULATED-SCHEMA initial no-ledger reconciliation: applied=63, ledger=68|1, baseline SQL skipped
POPULATED-SCHEMA retry: applied=0, adopted=000_baseline, constraints/indexes unchanged
MIGRATION REHEARSAL PASS
PREFLIGHT 11/11: database divergence
Clone-only ledger rows: none
Dev-only ledger rows: none
Changed ledger rows: none
Clone-only tables: none
Dev-only tables: none
Clone-only columns: none
Dev-only columns: none
Changed columns: none
DB DIVERGENCE PASS
PREFLIGHT PASS
```

**A verified production-data backup was not available. Production-data migration
rehearsal is NOT certified and no SHIP/release approval is issued.** The complete
unabridged passing transcript is preflight.txt, not the abbreviated tail above.

## Interrupted and failed harnesses

The original browser task was interrupted by a workspace restart; it has no
passing terminal exit. Later focused attempts encountered a historical-fixture
row-count assumption, a cache-unaware HTTP waiter, and a mobile/desktop screenshot
selector mismatch. Those raw failures and their fixture cleanup remain in this
directory. Successful independent sections are retained with explicit pins.
No failed or interrupted task is retroactively relabelled PASS.

Screenshot completion is recorded separately in SCREENSHOT-STATUS.md.
The tracked GitHub tree excludes test-results/.last-run.json.
