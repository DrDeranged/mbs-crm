# F — Email compliance and delivery proof

| Requirement | Status | Evidence |
| --- | --- | --- |
| Every outbound HTML message has a signed unsubscribe link and the exact legal address | PASS | Production provider sink `artifacts/api-server/src/routes/email.ts:302-342`; injected-provider sink assertion `artifacts/api-server/src/lib/scrub-round2-f.test.ts:29-52` |
| Authenticated SendGrid `bounce`, `dropped`, `spamreport`, and `unsubscribe` callbacks apply terminal send status, suppression of the correlated persisted recipient, and idempotent lead activity | PASS | Route orchestration `artifacts/api-server/src/routes/sendgrid.ts:124-194`; per-event HTTP route + mocked repository verification and signed-payload recipient-mismatch regression `artifacts/api-server/src/lib/scrub-round2-f.test.ts:54-135` |
| Admin can send the fixed CEO delivery-test template from `funding@my-business-solutions.com` to a typed address and receives the provider message ID inline | PASS | Route factory `artifacts/api-server/src/routes/email.ts:890-990`; HTTP endpoint + mocked sender verification `artifacts/api-server/src/lib/scrub-round2-f.test.ts:82-119`; UI `artifacts/mbs-crm/src/pages/settings.tsx:184-210,558-578` |
| Deep health reports SendGrid `{ configured, fromEmail, lastWebhookAt, lastSendAt, tracking: "custom" }` without a SendGrid tracking-settings API request | PASS | `artifacts/api-server/src/routes/health.ts:70-111`; provider tracking remains explicitly disabled in `artifacts/api-server/src/routes/email.ts:382-387` |
| Default 75 daily allowance is durable and shared by bulk and drip sends; its count and warm-up guidance are shown before a bulk send | PASS | `lib/db/migrations/024_email_compliance_daily_budget.sql:1-18`; production transaction lock/count/queued reservation `artifacts/api-server/src/routes/email.ts:279-409`; bulk `:668-677`; drip `artifacts/api-server/src/lib/dripJob.ts:131-146`; shared-lock mock verification and production bulk/drip/default-75 wiring assertion `artifacts/api-server/src/lib/scrub-round2-f.test.ts:177-217`; UI `artifacts/mbs-crm/src/pages/email-templates.tsx:250-329` |

## Mocked verification

`node --test --experimental-strip-types --loader ./test-loader.mjs src/lib/scrub-round2-f.test.ts`

```text
tests 7
pass 7
fail 0
```

No SendGrid API call, webhook callback, production query, production change, or actual email delivery was performed during this verification. Migration 024 is additive and deliberately unapplied.