# Leads header and scroll layout

Baseline revision: `07b0b350c6902b0405bcb45a4e08a92b491b213e`.
Frozen baseline: `.local/leads-layout-baseline/public`.
Reproduction: build the frontend with PORT=5000 and BASE_PATH=/, freeze the
baseline, then run `node scripts/desktop-workspace/leads-layout-check.mjs before`.
Build the candidate and run the same command with `after`.

## Results

- TypeScript check passed; frontend production build passed.
- Frontend unit tests: 184 passed, zero failed.
- Before and after: 60 cases each, covering admin/manager/rep, light/dark,
  widths 390/768/960/1023/1024/1280/1440, height 560, and both desktop sidebar states.
- All 24 phone/tablet control inventories match exactly.
- After: zero unexpected API 403/404/503; rep user-directory requests: zero.
- At admin 1024 × 560 unpinned, the records height increased from 98 to 166px.
  The empty bulk reservation disappeared and all sticky cells became opaque.
- Continuous loading reached 92 synthetic leads, beyond the first 50.
- Home/End, mouse wheel, actual native scrollbar dragging, search/sort scroll
  reset, conditional bulk actions, ordinary row navigation, independent phone
  action and email-composer navigation, and live breakpoint transitions passed.

## Evidence

- `before/results.json`: frozen baseline measurements and inventories.
- `after/results.json`: final passing measurements and flow results.
- Screenshots in both directories include 390/768 and short desktop widths,
  both themes, and scrolled header states.
- `after/admin-1024-native-scrollbar.png`: actual rendered native scrollbar.
- `unit-tests.log`: raw unit-test output.
- `build-before.log`, `build-after.log`: raw build output.
- `browser-after.log`: final browser-check output.
- Prior-check files retain harness failures. These were not application defects:
  headless Chromium initially hid the native scrollbar, contact selection found
  the hidden mobile branch, and the original email assertion wrongly rejected
  the intentional Lead Detail ?compose=email route. Breakpoint checks must return
  to Leads after that route change. The narrow confirmation reused the completed
  60 geometry cases and successful scrolling checks, then confirmed the corrected
  contact and breakpoint assertions without rerunning unchanged cases.

Each fixture used a disposable development-schema database and synthetic test
Clerk accounts, with delivery credentials removed and outbound requests blocked.
The final fixture deleted all three accounts, dropped the database and removed
its temporary directory. No production database writes, live calls or email sends.
No database migration, mobile control redesign, pipeline or Campaigns change.
Not published.
