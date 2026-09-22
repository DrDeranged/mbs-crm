# Migration audit: 052–055

These migrations were reviewed as committed SQL. They are additive.

## 052_reusable_campaign_launcher.sql

**Purpose:** Introduces the reusable campaign launcher data model and seeds one financing campaign draft when its template and an admin/manager owner exist.

### Creates

- `campaigns`
  - `id` serial primary key
  - `name` text, required
  - `description` text
  - `channel` text, required, default `email`, constrained to `email`, `sms`, or `email_sms`
  - `status` text, required, default `draft`, constrained to the campaign lifecycle values
  - `email_template_id` integer, optional FK to `email_templates.id`
  - `sms_body` text
  - `audience_rules` jsonb, required, default empty object
  - `scheduled_at`, `launched_at`, `completed_at` timestamptz
  - `owner_id`, `created_by` required integer FKs to `users.id`
  - `version` integer, required, default 1
  - `created_at`, `updated_at` required timestamptz, default `now()`
- `campaign_audience_presets`
  - `id` serial primary key
  - `name` text, required
  - `rules` jsonb, required, default empty object
  - `owner_id` required integer FK to `users.id`
  - `created_at`, `updated_at` required timestamptz, default `now()`
  - unique `(owner_id, name)`
- `campaign_approvals`
  - `id` serial primary key
  - `campaign_id` required integer FK to `campaigns.id`
  - `approval_type` text, required
  - `content_version` integer, required
  - `approved_by` required integer FK to `users.id`
  - `approved_at` required timestamptz, default `now()`
  - `invalidated_at` timestamptz
  - `invalidated_reason` text
- `campaign_launches`
  - `id` serial primary key
  - `campaign_id` required integer FK to `campaigns.id`
  - `idempotency_key` required unique text
  - `requested_by` required integer FK to `users.id`
  - `mode` required text, default `live`
  - `status` required text, default `queued`
  - `eligible_count`, `excluded_count`, `sent_count`, `failed_count` required integers, default 0
  - `scheduled_at`, `started_at`, `completed_at` timestamptz
  - `created_at` required timestamptz, default `now()`
- `campaign_recipients`
  - `id` serial primary key
  - `launch_id` required integer FK to `campaign_launches.id`
  - `campaign_id` required integer FK to `campaigns.id`
  - `lead_id` required integer FK to `leads.id`
  - `channel` required text, constrained to `email` or `sms`
  - `status` required text, default `eligible`, constrained to recipient lifecycle values
  - `exclusion_reason` text
  - `email_send_id` optional integer FK to `email_sends.id`
  - `created_at` required timestamptz, default `now()`
  - unique `(launch_id, lead_id, channel)`
- `campaign_audit_events`
  - `id` serial primary key
  - `campaign_id` required integer FK to `campaigns.id`
  - `actor_user_id` optional integer FK to `users.id`
  - `action` text, required
  - `from_status`, `to_status` text
  - `details` jsonb
  - `created_at` required timestamptz, default `now()`
- Indexes on campaign status/owner, approval campaign, launch campaign, recipient campaign/status, and audit campaign/creation time.

### Alters

- `email_sends`
  - Adds optional integer `campaign_id`
  - Adds optional integer `campaign_launch_id`
  - Adds index `(campaign_id, campaign_launch_id)`

### Data statement

- Conditionally inserts one unapproved `Financing Campaign` draft. It does not send, schedule, approve, or launch it.

## 053_campaign_preview_approval_snapshots.sql

**Purpose:** Adds immutable audience-preview evidence and binds approvals to the exact preview/content snapshot.

### Creates

- `campaign_audience_previews`
  - `id` serial primary key
  - `preview_token` required unique text, minimum length 10
  - `campaign_id` required integer FK to `campaigns.id`
  - `campaign_version` required integer
  - `requested_by` required integer FK to `users.id`
  - `content_hash` required text
  - `counts` required jsonb, default empty object
  - `created_at` required timestamptz, default `now()`
  - index `(campaign_id, campaign_version)`

### Alters

- `campaign_approvals`
  - Adds required `content_hash` text, default empty string
  - Adds optional `preview_id` integer FK to `campaign_audience_previews.id`
  - Adds required `claims_affirmed` boolean, default false
  - Adds required `snapshot` jsonb, default empty object
- Adds the preview-token nonempty check constraint.

## 054_campaign_preview_recipient_snapshots.sql

**Purpose:** Stores the exact recipient snapshot associated with an audience preview.

### Alters

- `campaign_audience_previews`
  - Adds required `recipients_snapshot` jsonb, default empty array

## 055_campaign_launch_execution_leases.sql

**Purpose:** Adds execution leases so campaign launch workers can claim work safely and avoid duplicate execution.

### Alters

- `campaign_launches`
  - Adds optional `execution_lease_token` text
  - Adds optional `execution_lease_expires_at` timestamptz
  - Adds index `(id, execution_lease_expires_at)`

## Destructive-operation review

- No `DROP` statement.
- No `RENAME` statement.
- No column type change (`ALTER COLUMN ... TYPE` or `SET DATA TYPE`).
- No row-deletion statement (`DELETE FROM`).
- The files do contain `ON DELETE` clauses on foreign keys. Those clauses define referential behavior; they are not migration-time delete statements.