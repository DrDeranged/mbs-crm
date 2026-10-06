# Focused final-build checks — 8622188

Target GitHub product/evidence revision: `862218809a23c7f4d4adc748f07d74534746fb6d`.
The retained source binding covers 886 files of the previously certified product revision; the web/API source and frozen build hashes were rechecked before this run. The **full certification harness was not run**, as requested. This run used an isolated, schema-only fixture, not the production database or a production mail send. No app was published.

Final run: `runs/run-2026-10-06T14-32-16-345Z-2923/`. The main-managed process exited **0** (`managed-exit-with-canonical-origin.json`). It deleted its fixture database and all three synthetic Clerk users (`export/cleanup-verification.json`). The API child had the SendGrid Inbound Parse settings **unset**, a fake SendGrid API key, and the production-mode required canonical public origin. Its compiled SendGrid client's HTTPS mail request was intercepted and answered by a **local** fake provider; no real email was sent.

## 1. Send path — raw results

| Event | Observed |
| --- | --- |
| `PUT /api/settings/email-delivery` | 200; email sending enabled only in disposable fixture |
| `POST /api/campaigns` | 201; campaign configured `replyToEmail: synthetic-replies@example.invalid`; manually picked exactly one synthetic lead |
| `POST /api/campaigns/1/preview` | 200; one eligible recipient, `contact@example.invalid` |
| `POST /api/campaigns/1/approve` with current preview | 200; approved |
| `POST /api/campaigns/1/launch` (live mode, unique idempotency key) | **201**; launch status **completed**, `sent: 1`, `failed: 0` |
| Intercepted compiled SendGrid request | `POST /v3/mail/send`; `to: contact@example.invalid`; `reply_to.email: synthetic-replies@example.invalid`; local provider **202** |
| Disposable DB send ledger | launch `completed`, `sent_count: 1`, one recipient `sent`, one email send `sent` |

The capture-off send was **not rejected** and its outgoing Reply-To equaled the campaign's configured address. The deliberate pre-approval and stale-preview guard probes returned 409; neither is a rejected approved send.

Raw records: `export/campaign-api-status.ndjson`, `export/sendgrid-raw-transport.ndjson`, `runs/run-2026-10-06T14-32-16-345Z-2923/sendgrid-child-transport.ndjson`, `runs/run-2026-10-06T14-32-16-345Z-2923/one-recipient-launch-db-verification.json`, and `runs/run-2026-10-06T14-32-16-345Z-2923/sendgrid-interceptor-ready.json`.

## 2. Manager pages — every 403/404/503

Authenticated as **Manager** in Chromium, loaded these five routes on the pinned final build:

| Page | Route | Playwright responses | CDP responses | 403/404/503 request paths |
| --- | --- | ---: | ---: | --- |
| Leads | `/leads` | 39 | 37 | **None** |
| Lead Detail | `/leads/1` | 72 | 69 | **None** |
| Deals | `/deals` | 36 | 33 | **None** |
| Campaigns | `/campaigns` | 33 | 30 | **None** |
| Campaign 5 Results | `/campaigns/5` → Results | 60 | 57 | **None** |

The Manager sign-in phase added 27 Playwright and 25 CDP responses, also with **no 403/404/503**. Totals: **267 Playwright** and **251 CDP** responses; there were **zero** browser console errors, page errors, or failed requests. The two HTTP observers overlap; the totals are not additive unique requests. Exact method/path/status/page rows are in `export/manager-pwr-statuses.ndjson` and `export/manager-cdp-statuses.ndjson`; `runs/run-2026-10-06T14-32-16-345Z-2923/manager-page-summary.json` lists the zero-error result. There are no 403/404/503 request paths to list.

## 3. Campaign 5 Results — raw results

The retained historical **Vendors — Heavy Equipment** fixture was inserted into the disposable database with one completed launch and 13 historical sends. `GET /api/campaigns/5/results` returned **200**, `counts.sent: 13`, `counts.failed: 0`, and one completed launch. The Manager UI's Results tab visibly showed **SENT 13** in the KPI panel and **13 SENT** in Campaign Results. See `runs/run-2026-10-06T14-32-16-345Z-2923/campaign5-results-ui-api.json` and `runs/run-2026-10-06T14-32-16-345Z-2923/campaign5-results-manager.png`.

## Evidence handling and earlier attempts

The first preparation attempt made an admin settings request without the browser's bearer token (401). After that harness-only correction, an isolated send was rejected because the fixture had no `PUBLIC_APP_URL`; a diagnostic attempt with a synthetic HTTPS origin was rejected by the **existing production-mode canonical-origin guard**. The final fixture used the required canonical origin and passed all three focused checks. Those earlier attempts did not reach the Manager page audit or the historical Campaign 5 check. No product source was changed to obtain the pass.

The original captured mail body included two signed unsubscribe URLs; the browser status ledgers included opaque Clerk resource URLs. These values must **not** be committed. `export-safe-evidence.mjs` generated the `export/` records from the passed run, preserving request methods, paths, status codes, recipient, Reply-To, and provider response while redacting two signed-link tokens, one disposable approval token, 11 opaque browser resource paths, and three deleted fixture user IDs. `export/export-manifest.json` records source/export hashes and redaction counts. Unredacted files from local fixture attempts are intentionally **not** included in the GitHub push.
