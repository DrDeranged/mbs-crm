---
name: drizzle-kit push interactive prompt blocks non-interactive schema changes
description: drizzle-kit push can hang/prompt on unrelated pre-existing constraints, blocking `pnpm --filter @workspace/db run push` in non-TTY sessions
---

`pnpm --filter @workspace/db run push` (drizzle-kit push) can stop with an interactive TTY prompt about a pre-existing constraint (e.g. a unique constraint drizzle-kit thinks is new/ambiguous) even when the actual pending change is unrelated and additive (e.g. adding one nullable column).

**Why:** drizzle-kit's push diff sometimes can't cleanly resolve constraints that already exist in the DB but aren't perfectly tracked in its migration snapshot history, and it falls back to an interactive y/n prompt that has no non-interactive flag in this environment.

**How to apply:** If `pnpm --filter @workspace/db run push` hangs or fails with a prompt unrelated to your actual schema change, don't fight it — apply the specific column/table change directly via `psql "$DATABASE_URL" -c "ALTER TABLE ... ADD COLUMN IF NOT EXISTS ..."`, keep the Drizzle schema file in sync (source of truth for future codegen/types), and rebuild the db package's TS output (see db-rebuild.md) so `tsc --build` sees the new field.
