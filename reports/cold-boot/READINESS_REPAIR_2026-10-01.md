# Publishing startup readiness repair

## Measured fresh-process startup

All API measurements use the built production entry in a new Node process on the development machine, with background jobs and boot migrations disabled. The database/schema readiness check is retained. Probes target `/api` every 25 ms, with a 300 ms per-probe timeout. These are local single-run measurements, not measurements on the half-vCPU publishing VM; filesystem caches and machine load can vary.

| Build | First `/api` 200 | Listener announced | Application ready | Longest probe |
| --- | ---: | ---: | ---: | ---: |
| Last successful published API source, `1dbd46a`, built in a separate checkout | 3,364 ms | 71 ms | 3,345 ms | 310 ms |
| Branch before this repair, source baseline `80f3b4a` | 5,720 ms | 109 ms | 5,724 ms | 303 ms |
| Repaired candidate, final preflight smoke gate | 116 ms | 92 ms | 3,704 ms | 42 ms |

The repaired candidate had **zero failed probes after its first 200**. The two initial connection failures happened before the socket opened. Both liveness and full application readiness were under ten seconds in this run.

A preceding repaired-candidate run measured 118 ms first 200 and 2,812 ms application readiness, also with zero failed probes after the first 200.

Mobile fresh-process startup returned 200 on `/mbs-crm-mobile/`, `/`, and `/status` in 176.7 ms in its regression test, below its one-second bound. A pre-change single direct run measured 52.1 ms; differing test/machine load means this is not a claimed speedup. The repair removes import-time filesystem dependencies and enforces the startup bound.

## Diagnosis

The listener was already opened before a dynamic runtime import, but that import still parsed, resolved and evaluated the entire application graph on the listening thread. A production-mode runtime-import profile and a separate source-map inventory identify module compilation/resolution as the dominant synchronous work. A development-mode profile imported the old runtime in 7,073.6 ms; a warm-cache production-mode comparison imported old/new runtime chunks in 3,467/2,594.8 ms. These import-only profiles are distinct from complete cold-boot measurements.

The old eager runtime chunk contained 2,072 mapped sources (~13.18 MB), including large Twilio, Sentry/OpenTelemetry and ExcelJS closures. The new eager chunk has 1,159 sources (~9.92 MB). Migration discovery/read operations and schema SQL are already asynchronous; there was no evidence that a synchronous migration loop caused the reproduced local block. The profiles support an import-evaluation stall, but do not independently prove the exact duration of the reported production VM stall.

## Repairs

- A lightweight public listener owns liveness. GET/HEAD `/api`, `/api/`, and `/api/healthz` return 200 independent of initialization and email URL configuration.
- Application imports, schema initialization and jobs run in a worker isolate. The worker exposes only a private loopback HTTP listener after schema readiness; business requests remain 503 until then. `/api/health/deep` remains the detailed readiness endpoint, including email configuration health.
- The proxy streams exact body bytes and preserves existing Host/forwarding headers, without adding a loopback hop to the forwarded-for chain. Tests cover signed-body bytes, streams, failures and disconnects.
- Worker termination is tracked from creation. Shutdown drains requests, stops jobs, closes the PDF browser/database pool and handles partial initialization failure. Regressions cover unexpected exit before/during shutdown.
- ExcelJS loads only for spreadsheet parsing. Sentry loads only when configured; configured monitoring is awaited before application activation.
- Browser DOMPurify loads only when HTML is sanitized. Both previews stay empty/loading until safe HTML for the current source exists; failures and stale results never reveal raw HTML. jsdom is used only inside test sanitization helpers, not the API runtime.
- Mobile metadata/template reads are lazy and asynchronous. Production startup regressions cover the root, mounted root and status endpoint.
- Built startup regression is part of the smoke gate: first 200 below one second, repeated health probes must not fail during runtime initialization, and application initialization must finish.

## Verification and limits

- Focused proxy, Sentry and spreadsheet tests: 13 passed.
- Mobile tests: 8 passed; sanitizer tests: 5 passed.
- Review found a worker-exit shutdown race; it was repaired and independently re-reviewed with no remaining blocking finding.
- Final 11-gate preflight: **11/11 passed**, command exit code 0. Complete transcript: `PREFLIGHT_2026-10-01.txt`. Run with command-local `PUBLIC_APP_URL=https://app.my-business-solutions.com`.
- The first preflight stopped on an obsolete test expecting invalid email configuration to make shallow liveness 503. The shallow route and assertion were updated to keep liveness 200; deep health still tests invalid configuration as 503. The complete rerun passed.
- No publish, external send, customer mutation or production migration was performed. Production VM timing and a published revision fingerprint remain unverified until an explicitly authorized publish.

Reproduce measurements with `PUBLIC_APP_URL=https://app.my-business-solutions.com node scripts/measure-api-cold-boot.mjs artifacts/api-server/dist/index.mjs candidate`. The command-local URL is a public configuration value and does not change saved settings. The harness disables background jobs and boot migrations.