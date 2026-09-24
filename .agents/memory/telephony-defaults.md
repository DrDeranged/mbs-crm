---
name: Telephony default precedence
description: Why dual-number settings must not inherit the legacy single-number environment value for existing rows
---

Existing environments may have configured the secondary line as the old
single-number environment value. When introducing distinct voice and SMS
settings, give existing settings rows explicit business-line defaults; do not
let both new roles silently inherit that legacy value. Retain the environment
number as the fallback when settings are genuinely absent or cleared.

**Why:** A live development health check showed that the legacy fallback
selected the secondary line for both roles even though the requested defaults
were the business line. An append-only backfill corrected existing rows.

**How to apply:** When adding or resetting telephony settings, distinguish an
existing row needing initialization from a deliberately unset setting. Verify
the effective roles through the deep health response, not just the schema
default declaration.