---
name: Parallel helper commit ownership
description: Serialize Git index and history operations while helpers share the workspace.
---

Only one actor may stage or commit at a time when helpers work in the shared
workspace. Give that actor explicit ownership of the index, then release it.
Do not have a helper amend an earlier commit while another may commit.

**Why:** A HEAD check and a subsequent amend are not atomic. A concurrent helper
can advance HEAD between them, causing an amend to capture the wrong section.
Shared-file edits also require hunk-level staging to keep section commits honest.

**How to apply:** Parallelize implementation in focused files, but serialize
staging and history operations. Consolidate unpushed fixups centrally before
the agreed push checkpoint; never rewrite already-pushed section history.