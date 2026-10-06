---
name: Persistent certification runners
description: Keep long browser certifications alive beyond the tester's shell command lifetime.
---

Run long certification harnesses through a main-agent managed background task,
not a detached child owned by a testing subagent's shell action.

**Why:** The tester's command ceiling terminated detached browser runners and
their monitors before candidate capture. Detachment alone did not preserve the
process; partial baseline captures were repeatedly lost and fixtures orphaned.

**How to apply:** Keep one testing agent responsible for the harness and result
analysis. Launch its validated harness with the main agent's
`ShellExec(run_in_background: true)`, then give the tester the log path and
completion-marker path. Monitor with short read-only calls, never a long shell
monitor that owns the runner. Preserve interruptions as incomplete evidence,
verify cleanup, and never substitute old screenshots for a new candidate.

Make long certifications resumable by section and persist request/response
traces incrementally, not only in the final summary.

**Why:** A managed background run survived the command ceiling, but a workspace
restart interrupted it after structural captures. In-memory network metadata
and the later journeys were lost despite the completed structure evidence.

**How to apply:** Save each completed section and its immutable source/build
pins. Resume only missing sections on identical inputs. Keep raw interruptions
and distinguish replayed comparisons from freshly captured browser evidence.
