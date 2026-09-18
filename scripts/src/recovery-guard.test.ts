import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkRestoreDeletions, RECOVERY_CRITICAL_PATHS, recoveryGuard } from "./recovery-guard";

test("restore deletion fails when its explicit replacement is missing", () => {
  assert.match(
    checkRestoreDeletions(
      ["lib/db/migrations/037_partner_contacts_prerequisite.sql"],
      new Set<string>(),
    )[0],
    /required replacement/,
  );
  assert.deepEqual(
    checkRestoreDeletions(
      ["lib/db/migrations/037_partner_contacts_prerequisite.sql"],
      new Set(["lib/db/migrations/046_complete_partner_contacts_recovery.sql", "lib/db/migrations/047_partner_contacts_prerequisite.sql"]),
    ),
    [],
  );
});

test("dirty worktree migrate.ts cannot alter the committed-tree guard result", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "recovery-guard-"));
  try {
    await writeFile(path.join(directory, "migrate.ts"), "missing migration 999_not_real.sql");
    const tree = [...RECOVERY_CRITICAL_PATHS].join("\n");
    const gitReader = (args: string[]): string => {
      if (args[0] === "ls-tree") return tree;
      if (args[0] === "show") return "const prerequisite = '047_partner_contacts_prerequisite.sql';";
      if (args[0] === "log") return "";
      return "";
    };
    assert.deepEqual(recoveryGuard(directory, gitReader), []);
    await writeFile(path.join(directory, "migrate.ts"), "const prerequisite = '999_not_real.sql';");
    assert.deepEqual(recoveryGuard(directory, gitReader), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});