# MBS CRM — Data Governance & Compliance Document

_Last updated: 2026-07-12. This document reflects what the code actually does._

---

## 1. What PII Is Stored

| Field | Table | Sensitivity | Notes |
|---|---|---|---|
| First name, Last name | `leads` | PII | Nullable after RTBF scrub |
| Email | `leads` | PII | Nullable after RTBF scrub |
| Phone | `leads` | PII | Nullable after RTBF scrub |
| Company name | `leads` | PII | Nullable after RTBF scrub |
| EIN (Employer ID Number) | `leads` | PII | Nullable after RTBF scrub |
| Consent IP address | `leads` | PII | Nullable after RTBF scrub |
| Credit pull consent timestamp | `leads` | PII | Nullable after RTBF scrub |
| Owner first/last name | `applications` | PII | Scrubbed to `[scrubbed]` after RTBF |
| Owner SSN | `applications` | **Sensitive — encrypted** | Stored as AES-256-GCM ciphertext in `owner_ssn_encrypted`; never returned in plaintext via any API endpoint; masked to `***-**-XXXX` for display |
| Owner date of birth | `applications` | PII | Scrubbed after RTBF |
| Owner home address, city, state, zip | `applications` | PII | Scrubbed after RTBF |
| Electronic signature data | `applications` | PII | Scrubbed after RTBF |
| Credit score | `credit_pulls` | Financial | Stored in clear; associated to lead_id |
| Credit report summary (tradelines, inquiries, public records) | `credit_pulls` | Financial | Stored as JSON; `reportSummary` column |
| Raw Experian request/response | `credit_pulls` | **Sensitive — encrypted** | Stored as AES-256-GCM ciphertext; never returned via API |
| Email address (for drip/email audit trail) | `email_sends` | PII | Retained for deliverability audit |
| Phone/SMS log | `communications` | PII | Retained for TCPA audit trail |

---

## 2. How PII Is Encrypted

**Algorithm:** AES-256-GCM  
**Key source:** `ENCRYPTION_KEY` environment secret (never hard-coded)  
**Implementation:** `artifacts/api-server/src/lib/encryption.ts`

Fields encrypted at rest:
- `applications.owner_ssn_encrypted` — SSN encrypted before insert; decrypted only for Experian API call (server-side only, never sent to client)
- `credit_pulls.request_payload_encrypted` — full Experian request payload
- `credit_pulls.response_payload_encrypted` — full Experian response payload

The plaintext SSN is never stored. After the Experian call, the in-memory plaintext is discarded. The API returns a masked form (`***-**-XXXX`) for display.

---

## 3. Who Can Access What (by Role)

| Capability | `rep` | `manager` | `admin` |
|---|---|---|---|
| View own leads (assigned) | ✓ | ✓ (all) | ✓ (all) |
| View application detail (masked SSN) | ✓ (own leads) | ✓ | ✓ |
| View credit tab / pull history | ✓ (own leads) | ✓ | ✓ |
| Trigger credit pull | ✓ (own leads, with consent) | ✓ | ✓ |
| View credit compliance log | — | — | ✓ |
| Export credit compliance CSV | — | — | ✓ |
| View PII access log | — | — | ✓ |
| Export PII access log CSV | — | — | ✓ |
| View consent/compliance panel per lead | — | ✓ | ✓ |
| Configure retention policy | — | — | ✓ |
| Trigger bulk purge | — | — | ✓ |
| Execute RTBF (PII scrub) per lead | — | — | ✓ |
| View admin backup export | — | — | ✓ |
| View error log | — | — | ✓ |
| Bulk status/assign leads | — | ✓ | ✓ |

All admin actions (settings changes, purges, RTBF, exports) are logged to `activity_log`.

---

## 4. What Is Logged

### 4a. PII Access Log (`pii_access_log`)

Every time a user endpoint returns sensitive data, a row is written asynchronously (fire-and-forget — never blocks the response):

| Endpoint | `fieldCategory` | `action` |
|---|---|---|
| `GET /leads/:id/application` | `application` | `view` |
| `GET /leads/:id/credit` | `credit` | `view` |
| `GET /credit/compliance-log/export` | `credit` | `export` |

Fields: `userId`, `leadId`, `fieldCategory` (ssn/credit/application), `action` (view/export), `ip`, `createdAt`.

Admin-only view: `/governance` page → PII Access Log section. CSV export available.

### 4b. Credit Compliance Log (`credit_compliance_log`)

**Append-only.** Written for every credit pull trigger and consent capture. Cannot be deleted. FCRA-required audit trail. Includes: `userId`, `leadId`, `creditPullId`, `action`, `permissiblePurpose`, `details`, `createdAt`.

Admin-only view: `/credit/compliance` page. CSV export available.

### 4c. Activity Log (`activity_log`)

General audit trail for all significant CRM actions. Used for:
- Credit pull triggers (`credit_pull`)
- Lead status changes, assignments, bulk operations
- RTBF scrubs (`rtbf_pii_scrub`, `rtbf_pii_scrub_forced`)
- Data purges (`data_purge`)
- Drip email consent skips (`drip_consent_skip` — logged when a drip step is skipped because the lead unsubscribed or has no email)
- Admin setting changes (`company_settings_updated`, `user_updated`)
- Backup exports (`backup_exported`)

### 4d. Idempotency Keys (`idempotency_keys`)

Prevents duplicate credit pulls, lead captures, and application submissions. Keys expire after 5–15 minutes. Not a compliance log; operational only.

---

## 5. Data Retention Policy

**Configurable:** Admins set the retention window (in months) in Settings → Company or the `/governance` page. Default: **36 months**.

**What is purged:** Leads with status `declined` whose `updatedAt` is older than the retention window.

**What is ALWAYS preserved (never purged):**
- Any lead with one or more `credit_pulls` rows
- Any lead with one or more `credit_compliance_log` rows
- These holds exist because FCRA requires retention of credit inquiry records

**Purge mechanism:** Hard-delete of eligible lead records. Cascades to: notes, tasks, documents metadata, communications, drip enrollments, email sends (all FK `ON DELETE CASCADE`). Logged to `activity_log` with count and list of deleted lead IDs.

**Trigger:** Admin must preview eligible records first (`/governance` → Data Retention → "Preview Eligible Records"), then confirm purge. Two-step flow prevents accidental deletion.

---

## 6. Deletion Path — Right to be Forgotten (RTBF)

Per-lead PII scrub available to admins from the lead detail → **Consent tab** → "Scrub PII".

### What is scrubbed
- **Lead record:** `firstName`, `lastName`, `email`, `phone`, `companyName`, `ein`, `consentIp`, `consentCreditPullAt` → set to NULL
- **Application record:** `ownerFirstName`, `ownerLastName` → `[scrubbed]`; `ownerSsnEncrypted`, `ownerDob`, `ownerHomeAddress`, `ownerHomeCity`, `ownerHomeState`, `ownerHomeZip`, `signatureData`, `signedDocumentKey` → set to NULL

### What is NEVER deleted
- `credit_compliance_log` rows — FCRA-mandated append-only log; the inquiry record must be preserved even if the underlying PII is scrubbed
- `credit_pulls` rows — retained for FCRA compliance; contain encrypted payloads only

### Compliance hold behavior
If the lead has `credit_compliance_log` entries or `credit_pulls`, the system detects a **compliance hold**:
1. Default RTBF (`DELETE /api/leads/:id/pii`) returns `409 conflict` with an explanation
2. Admin must acknowledge the hold explicitly via `DELETE /api/leads/:id/pii/force` (or the "Force Scrub" button in the UI)
3. In both cases the compliance log is preserved intact — FCRA guarantee is maintained
4. RTBF is logged to `activity_log` with `action: rtbf_pii_scrub` or `rtbf_pii_scrub_forced`

---

## 7. FCRA Consent Handling

**Credit Pull Consent (`leads.consent_credit_pull_at` + `leads.consent_ip`)**
- Captured when lead provides consent via the public application form or a rep explicitly captures consent in the CRM
- Endpoint: `POST /api/leads/:id/credit/consent`
- Before any credit pull is allowed: consent must have been captured within the **last 30 days** (enforced server-side)
- If consent is expired or absent, the pull endpoint returns `403`

**Application Consent (`applications.consent_credit_pull`, `applications.consent_terms`)**
- Both boolean fields must be `true` before the Experian pull is triggered during application submission
- Checked at: `POST /api/applications/submit` (line 231 of applications.ts)
- The public `/apply` page requires checkbox agreement before allowing form submission

---

## 8. TCPA Consent Handling

**Opt-out field:** `leads.is_unsubscribed` (boolean, default `false`)

**Enforcement:**
- **Drip email sequences:** The `runDripJob` background worker checks `lead.isUnsubscribed` before sending each step. If `true`, the enrollment is immediately unenrolled and a `drip_consent_skip` row is written to `activity_log` with `skipReason: "unsubscribed_tcpa_opt_out"`
- **Outbound SMS:** `POST /api/leads/:id/sms` checks `lead.isUnsubscribed` before calling Twilio. If `true`, returns `422 { error: "consent_required" }` — the SMS is never sent
- **Email sends via `doSendEmail`:** Also checks `isUnsubscribed` before dispatching to SendGrid
- **Unsubscribe webhook:** SendGrid sends unsubscribe events to `POST /api/sendgrid/events`; the handler sets `is_unsubscribed = true` on the matched lead

**Explicit re-consent:** Setting `is_unsubscribed` back to `false` must only be done with documented re-consent from the lead. There is no automated re-consent mechanism in this system.

**No TCPA consent timestamp field:** The system uses `is_unsubscribed` as the single opt-out signal. MBS should maintain external documentation of how initial consent was obtained (website form, verbal consent with rep, etc.).

---

## 9. Consent & Compliance Visibility (per Lead)

The **Consent tab** on each lead detail page (visible to managers and admins) shows:
- Credit pull consent: captured / expired / date + IP
- TCPA status: subscribed / unsubscribed with reason
- Application consent: credit pull + terms boolean flags
- Communication permission summary: email OK / SMS OK / credit pull OK

---

## 10. Backup & Export Controls

**Admin backup export:** `GET /api/admin/backup/export` — admin only, audit logged  
- Exports 11 tables as JSON
- SSN is exported as ciphertext (`ownerSsnEncrypted`), never decrypted
- Experian request/response payloads are excluded

**PII access log export:** `GET /api/pii-access-log/export` — admin only  
**Credit compliance log export:** `GET /api/credit/compliance-log/export` — admin only

---

## 11. Technical Controls Summary

| Control | Implementation |
|---|---|
| SSN never sent in plaintext | Server decrypts only for Experian API; masks before returning to client |
| TLS in transit | Managed by Replit deployment proxy (mTLS) |
| AES-256-GCM at rest | `lib/encryption.ts` — SSN + Experian payloads |
| Role-based access control | `requireUser()` middleware + role checks on every sensitive endpoint |
| Session management | Clerk-managed sessions; inactivity timeout and MFA configurable in Clerk Dashboard |
| Rate limiting | Lead capture (captureRateLimiter), application submit (submitRateLimiter) |
| Webhook signature validation | Twilio (x-twilio-signature), SendGrid (x-twilio-email-event-webhook-signature) |
| Input validation | Zod schemas server-side on all mutation endpoints |
| Idempotency | `idempotency_keys` table prevents duplicate submits/pulls |
| Security headers | Helmet.js active |
| CORS | Restricted to same-origin in production |

---

_This document is generated from the actual codebase behavior. Update it whenever a new PII field, endpoint, or retention rule is added._
