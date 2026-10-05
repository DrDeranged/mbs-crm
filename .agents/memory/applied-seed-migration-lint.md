---
name: Applied seed migration lint
description: Why a valid, already-applied seed migration should not be rewritten just to satisfy a narrow static SQL parser.
---

When an already-applied seed migration uses valid PostgreSQL syntax that the migration dependency linter does not understand, extend the linter with a regression fixture instead of editing the applied SQL.

**Why:** Development records migration checksums. Rewriting a valid seed to work around a parser gap creates an avoidable checksum mismatch; an observed case involved a CTE with a named column list in an INSERT seed.

**How to apply:** Confirm the SQL itself runs and identify the parser's exact false positive. Keep the numbered migration append-only, teach the linter that syntax, and rerun the dependency lint plus the full release preflight.

For already-applied finite dynamic identifier loops, keep analysis narrowly
checksum-bound to the reviewed SQL, project every literal operation for
dependency checks, and still execute the original SQL in native rehearsal.
Never accept arbitrary EXECUTE/format bodies just to make a release pass.

**Why:** A finite foreign-key rename loop ran correctly and matched the schema,
but the conservative dependency parser rejected all dynamic SQL. Rewriting
the applied migration would invalidate its development ledger identity.

**How to apply:** Cover every independent static-analysis path, not just the CLI
linter. Regression-test altered bytes as rejected, and execute the original SQL
during native rehearsal.