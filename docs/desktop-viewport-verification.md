# Desktop viewport verification

## Scope

Desktop web Leads now fits its records, filters, actions, bulk controls and
pagination into the available workspace. The desktop shell is bounded to the
viewport while retaining contained scrolling for long content. Mobile and native
Expo interfaces were not redesigned. Nothing was published.

## Evidence

Synthetic, authenticated evidence lives in `reports/desktop-viewport/`.
The baseline bundle was retained in `.local/viewport-baseline/public`.
Verification used isolated schema-only databases, disposable test Clerk users,
disabled background jobs and blocked delivery endpoints, never customer data or
live communications.

- Before/after populated screenshots cover 1024×768, 1366×768, 1440×900 and
  1920×1080, both sidebar states and themes. After-state loading, empty and bulk
  screenshots cover the same matrix.
- The full matrix exposed two narrow empty-state overflows; focused measurements
  confirmed the corrected empty-state spacing in both affected themes.
- The floating phone initially intercepted pagination. Bottom controls now
  reserve a separate phone lane; actual Next and Clear clicks subsequently worked.
- Pending query metadata initially changed bulk-toolbar height. The selection
  prompt now remains stable during loading and remains accessible after adaptive
  pagination changes the visible page.
- Functional checks exercised pagination, bulk selection, all-matching safeguards,
  sorting, resizing, CSV download, Import opening, New Lead navigation, full-value
  details, phone-link destinations and the email handoff to the active Comms tab.
- Mobile control inventories matched at 390px and 900px. Manager/rep checks
  confirmed selection/import permissions, manager bulk Apply, manager/rep absence
  of Delete, rep export and contact links.
- Dashboard, Deals and lead details were inspected for document overflow.
  Legitimate long-content scrolling stays inside the desktop workspace.
- Frontend typecheck and production build passed. All six page-budget/range tests
  passed.

## Verification-script limitations

The saved reports intentionally retain failed assertions rather than rewriting
history. Early failures exposed real layout bugs, which were fixed and checked
with focused follow-ups. Later failures were script assumptions: phone anchors
use `tel:` rather than a data attribute; the email handoff consumes its query
parameter and selects the **Comms** tab; each fixture role needs its own browser
context; the manager status trigger is a combobox without the assumed accessible
name. The last assertion was corrected by scoping it to the bulk slot; the same
run had already confirmed bulk Apply rendered, and the status select is rendered
unconditionally beside it. That assertion correction was not browser-rerun.

The reusable runner is `scripts/desktop-workspace/viewport-check.mjs`.
It is not yet part of the publish gate and currently targets Chromium.
