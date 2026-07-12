---
name: Idempotency pattern for POST endpoints
description: How idempotency is implemented in the MBS CRM API server
---

The pattern uses a shared `idempotency_keys` Postgres table with a unique constraint on `(key, endpoint)`.

**Schema:** `lib/db/src/schema/idempotencyKeys.ts`
**Helper:** `artifacts/api-server/src/lib/idempotency.ts` — exports `deriveKey`, `checkIdempotency`, `storeIdempotency`

**Key derivation strategy:**
- `POST /applications/submit`: `SHA-256("applications/submit|{email.lower()}|{ein}|{Math.floor(Date.now()/(15*60*1000))}")`  — 15-min window
- `POST /leads/capture`: `SHA-256("leads/capture|{email.lower()}|{phone}|{5-min-bucket}")` — 5-min window
- `POST /leads/:id/credit/pull`: `SHA-256("leads/credit/pull|{leadId}|{pullType}|{15-min-bucket}")` — 15-min window

**Flow:** check → (hit) return cached payload as JSON; (miss) process → store result payload as jsonb, fire-and-forget with `void storeIdempotency(...)`.

**Why:** On-conflict insert in storeIdempotency is silently ignored (catch block), so concurrent requests that both miss the cache will both process but only one write will persist — acceptable for these endpoints.

**How to apply:** Add idempotency check AFTER basic Zod validation and BEFORE the duplicate-record check and DB writes. Store idempotency AFTER the lead/record is created, with `void` to avoid blocking the response.
