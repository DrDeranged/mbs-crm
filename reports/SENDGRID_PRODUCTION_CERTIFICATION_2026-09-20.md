# SendGrid production certification — 2026-09-20

## Verdict

**PASS for the controlled production send and signed delivery-event path.**

The approved internal recipient confirmed receipt. Production CRM data, SendGrid
event rows, and request logs correlate the controlled test send to an
authenticated `delivered` callback accepted with HTTP 200.

This report intentionally redacts the recipient and provider identifiers. It
contains hashes only where correlation requires a stable identifier.

## Production target

- Origin: `https://app.my-business-solutions.com`
- Event endpoint: `/api/sendgrid/webhook`
- API publication commit at certification: `fe572d8`
- Production process startup: `2026-09-21T00:09:57Z`
- Live deep-health response captured: `2026-09-21T01:02:59.584Z`
- Live deep-health response SHA-256:
  `203e0c2ae4fc92268d2e67f3c8062bde6395ecc7d711f258380813a44b5b788b`
- Deep health reported database `ok`, 46 applied migrations, SendGrid
  configured, last send at `2026-09-20T22:26:00.530Z`, and last webhook at
  `2026-09-21T01:01:28.972Z`.

## Controlled send correlation

- Approved-recipient SHA-256:
  `ee202c04a39ee29b575131f77b7579853ce80b53b9fce30eb523d290e71081a1`
- CRM `email_sends.id`: `12`
- Delivery kind: `test`
- Send accepted at: `2026-09-20T22:26:00.530Z`
- Final observed CRM status: `opened`
- Provider message-ID SHA-256:
  `7b69931033d56ec05c889ab12d816e6ac0539176fbf7968a1261b0087314d043`
- Correlated retained event: `delivered`
- Event received at: `2026-09-21T00:30:20.936561Z`
- Production request log: `POST /api/sendgrid/webhook` returned HTTP `200` at
  `2026-09-21T00:30:20.977Z` in `79 ms`.

The CRM send and retained event have the same provider message identifier
before hashing. The CRM's later `opened` status is a valid forward progression
from `delivered`, so it preserves proof that delivery state advanced.

## Signed fixture evidence

One provider fixture callback was accepted with HTTP `200` at
`2026-09-21T00:15:18.013Z` in `961 ms`. The production
`email_webhook_events` ledger retained the following events under the same
fixture message identifier:

| Event | Retained at (UTC) |
| --- | --- |
| delivered | 2026-09-21T00:15:17.426Z |
| bounce | 2026-09-21T00:15:17.581Z |
| dropped | 2026-09-21T00:15:17.662Z |
| spamreport | 2026-09-21T00:15:17.740Z |
| unsubscribe | 2026-09-21T00:15:17.818Z |

The fixture batch also retained processed, deferred, open, click,
group-unsubscribe, and group-resubscribe events. Repository-backed handler
tests confirm the terminal CRM effects for bounce, dropped, spam-report, and
unsubscribe events: status advancement, suppression, and activity logging.

## Signature and mutation controls

- A valid SendGrid ECDSA fixture now exercises the real signature verifier with
  the exact raw request bytes and both provider headers before event processing.
- Invalid signatures return `401` in the current handler and the regression
  test proves that event insertion, send lookup/update, suppression, and
  activity writes are never called.
- Verification remains fail-closed when the key, signature header, timestamp
  header, or raw body is absent.

## Tracking-origin evidence

The production test-send handler obtains its base URL from the trusted
`PUBLIC_APP_URL`/platform-origin resolver. The verified production origin is
`https://app.my-business-solutions.com`; custom open, click, and unsubscribe
links are generated from that origin rather than request forwarding headers.

## Commands and sources

- Focused API tests:
  `node --test --experimental-strip-types --loader ./test-loader.mjs src/lib/scrub-round2-f.test.ts src/lib/authMatrix.test.ts`
- API typecheck: `tsc -p tsconfig.json --noEmit`
- Production evidence sources:
  read-only production queries of `email_sends` and `email_webhook_events`,
  deployment request logs, and `/api/health/deep`.