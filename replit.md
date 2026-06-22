# MBS CRM

A full-stack CRM for My Business Solutions — a merchant business financing/lending brokerage. Reps manage leads through a funding pipeline, make browser-based calls via a Twilio softphone, send SMS and email campaigns, run lender matching, pull credit reports, and generate marketing flyers. Merchants submit applications via a public form and track their application status.

---

## Run & Operate

| Command | Purpose |
|---------|---------|
| `pnpm --filter @workspace/api-server run dev` | API server (binds to `$PORT`) |
| `pnpm --filter @workspace/mbs-crm run dev` | Web app (binds to `$PORT`) |
| `pnpm --filter @workspace/mbs-crm-mobile run dev` | Expo mobile app |
| `pnpm --filter @workspace/api-spec run codegen` | Regenerate TanStack Query hooks + Zod schemas from OpenAPI spec |
| `pnpm run typecheck` | Full typecheck across all packages |
| `pnpm run build` | Typecheck + build all packages |

**After any change to `lib/api-spec/openapi.yaml`**, always run codegen before touching the frontend.  
**After codegen**, restart the `mbs-crm:web` workflow — Vite HMR errors transiently while generated files are being recreated.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 24, TypeScript 5.9 |
| Monorepo | pnpm workspaces |
| API | Express 5 |
| Database | PostgreSQL + Drizzle ORM |
| Validation | Zod v4 (`zod/v4`), `drizzle-zod` |
| API contract | OpenAPI 3.1 (Orval codegen → react-query hooks + Zod schemas) |
| API build | esbuild (CJS bundle) |
| Web frontend | React + Vite, Wouter router, TanStack Query v5, shadcn/ui, Tailwind CSS |
| Auth | Clerk (Replit-managed tenant) |
| Mobile | Expo (React Native) |
| Voice/SMS | Twilio Voice SDK + Twilio REST |
| Email | SendGrid |
| Object storage | Replit Object Storage |
| Credit bureau | Experian API |
| AI | Anthropic Claude (Replit AI Integrations proxy) |

---

## Where Things Live

```
artifacts/
  api-server/           Express API — all business logic, DB access, 3rd-party calls
    src/
      routes/           One file per domain (leads, twilio, communications, email, etc.)
      lib/              Shared helpers: authHelpers, activityHelper, dripJob, taskReminderJob,
                        workflowEngine, pushNotifications, logger, objectStorage
      app.ts            Express app wiring + route registration
      index.ts          Server startup, background jobs (drip every 10 min, reminders hourly)
  mbs-crm/              React web app
    src/
      pages/            Full-page components (dashboard, leads, lead-detail, apply, etc.)
      components/       Shared: app-shell, softphone-widget, softphone-context, phone-link, ui/
      hooks/            Custom React hooks
  mbs-crm-mobile/       Expo/React Native companion app
  mockup-sandbox/       Vite dev server for Canvas component previews (design tool only)

lib/
  db/                   Drizzle schema + DB client (@workspace/db)
    src/schema/         One file per table — this is the source of truth for DB shape
  api-spec/             OpenAPI YAML (@workspace/api-spec)
    openapi.yaml        Source of truth for all API contracts
  api-client-react/     Generated TanStack Query hooks (DO NOT hand-edit)
  api-zod/              Generated Zod schemas (DO NOT hand-edit)
  integrations/         Replit integration connector helpers
  integrations-anthropic-ai/  Anthropic AI integration
```

### Database Tables

| Table | Purpose |
|-------|---------|
| `users` | Clerk-authenticated staff (admin / manager / rep) with name, email, role, mobile, push token |
| `leads` | Core pipeline entity — contact info, status, score, tracking token for public status page |
| `companies` | Company records (future use) |
| `notes` | Free-form rep notes on leads |
| `tasks` | Checklist tasks linked to leads, with due dates |
| `documents` | Files uploaded against a lead (stored in Replit Object Storage) |
| `leadStatusHistory` | Audit log of every status change per lead |
| `leadAssignmentHistory` | Audit log of every rep assignment change |
| `activityLog` | Full activity feed — every meaningful action per lead |
| `communications` | All calls and SMS (inbound + outbound) with Twilio SID, recording URL, call notes, outcome |
| `emailTemplates` | Reusable HTML email templates with variable substitution |
| `dripSequences` | Automated email sequences with configurable steps |
| `dripSequenceSteps` | Individual steps in a drip sequence (delay + template) |
| `dripEnrollments` | Per-lead drip enrollment tracking |
| `emailSends` | Record of every email sent, SendGrid message ID, open/click events |
| `lenders` | Lender profiles with criteria for matching engine |
| `flyers` | Generated marketing flyer PDFs per lead |
| `applications` | Public intake application data from the `/apply` form |
| `creditPulls` | Experian credit pull requests, consent, and compliance log |
| `workflowRules` | Trigger-based automation rules (e.g., send email on status change) |

---

## Required Environment Variables

### Always Required
| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `PORT` | API server port (auto-set by Replit per artifact) |

### Replit Object Storage (auto-set by Replit)
| Variable | Description |
|----------|-------------|
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | Bucket for documents and flyers |
| `PRIVATE_OBJECT_DIR` | Private object path prefix |
| `PUBLIC_OBJECT_SEARCH_PATHS` | Public object path prefix |

### Twilio (required for calling and SMS)
| Variable | Description |
|----------|-------------|
| `TWILIO_ACCOUNT_SID` | Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | Twilio Auth Token |
| `TWILIO_PHONE_NUMBER` | E.164 phone number used as caller ID |
| `TWILIO_TWIML_APP_SID` | TwiML App SID — Voice Request URL must point to `https://<domain>/api/twilio/voice` |
| `TWILIO_API_KEY` | API Key SID (for Access Token generation) |
| `TWILIO_API_SECRET` | API Key Secret |

### SendGrid (required for email)
| Variable | Description |
|----------|-------------|
| `SENDGRID_API_KEY` | SendGrid API key |
| `SENDGRID_FROM_EMAIL` | Verified sender email address |
| `SENDGRID_FROM_NAME` | Sender display name |
| `SENDGRID_WEBHOOK_VERIFICATION_KEY` | For validating inbound event webhooks |
| `UNSUB_SECRET` | HMAC secret for unsubscribe link signing |

### Experian Credit Bureau (required for credit pulls)
| Variable | Description |
|----------|-------------|
| `EXPERIAN_API_KEY` | Experian API key |
| `EXPERIAN_API_SECRET` | Experian API secret |
| `EXPERIAN_API_URL` | Experian API base URL |
| `ENCRYPTION_KEY` | AES-256 key for SSN/sensitive field encryption — **missing this crashes credit submissions** |

### Anthropic AI (Replit-managed, optional)
| Variable | Description |
|----------|-------------|
| `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | Replit proxy key (auto-set when AI integration is added) |
| `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` | Replit proxy base URL |

### Other
| Variable | Description |
|----------|-------------|
| `NODE_ENV` | `development` / `production` |
| `REPLIT_DEV_DOMAIN` | Dev proxy domain (auto-set by Replit) |
| `API_BASE_URL` | Full URL of the API server (for server-side self-links) |

---

## Architecture Decisions

**OpenAPI spec is the single source of truth for all API contracts.**  
`lib/api-spec/openapi.yaml` defines every endpoint, schema, and response type. Orval generates `@workspace/api-client-react` (TanStack Query hooks) and `@workspace/api-zod` (Zod schemas) from it. Never hand-edit the generated packages — always edit the YAML, run codegen, then update the frontend.

**Zod v4 only — always `import { z } from "zod/v4"`.**  
The project pins Zod v4. Using `"zod"` instead of `"zod/v4"` will produce silent type mismatches because the peer dependency resolves to v3. This applies everywhere in the api-server.

**Clerk handles all authentication.**  
The web app uses a Replit-managed Clerk tenant. Every page is wrapped in `<ProtectedRoute>` except `/apply` and `/apply/status` (public merchant-facing). The API uses `requireUser(req, res)` which validates the Clerk session token. See the `clerk-auth` skill for configuration.

**Softphone is browser-native via Twilio Voice SDK.**  
`<SoftphoneWidget>` is mounted globally in `App.tsx` and floats over all pages. Click-to-call from lead detail uses `SoftphoneContext.dial(number, { leadId })`. Twilio tokens are fetched fresh on widget mount — they are short-lived JWTs and are never stored.

**Background jobs run inside the API server process.**  
On startup, two recurring jobs are registered: the drip email processor (every 10 minutes) and the task reminder push notification sender (every hour, fires reminders for tasks due today at 9 AM). These are simple `setInterval` loops — no separate worker process.

**Workflow rules are seeded once on startup.**  
`seedDefaultWorkflowRules()` runs on every server boot but is a no-op if rules already exist. The workflow engine fires on lead status changes and can trigger tasks, emails, or SMS.

**Lead scoring is demand-computed.**  
`recalculateLeadScore` is called explicitly (button in UI or via workflow rule). The score (0–100) and breakdown are stored as JSONB on the lead. It is not auto-recalculated on every field change.

**Object storage is Replit-native.**  
Documents and generated flyers are stored in Replit Object Storage (not S3). The `objectStorage` lib wrapper handles bucket access. File downloads return short-lived signed URLs.

---

## Web App Pages

| Route | Auth | Description |
|-------|------|-------------|
| `/` | ✅ | Redirects to `/dashboard` |
| `/dashboard` | ✅ | KPI cards, pipeline funnel, lead source chart, rep performance table |
| `/leads` | ✅ | Filterable/sortable lead list, bulk status/assign/delete/export |
| `/leads/new` | ✅ | New lead creation form |
| `/leads/:id` | ✅ | Lead detail — 11 tabs: Info, Notes, Tasks, Docs, Comms, Activity, Lenders, Marketing, App, Financials, Credit |
| `/settings` | ✅ | User profile and notification settings |
| `/email/templates` | ✅ | Email template management |
| `/email/drip` | ✅ | Drip sequence management |
| `/lenders` | ✅ | Lender CRUD and matching configuration |
| `/flyer-templates` | ✅ | Flyer template management |
| `/credit-compliance` | ✅ | Credit pull compliance audit log |
| `/workflow-rules` | ✅ | Automated workflow rule editor |
| `/apply` | 🌐 Public | Merchant-facing application intake form |
| `/apply/status` | 🌐 Public | Application status tracker (token-based, shown on `/apply` confirmation) |

---

## Gotchas

**Drizzle-kit push fails non-interactively for unique constraint additions on tables with existing rows.**  
Use raw SQL instead: `ALTER TABLE t ADD COLUMN IF NOT EXISTS col text` + `CREATE UNIQUE INDEX IF NOT EXISTS idx ON t(col) WHERE col IS NOT NULL`. Never run `drizzle-kit push` in a script expecting silent success when unique indexes are involved.

**Bulk action routes must be registered before `/:id` routes in Express.**  
`/leads/bulk-update-status` must come before `/leads/:id` or Express will match `bulk-update-status` as a lead ID. This pattern applies to any domain with nested bulk routes.

**The `logActivity` helper takes named object params, not positional.**  
Call it as: `logActivity({ leadId, userId, action, entityType, entityId, details? })`. Passing positional args silently compiles but logs nothing.

**`ENCRYPTION_KEY` is required for any credit pull route.**  
If the variable is missing, SSN encryption fails and the entire `/credit` route group throws. Set this before testing the credit compliance or Experian integration.

**Twilio TwiML App must have the correct Voice Request URL.**  
Set it to `https://<your-domain>/api/twilio/voice` (POST) in the Twilio console. The status callbacks are computed dynamically from the request headers — do not hardcode them.

**OpenAPI nullable fields use `type: ["string", "null"]` (not `nullable: true`).**  
OpenAPI 3.1 dropped `nullable`. For optional enums that can be null (e.g., `callOutcome`), use `type: ["string", "null"]` with the enum values listed separately — do not include `"null"` in the enum array.

**After codegen, restart the `mbs-crm:web` workflow.**  
Orval deletes and recreates the generated files. Vite's HMR watcher sees the deletions and may emit errors. Restarting the workflow clears it.

---

## User Preferences

_Populate as explicit preferences are stated._
