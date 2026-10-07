# Campaign recovery journey — DEVELOPMENT browser results

**Scope:** `artifacts/mbs-crm`, `/campaigns`, DEVELOPMENT preview only. No production access, company settings changes, campaign launch, email send, or SMS send was performed. Browser/test identities and lead values are omitted; fixture details below are synthetic and were removed from the development database.

## Recovery journey

- Created uniquely named disposable fixtures: one email template; cancelled source campaign **58**; seven test leads; one inert historical launch; seven recipient ledger rows; and one local `sent` `email_sends` history row. The fixture suppression state used the observed `leads.is_unsubscribed` field from `emailSafety.ts`.
- As admin, opened the cancelled source detail and clicked the exact **Send remaining recipients as a new campaign** action. The UI navigated to new draft **59** (`draft`), not to a launch flow.
- Raw API `GET /api/campaigns/59` assertions: same template ID **5**; Reply-To retained; built-in `equipment_financing` flyer retained with `flyerDeliveryMode=attach`; `remainingFromCampaignId=58`; `remainingRootCampaignId=58`; `pickedLeadIds=[126,127]`. The sent lead, suppressed/unsubscribed leads, same-address alias, failed lead, and unrelated lead were not selected. Draft had **0 approvals / 0 launches**.
- Source verification: campaign **58** remained `cancelled`, version **1**, with its original template, Reply-To, flyer and all seven recipient statuses intact (`sent`, `queued`, `deferred`, `queued`, `queued`, `queued`, `failed`); one sent history row remained attached during the test.
- Reloaded draft **59**. Audience tab showed the locked notice identifying source campaign 58, explained that attempts/unsubscribes/suppressions are rechecked, and showed exactly two disabled manually picked leads.
- Preview `POST /api/campaigns/59/preview` (non-dispatch endpoint) returned **200**, eligible lead IDs `[126,127]`, count **2**. After newly unsubscribing lead **127**, a fresh preview returned **200** and eligible IDs `[126]`, count **1**; lead 127 was absent from eligible. The preview recomputes the recovery candidate set, so it reported 0 detailed exclusions for the newly suppressed lead.
- PATCH probe attempted to replace the audience with sent lead **125** plus unrelated lead **14**. `PATCH /api/campaigns/59` returned **200**, but response and subsequent GET preserved `[126,127]` and both provenance IDs **58**. No audience widening or server-owned provenance removal occurred.

## Manager authorization

- Signed in a separate unique disposable Clerk test identity and explicitly set its local database role to `manager` (admin identity was likewise explicitly set to `admin`).
- On source campaign **58**, the manager UI had **0** `campaign-send-remaining` controls.
- Intentional security probe: authenticated `POST /api/campaigns/58/send-remaining` returned **403** with `Only admins can create a remaining-recipient campaign`. The corresponding browser “failed to load resource: 403” log was expected for this deliberate authorization probe, not an unexpected browser/runtime failure.

## Cancellation confirmation

- Seeded running fixture campaign **60** directly in the database with **2 queued** recipients and an inert `completed` launch record. No launch endpoint was invoked.
- Detail page exposed **Cancel Campaign**. Its confirmation named the fixture and stated **2 recipients are currently queued**. Selecting **Keep campaign** closed the dialog; there was no cancellation request and the database status remained `running`.
- Campaigns-list dropdown also opened the same named confirmation with queued count **2**. Selecting **Keep campaign** again left status `running` and made no cancellation request (the broad request listener saw only background softphone/environment requests).
- Reopened the list dropdown and explicitly confirmed. `POST /api/campaigns/60/cancel` returned **200**; response, database and list UI showed `cancelled`.

## Cleanup and side effects

- Deleted test email history row **61**, campaigns **58/59/60** (and their dependent campaign rows), leads **125–131**, template **5**, and disposable local database users **72/74**. Post-cleanup verification counts were **0 campaigns, 0 leads, 0 template, 0 users** for these fixture IDs.
- Closed both browser contexts after testing. The available Clerk E2E skill provides `signInClerkUser` but no user-deletion helper; therefore the two disposable Clerk-side identities could not be deleted using the permitted capability. Their local application user rows are deleted and their browser sessions were closed. No Clerk API or secret was used. **Clerk-side identity cleanup remains outstanding.**
- The app automatically initialized its softphone in authenticated pages and made background `/v1/environment` and `/api/twilio/token` requests, followed by Twilio voice WebSocket registration/heartbeats. These were not campaign email/SMS deliveries or launch requests, and both contexts were closed afterward. This passive softphone activity is noted because the test requested no provider requests.
- Other observed non-blocking console warnings: Clerk development-key/structural-CSS warnings and Twilio’s unavailable default audio output device. No unexpected campaign runtime error was observed.

## Sanitized screenshot evidence

Screenshots were captured automatically by the browser harness (evidence IDs below); they are referenced here rather than embedding session URLs or browser tokens. Captures show synthetic fixture labels only.

- `nrji0l` — admin source detail, cancelled status and recovery action.
- `d8ti1s` — newly created draft and retained campaign content.
- `yr8086` — reloaded draft Audience tab, locked notice and two selected leads.
- `3v4fp8` — detail-page cancellation dialog with queued count 2.
- `zjydk1` — Campaigns-list cancellation dialog with queued count 2.
- `6b9x8s` — list after confirmed cancellation, fixture marked CANCELLED.
- `svdsgn` — manager source detail; recovery action absent.
- `9q92gt` — manager view after intentional 403 probe.

## Functional assertions vs. harness safety verdict

- **Functional campaign assertions: PASS.** Recovery created a constrained draft; live suppression recheck, server-owned provenance, manager authorization, and both cancellation-confirmation flows behaved as described above.
- **Harness safety verdict: FAIL.** The authenticated app automatically made background softphone/environment and Twilio-token requests and registered a Twilio Voice WebSocket. No campaign email/SMS or launch was performed, but the passive voice integration conflicts with a strict no-provider-requests constraint. Cleanup was subsequently completed as described below.

## Follow-up Clerk cleanup result

- The exact disposable DEVELOPMENT Clerk user IDs still requiring Clerk-side deletion are `user_3KNWm6LXyukrPcIHUNVvCcmHYXE` (admin test identity) and `user_3KNXFAuKa68wgzZmUoMSlyKWoFE` (manager test identity). Their local database user rows were already deleted, and both browser contexts were closed.
- Per `.local/skills/clerk-auth/SKILL.md`, management status must be checked before a Clerk service operation. The required `checkClerkManagementStatus()` helper is not defined in the available execution environment (`ReferenceError`); `clerkClient` and deletion helpers are also not exposed there. Source inspection confirms the API server imports `clerkClient` from `@clerk/express` in `artifacts/api-server/src/lib/authHelpers.ts`, but there is no existing `deleteUser()` route in the inspected server/client code.
- **No Clerk deletion call was attempted.** Without the mandated tenant-status check and a safe server-side execution path, it was not possible to establish that invoking the configured client would target only the DEVELOPMENT tenant. No secrets were read, printed, or accessed, and no Production tenant, settings, or other identities were touched.

## Final cleanup by the main agent

The main agent's management-status check returned `managed` with authorized dashboard access.
The managed development workflow had confirmed test-key configuration. Using the existing
server-side Clerk SDK (without reading or printing credentials), the main agent verified
the two exact disposable identities were created during this test window and deleted both.
Raw cleanup result: `DEVELOPMENT_DISPOSABLE_CLERK_CLEANUP 2/2`.
Local DB fixture cleanup and Clerk identity cleanup are complete. The original Twilio
background-initialization caveat remains; this cleanup does not change the harness safety verdict.
