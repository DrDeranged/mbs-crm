# Production Scrub Round 2 — H: Observability

No production records, configuration, or schema were changed for this section.

| Requirement | Status | Evidence |
| --- | --- | --- |
| Every completed 5xx writes structured method, path, user ID, request ID, and stack data | PASS | `artifacts/api-server/src/app.ts:23-45,121-131`; `artifacts/api-server/src/lib/httpErrorObservation.ts:24-52`; focused assertion `httpErrorObservation.test.ts:5-30` |
| System Health error rows expose the complete request ID that maps to the structured log record | PASS | persisted `requestId` is shared by `app.ts:32-39` and `httpErrorObservation.ts:31-39`; complete, non-truncated UI value is rendered at `artifacts/mbs-crm/src/pages/system-health.tsx:261-263` |
| Flyer-only Puppeteer queue has concurrency no higher than two | PASS | `artifacts/api-server/src/lib/flyerPdfRenderer.ts:3-4,35-40` pins and caps the option; five mocked never-settling render assertion `flyerPdfRenderer.test.ts:56-80`; flyer route only uses it at `routes/flyers.ts:84` |
| Flyer render timeout is 30 seconds and returns a 503, including work still queued behind hung renders | PASS | exported production default pinned at `flyerPdfRenderer.ts:4,31-35` and asserted by `flyerPdfRenderer.test.ts:10-13`; deadline starts at enqueue in `flyerPdfRenderer.ts:86-96`; Express integration verifies status and recorder correlation at `flyerObservability.integration.test.ts:21-91` |
| Dashboard empty states use the specified copy | PASS | `artifacts/mbs-crm/src/lib/dashboardEmptyStates.ts:1-4`; rendered at `pages/dashboard.tsx:869,951`; pinned by `dashboardEmptyStates.test.ts:5-8` |

## Focused verification

```text
node --test --experimental-strip-types --loader ./test-loader.mjs \
  src/lib/httpErrorObservation.test.ts src/lib/flyerPdfRenderer.test.ts
```

The test includes five mocked flyer renders and verifies that only two are active
at once. It also verifies that a timeout is a `FlyerRenderTimeoutError` with
status `503`, including when the first two underlying renders never settle.
Timed-out active renders retain their queue slots until their renderer settles;
timed-out queued renders are removed without starting.

The safe, in-process Express integration is additionally exercised with:

```text
node --test --experimental-strip-types --loader ./test-loader.mjs \
  src/lib/flyerObservability.integration.test.ts
```

```text
cd artifacts/mbs-crm &&
node --test --experimental-strip-types src/lib/dashboardEmptyStates.test.ts
```