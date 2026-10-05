# Campaign attribution and inbound reply setup

This change is **not published**. Do not activate a live Parse destination
until the endpoint below has been deployed in a separately approved release.
No live campaigns, calls, customer messages, DNS or SendGrid destination
configuration were changed as part of implementation.

## SendGrid Inbound Parse

1. Add an MX record for **replies.my-business-solutions.com** (often entered
   as host **replies**): target **mx.sendgrid.net**, priority **10**.
   **Do not change the main domain's MX records or reroute its inbox.**
2. In Replit Secrets, create a high-entropy **SENDGRID_INBOUND_PARSE_SECRET**.
   This is a new, separate credential; **SENDGRID_WEBHOOK_VERIFICATION_KEY**
   authenticates delivery events and does not authenticate Inbound Parse.
3. After the new endpoint is deployed, configure SendGrid Inbound Parse for
   hostname **replies.my-business-solutions.com** with this exact HTTPS
   endpoint (it responds directly, without redirects):
   **https://app.my-business-solutions.com/api/sendgrid/inbound-parse**
4. Authenticate Parse POSTs using HTTP Basic authentication: username
   **mbs-parse**, password the new Parse secret. SendGrid's URL credentials
   configuration can use
   `https://mbs-parse:<URL-encoded-secret>@app.my-business-solutions.com/api/sendgrid/inbound-parse`.
   Enter the real password only in the provider's protected setup and Replit
   Secrets. Never copy the credential-bearing URL into CRM notes, logs or Git.
5. Use the parsed fields/attachments mode, not raw MIME mode. The handler
   uses the actual `envelope.to` recipient, not the user-controlled To header.
   Enable **SENDGRID_INBOUND_PARSE_ENABLED=true** only after DNS, authentication
   and endpoint deployment are verified. Before activation, campaign sends
   fail explicitly rather than routing replies to an unready subdomain.

Provider documentation:
https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/inbound-email

## Reply processing

Each campaign message receives an unpredictable recipient-specific address.
Only its digest and original forwarding destination are retained. The
default destination remains **nate@my-business-solutions.com**; an individual
campaign's operational Reply-To is snapshotted at send time.

Human replies are recorded once in the lead timeline and campaign Results.
The forwarded plain-text envelope preserves the sender and subject and sets
Reply-To to the original human sender. PDF, PNG, JPEG and plain-text
attachments are stored privately and forwarded: at most eight files, 5 MB
each and 10 MB total. Unsupported or oversized payloads are explicitly
rejected. HTML is converted to text and never rendered as executable HTML.

Message-ID plus the original send identifies a redelivery. For messages
without Message-ID, a stable fingerprint of sender, subject, body, Date and
attachment digests is used; identical messages without distinguishing
headers cannot be separated perfectly. Automated replies, mailer bounces
and tagged forwarding loops are excluded from human-reply KPIs.

Forwarding states are visible in the lead and campaign reply panels.
Definite provider rejection can be retried on provider redelivery.
Dispatching/uncertain outcomes are held behind a durable barrier and never
automatically retried. An interrupted dispatch requires an operator to
confirm the provider outcome before any manual recovery; there is no blind
retry button.

## Attribution and financial definitions

- Signed flyer requests validate approved asset bytes/digest, campaign,
  launch and recipient before inserting a click. Recording must commit
  before the no-cache redirect. Unscoped old asset links stay unattributed.
  Unique clicks count leads; total clicks include repeat requests/scanners.
- Inbound calls use a uniquely normalized caller-phone match and the
  original inbound time. Calls and referrals use the latest successful live
  campaign receipt within the preceding 30 days, including the boundary.
  Queued, failed, excluded, suppressed, dry-run and bounced/blocked sends
  do not qualify. Unmatched/ambiguous calls are recorded as unattributed.
- A signed referral may preserve explicit qualifying send provenance.
  Otherwise credit is fixed from the referrer's latest qualifying receipt.
  Partner contacts match only a unique recipient lead by email. No unique
  match means no inferred campaign credit. Later referral edits/clears are
  audited and preserve historical credit; they do not change ownership.
- Conversion counts deduplicate recipient and referred-lead cohorts and
  require milestones at or after cohort entry. Actual status histories,
  stage events, approval dates and funded dates are used. An existing
  current-stage value alone cannot date a milestone on an older deal.
- Funded dollars count distinct referred deals funded after attribution.
  MBS points reuse the rate/points calculator and its saved inputs, checked
  against actual GM. Missing or inconsistent pricing is reported as
  unpriced, not replaced with a guessed commission or split.
- Sent counts successful recipient/channel sends; delivered percentage has
  successful email sends as its denominator. Opens are approximate.
  Historical tracking gaps display **Not tracked**, not invented zeroes.

## Migration policy

The two new SQL migrations are append-only. All earlier migration bytes are
unchanged. Attribution DDL was applied by the transactional development
ledger before lint; its exact checksum-scoped lint exemption preserves that
applied identity. The second migration only aligns foreign-key names.
Empty-schema/existing-schema rehearsal and schema parity remain required;
the exemption does not bypass those gates.
The already-applied finite constraint-renaming loop has an exact-byte static
projection for dependency analysis; the linter still executes its original
SQL in PostgreSQL. Unknown or altered dynamic SQL remains rejected.
