# Offline review — `campaign-send-final`

**Scope:** retained report artifacts, frozen pinned schema/routes, and existing managed
workflow logs only. No browser/tester was started, no fixture was relaunched, and no
application code was changed.

## What the retained run proves

- The actual fixture API launch returned HTTP `201`, but its payload reported
  `launch.status="failed"`, `eligibleCount=1`, `excludedCount=0`, `sentCount=0`,
  and `failedCount=1`. This contradicts the expected one-recipient successful
  delivery check; the one-recipient phase remains **FAIL**.
- The report-local gate file shows that the Campaign 1 launch allowance was
  consumed (`/api/campaigns/1/launch: 0`) while Campaign 5 allowances remained
  unused (`/api/campaigns/5/launch: 2`).
- `provider-ready.json` records the isolated loopback transport as ready with
  HTTP 202 and a maximum of 14 requests. `sendgrid-interceptor-ready.json`
  confirms that the fake key/interceptor was installed before the compiled API
  import and that the inbound-parse secret was unset. These are setup facts;
  they do **not** prove that the failed recipient reached the transport.
- `campaign5-fixture.json` contains the failure response and stack, but no
  successful campaign result or post-launch ledger detail.

## Root cause is not available in retained evidence

`runs/campaign-send-final` contains only the failure JSON, gate, sandbox
derivative, and the two readiness files. It contains no
`sendgrid-transport.ndjson`, `sendgrid-captured-body.json`,
`one-recipient-campaign.json`, results-API snapshot, fixture SQL ledger, or
fixture backend log. The managed API-server log covering the recorded launch
time contains no matching campaign-launch, fixture recipient, or SendGrid
transport entry; that workflow log is not the disposable fixture server's
backend log.

Consequently, the evidence does not distinguish among a failure before a
transport request, a transport/provider response failure, or a later
reconciliation/ledger failure. Do not attribute it to the Campaign 1 fixture
guard, missing flyer asset, or product code without the missing diagnostic
fields. The campaign-send failure is genuine at the observed API-launch-result
level; its underlying error reason is **unresolved**, and no post-launch ledger
state was retained.

## Diagnostic needed before another one-recipient launch

The report runner is being updated to save a sanitized pre-assertion snapshot:
results API launch counters; `campaign_recipients` status/exclusion reason;
linked `email_sends.status` and `failure_reason`; safe campaign audit action and
reason/code fields; and local transport request count/status. It will omit
recipient addresses, payload bodies, authentication values, and signed URLs.
No new one-recipient launch should be used to infer a cause until this
diagnostic is present.

The Campaign 5 UI/13-recipient scenario is prepared as an independent phase so
it can be run in a fresh isolated fixture without launching Campaign 1. Its
synthetic ledger, provider budget, and verdict remain separate from the failed
one-recipient result.
