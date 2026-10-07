---
name: Verified GitHub source snapshots
description: Why a blob-verified source snapshot still needs exact Git metadata for certification guards.
---

Run certification on the requested immutable remote revision, not the current workspace checkpoint. A verified file snapshot also needs its exact commit and reachable history for Git-based guards.

**Why:** Schema-path and recovery guards require a Git repository and traverse parent commits. A file-only snapshot can fail before testing any product behavior. GitHub's REST commit timestamps are normalized to UTC, while the stored Git object can retain different offsets, so naive commit reconstruction produces a different hash.

**How to apply:** Preserve original Git metadata when possible. If reconstructing objects, verify every blob, tree and commit hash against the remote before using them; retain necessary ancestry without modifying the workspace index. Classify missing temporary-checkout metadata as setup failure, not a product defect.

Do not assume a reconstructed commit message ends in a newline, or that author
and committer used the same timezone offset.

**Why:** Connector-created GitHub commits can have no terminal message newline;
adding one changes the SHA even when every file and timestamp matches.

**How to apply:** Prefer exact raw commit bytes. If REST reconstruction is
necessary, test finite metadata variants against the authoritative SHA and use
only the matching bytes; never substitute a convenient new commit identity.

Use short temporary roots for disposable PostgreSQL clusters during certification.

**Why:** Deep source-checkout paths can exceed Unix's socket pathname limit even
when the same rehearsal starts successfully from the workspace root. The limit
includes PostgreSQL's generated socket filename, not just its socket directory.

**How to apply:** Put isolated rehearsal clusters in a short, uniquely owned
temporary directory and retain startup diagnostics on failure. Do not treat a
temporary-cluster path failure as a production schema defect.
