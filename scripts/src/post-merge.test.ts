import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const workspaceRoot = path.resolve(import.meta.dirname, "../..");

test("post-merge applies a pending migration to the development ledger before the guard", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "post-merge-"));
  const pnpm = path.join(directory, "pnpm");
  const ledger = path.join(directory, "ledger.txt");
  const calls = path.join(directory, "calls.txt");
  await writeFile(pnpm, `#!/bin/bash
set -euo pipefail
echo "$*" >> "$CALLS"
if [[ "$*" == "-w run migrate:development" ]]; then
  echo "999_newly_merged_feature" >> "$LEDGER"
elif [[ "$*" == "-w run guard:schema-path" ]]; then
  grep -qx "999_newly_merged_feature" "$LEDGER"
fi
`, { mode: 0o755 });

  try {
    await execFileAsync("bash", [path.join(workspaceRoot, "scripts/post-merge.sh")], {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        CALLS: calls,
        LEDGER: ledger,
      },
    });
    assert.equal((await readFile(ledger, "utf8")).trim(), "999_newly_merged_feature");
    assert.deepEqual((await readFile(calls, "utf8")).trim().split("\n"), [
      "install --frozen-lockfile",
      "-w run migrate:development",
      "-w run guard:schema-path",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});