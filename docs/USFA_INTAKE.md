# USFA intake operations

The USFA application-mail poller is deliberately read-only against Gmail. It
searches the delegated `funding@my-business-solutions.com` mailbox for messages
whose subject contains `Lead Application`, downloads PDF attachments, and
stores them in the existing private object store as a lead document with
category `other`. It never sends, labels, archives, deletes, or modifies Gmail
messages.

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

The worker runs every five minutes after API startup. Messages without a
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
