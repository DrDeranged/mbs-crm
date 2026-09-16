# USFA lead intake

## Webhook (dormant)

The optional `POST /api/intake/usfa` endpoint is disabled by default with the
database setting `usfa_webhook_enabled = false`. An administrator may enable it
from the USFA Intake page only after the vendor secret and payload contract are
confirmed.

USFA must send the exact UTF-8 JSON request bytes with
`X-USFA-Signature: sha256=<lowercase-or-uppercase-hex-HMAC>` where the HMAC is
SHA-256 keyed by `USFA_WEBHOOK_SECRET`. The signature is computed over the raw
body, before JSON parsing; the server captures that body with Express's existing
`verify` hook and never reconstructs JSON for verification. Missing, malformed,
or mismatched signatures return `401`. A valid signature with an invalid payload
returns `400` and identifies the first field. A valid enabled request returns
`200 { "leadId": number|null, "status": "ok"|"dup" }`.

The webhook maps the vendor payload through the same pure mapper and persistence
path as the Sheet poller. `revenue` is a required monthly number. Statement
links are metadata only and are never fetched. The endpoint is listed as a
public mutation only because its HMAC is its authentication boundary; it is
dormant until the admin setting and secret are both configured.

# USFA intake operations

The USFA application-mail poller is deliberately read-only against Gmail. It
searches the delegated `funding@my-business-solutions.com` mailbox for messages
whose subject contains `Lead Application`, downloads PDF attachments, and
stores them in the existing private object store as a lead document with
category `other`. It never sends, labels, archives, deletes, or modifies Gmail
messages.

The Gmail worker does not allowlist a sender: the vendor did not confirm a
sender address, so sender authentication is unavailable. Gmail activation is
blocked until the vendor confirms the trusted sender/domain. Until then it
relies only on the delegated mailbox, recipient search, subject, identity
matching, and the existing admin review workflow.

## Google Workspace administrator setup

1. In Google Cloud Console, create or select the project that owns the service
   account and enable **Google Sheets API** and **Gmail API**.
2. Create a service account and download its JSON key. Store the complete JSON
   document in the `GOOGLE_SERVICE_ACCOUNT_JSON` secret; do not commit it.
3. Copy the service account's **numeric client ID** (not its email address).
4. In the Google Admin console, open **Security → Access and data control →
   API controls → Manage Domain Wide Delegation** and choose **Add new**.
5. Enter the numeric client ID and authorize exactly this OAuth scope:

   `https://www.googleapis.com/auth/gmail.readonly`

   This scope is read-only and is the only Gmail scope used by this worker.
6. Set `GOOGLE_WORKSPACE_DELEGATION_SUBJECT` to the Workspace user mailbox
   being polled (normally `funding@my-business-solutions.com`). Set
   `USFA_FUNDING_EMAIL` if the mailbox uses another address.
7. Set `DEFAULT_OBJECT_STORAGE_BUCKET_ID` to the existing private App Storage
   bucket. If the service-account secret, delegation subject, or bucket is
   absent, the worker remains disarmed and makes no Gmail or storage call.

The worker runs every five minutes after API startup. Gmail listing is paginated
in read-only pages of 100 until `nextPageToken` is exhausted. Each message is
reserved under a PostgreSQL advisory transaction lock; the deterministic object
key plus the per-message PostgreSQL advisory lock and receipt transaction make
retries safe after a crash between object upload and database commit; no global
document-key uniqueness is required. Messages without a
matching USFA external ID or matching company plus email are held in
`usfa_application_email_log` and retried until 24 hours after receipt, then
marked expired. Gmail message IDs make processing idempotent. The corresponding
Sheet poller and this worker never write to their upstream systems.

## Configuration

| Setting | Purpose |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Service account JSON secret |
| `GOOGLE_WORKSPACE_DELEGATION_SUBJECT` | Delegated Workspace mailbox |
| `USFA_FUNDING_EMAIL` | Search recipient; defaults to `funding@my-business-solutions.com` |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | Existing private Replit App Storage bucket |
