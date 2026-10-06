# Pre-deploy validation — c6fc40fa76880972ad2d8b1226ef0fb45c5890ca

**Preparation only. Do not launch browser tests or publish from the tester shell.**
Main must start the authorized runner as a managed background task after confirming
source/dependency/build readiness. The pinned source is
`/tmp/predeploy-c6fc40f-source` (tree `7fad71128600161b469e35da5cc52d03a7a5db00`,
1,580 GitHub blobs SHA-1 verified; requested commit and observed `main` both
`c6fc40fa76880972ad2d8b1226ef0fb45c5890ca`). Workspace `HEAD` is different:
never import or build app code from `/home/runner/workspace`.

## Verified structure provenance

The archived baseline is present in the pinned GitHub tree and is **not**
blocked on a Nate-workflows manifest. `reports/opt-in-recertification/approval-manifest.json`
pins the archived exemptions and strict 36-case remainder;
`reports/structural-certification-2026-10-03/after/role-controls.json` and
`after/exempt-controls.json` supply the original captured control/exemption
inventory. The archive is bound by the pinned source receipt and the workspace
`source-pin.json` (blob verification). Use those JSON inventories directly; do
not rebuild a rendered baseline or invent exceptions.

Overlay only the manifest's two Lead Detail additions and rep Retry removals,
plus the request-approved Leads Lead Source filter / admin-manager bulk-assign
controls and Campaign Audience Deals filter. The latter controls remain
independent assertions where they are not in the original 36 cases. Every other
difference fails. The pinned `reports/role-directory-certification/policy.json`
and certification runner also retain role/assignment/error checks, but their
old target authorization/baseline is not the c6fc40f launch authorization and
must not be used unchanged.

Main's managed 11-gate preflight is identified as job `yFsfv5kY`; its state is
recorded in `preflight.raw.log` and `readiness.json`. The latest observation
showed `PREFLIGHT PASS`. This remains a production-readiness signal, not a
browser-phase gate: the runner records PASS/FAIL/incomplete status but requires
only the verified pin plus Main-frozen pinned API/web builds and ordinary
isolated-fixture prerequisites. Separately, the available database clone reports
`sourceKind=schema-only`, which fails the actual-production-clone requirement;
that limitation has been reported and must not be conflated with the 11-gate
preflight result. No browser run has been started.

## Pinned-root preflight/build commands (Main only)

```bash
set -o pipefail
cd /tmp/predeploy-c6fc40f-source
pnpm run preflight 2>&1 | tee /home/runner/workspace/reports/predeploy-c6fc40f/preflight.raw.log
# Require all 11 gates PASS; ledger expects 68 and no pending migrations beyond 067–068.
PORT=4320 BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/api-server run build
PORT=4320 BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/mbs-crm run build
```

After Main's smoke builds finish, copy/check them into immutable report-local
snapshots using `--freeze-builds-only`; run the candidate API/UI only from those
fingerprint-verified frozen builds. A failed preflight must still be reported as
a production-readiness concern, but does not suppress independent browser
checks when pinned builds are available. Use the pinned
`scripts/visual-refresh/sandbox.mjs` fixture isolation, and preserve evidence
under this directory. Never start live communications, credit pulls, or
production writes. The only HTTP error exception is the explicitly documented
fixture Twilio credential 503.

## Focused phases

Run each phase independently; stop reporting that phase at its first confirmed
defect, while allowing independent phases to continue:

1. `preflight`: 11 gates, migration ledger (expected 68; only 067–068 pending).
2. `structure`: 390/768 × admin/manager/rep. Compare to the provenance-verified
   certified baseline, allowing only: Lead Detail Search referrer and Share
   referral link; rep Retry removal on Leads/Pipeline; Leads Lead Source filter
   and manager/admin bulk-assign controls; Campaign Audience Deals filter.
   Report every additional difference as a failure.
3. `assignment`: every active admin/manager/rep (including actor self) and no
   pending/inactive/merged users in all five assignment pickers; admin self-save,
   manager can assign anyone; reps make zero directory requests, have no picker,
   and get no 403.
4. `identity`: Company — Customer across Deals list, Pipeline cards, deal
   header, referral panel, ⌘K, notifications; no visible Deal #/bare numeric
   deal label.
5. `leads`: source counts/options include US Fund Advisor, vendor_list,
   prospect_list, Website; USFA selection returns only USFA. Bulk-assign exactly
   two fixture leads and verify both persisted; rep has no bulk control.
6. `audience`: fixture preview counts for All / Only open deal / Exclude open
   deal partition correctly; archived and funded/closed deals are not open.
7. `campaign-send`: launch a separate one-recipient campaign whose preview
   audience is exactly 1; verify the actual launch response Sent=1, raw provider
   payload target, Parse unset, and captured Reply-To exactly matching that
   campaign's configured Reply-To. Independently run the synthetic Campaign 5
   UI fixture with 13 API-created recipients and verify its own Results UI
   Sent=13. Use the **existing** provider transport-202 capture/hook in
   `reports/focused-final-8622188`; no campaign-send API mocks and no real
   provider sends. The two campaigns have separate evidence; the 13-recipient
   Campaign 5 run does not substitute for, or prove, the one-recipient case.
8. `http-errors`: each role × Dashboard, Leads, Lead Detail, Deals, Campaigns,
   Settings. Capture all console/network 4xx/5xx and request paths; allow only
   documented fixture Twilio 503s.

Store sanitized raw JSON/NDJSON, screenshots, commands, source/build provenance,
phase verdicts, and cleanup records here. Redact credentials, signed/opaque
URLs, and PII before writing evidence. No product source edits or publishing.

## Production Campaign 5 evidence

`campaign-5-production-readonly.json` now contains successful read-only evidence:
Campaign 5 is “Vendors — Heavy Equipment”, completed, Sent=13. Its schema query
confirms the actual ledger column is `campaign_launches.sent_count`; the earlier
failed `r.sent_at` attempt is not used. The test UI/API must still be described
as an anonymized disposable fixture derived from that aggregate, not a production
UI session or production write.

## Managed launch

The phase-addressable, report-local launcher is `run-predeploy.mjs`.
`--check-ready-only` verifies the source receipt, reports the preflight state,
and verifies whether a frozen pinned build pair exists; it never launches a
browser. `--freeze-builds-only` is for Main to run after smoke builds; it copies
the pinned API and web outputs into a new immutable-by-policy report-local
snapshot and records source/copy fingerprints. Browser phases refuse to start
without a verified snapshot. `--prepare-only` seeds only the canonical archived
JSON controls into a new isolated evidence directory, patches a report-local
derivative of the pinned harness, and syntax-checks that derivative plus the
provider-gated sandbox; it also does not launch a browser. These preparation
checks have verified the exact commit/tree/1,580-blob receipt and 36-case
inventory. Source-root API/web builds are present, but no frozen snapshot has
been made from this tester session and no browser run has started:

```bash
node reports/predeploy-c6fc40f/run-predeploy.mjs --check-ready-only
node reports/predeploy-c6fc40f/run-predeploy.mjs --prepare-only
```

After Main completes the pinned smoke builds, Main should freeze and recheck
them. Preflight status is recorded but does not block the phases:

```bash
node reports/predeploy-c6fc40f/run-predeploy.mjs --freeze-builds-only
node reports/predeploy-c6fc40f/run-predeploy.mjs --check-ready-only
```

Available browser phases, each launched separately by Main as a managed
background task, once the pin and frozen builds verify:

```bash
PREDEPLOY_MANAGED_RUN=1 node reports/predeploy-c6fc40f/run-predeploy.mjs --phase=structure
PREDEPLOY_MANAGED_RUN=1 node reports/predeploy-c6fc40f/run-predeploy.mjs --phase=core
PREDEPLOY_MANAGED_RUN=1 node reports/predeploy-c6fc40f/run-predeploy.mjs --phase=campaign-send
```

`structure` captures and compares 390/768 × admin/manager/rep (all pinned
baseline routes plus Campaign Audience), with the request-approved allowlist.
`core` runs that full route capture plus the pinned workflow behavior suite:
active assignment directory/self-save/manager access/rep denial, source counts
and Lead Source filtering, explicit and filtered bulk assignment, referral/deal
API identity checks, and audience selector/preview/save-staleness assertions.
It also performs the real-fixture Company — Customer visual sweep across Deals
list, Pipeline cards, deal header, referral panel, ⌘K and notifications. The
notification item is generated through a workflow API rule and lead-update
handler. Screenshots and UI assertions are captured by the derived harness.
It collects route console/page/network 4xx/5xx paths and allows only Twilio 503.
The assignment/source/audience/error assertions run before final comparison
failure is reported; a blocked comparison does not skip them.

`campaign-send` uses a report-local campaign-ID allowlist for campaign IDs 1 and
5, a hard maximum of 14 simulated SendGrid requests, and the existing
`sendgrid-transport-interceptor.cjs`. Each campaign first gets a draft-guard
request that must fail before transport, followed by one approved launch. The
campaign-1 fixture is strictly audience=1 and its separate
`one-recipient-campaign.json` records the raw launch response, one recipient,
Sent=1, Parse state, and configured-versus-captured Reply-To. Campaign 5 is a
distinct synthetic 13-recipient fixture; its API and disposable ledger must
report 13, and the actual campaign Results UI must display Sent=13 with a
screenshot. These are independent assertions, not a claim that a 13-member
audience proves the one-recipient requirement. Both are clearly distinguished
from the read-only production aggregate above. The corrected coverage is
prepared but unexecuted until Main starts the managed phase. All output stays
under this report directory; pinned source/product files and production inputs
remain untouched, and nothing is published.

## Managed continuation after `core-final` and `campaign-send-final`

`runs/core-final` is preserved as a failed/incomplete result: the full route
capture already exists, but `behaviorComplete` stayed false when the identity
UI selector hit two legitimate matching fixture deal links. Do not repeat its
route captures. The report-only selector now targets both explicit fixture deal
hrefs and checks that each retains the canonical Company — Customer label.
Main's `core-resume` phase skips route inventory/capture/comparison, reruns the
requested behavior/API checks, performs only the remaining referral-panel,
⌘K, and notification identity screens, and captures the `/campaigns` **list**
for admin, manager, and rep. It writes a raw scope summary and route/error
ledger in its own run folder.

```bash
PREDEPLOY_MANAGED_RUN=1 PREDEPLOY_RUN_ID=core-resume-final \
  node reports/predeploy-c6fc40f/run-predeploy.mjs --phase=core-resume
```

`campaign-send-final` remains a failure: the API returned HTTP 201 with
`sent=0, failed=1`. The retained artifacts do not include the disposable
backend logs, results API snapshot, recipient/email-send ledger, or provider
transport ledger, so the underlying reason is unresolved. See
`campaign-send-final-offline-review.md`; do not relaunch the one-recipient case
to guess the cause. The report runner now records sanitized results/API,
recipient/email-send, audit, and local transport diagnostics before evaluating
a future one-recipient send. If it fails, the independent Campaign 5 checks
still run and the overall result remains FAIL.

To continue only the separate Campaign 5 UI/13-recipient fixture without
launching Campaign 1, Main can use the independent `campaign-five` phase. Use
port 4411 if another managed fixture may be using the default 4410 port:

```bash
PREDEPLOY_MANAGED_RUN=1 PREDEPLOY_RUN_ID=campaign-five-ui-final \
PREDEPLOY_FIXTURE_PORT=4411 \
  node reports/predeploy-c6fc40f/run-predeploy.mjs --phase=campaign-five
```

This seeds Campaign 5's 13 recipients in a fresh disposable backend and
captures its own completed ledger, API result, and Results UI screenshot.
Campaign 1 is created only as an ID-sequence fixture and is not launched in
this phase. Both continuations are report-only; they do not modify pinned or
product source and have not been run by this tester session.
