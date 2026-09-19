import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RECOVERY_REPLACEMENTS: Record<string, string[]> = {
  "lib/db/migrations/037_partner_contacts_prerequisite.sql": ["lib/db/migrations/047_partner_contacts_prerequisite.sql"],
  "lib/db/migrations/040_complete_partner_contacts_recovery.sql": ["lib/db/migrations/046_complete_partner_contacts_recovery.sql"],
  "artifacts/mbs-crm/public/favicon-16x16.png": ["artifacts/mbs-crm/public/favicon.ico", "artifacts/mbs-crm/public/favicon-32x32.png"],
  "artifacts/mbs-crm/public/favicon-180.png": ["artifacts/mbs-crm/public/favicon-180x180.png"],
  "artifacts/mbs-crm/public/favicon-192.png": ["artifacts/mbs-crm/public/favicon-192x192.png"],
  "artifacts/mbs-crm/public/favicon-512.png": ["artifacts/mbs-crm/public/favicon-512x512.png"],
};

export const RECOVERY_CRITICAL_PATHS = [
  "lib/db/src/migrate.ts", "lib/db/migrations/046_complete_partner_contacts_recovery.sql",
  "lib/db/migrations/047_partner_contacts_prerequisite.sql", "scripts/src/lint-migrations.ts",
  "scripts/src/lint-migrations.test.ts", "artifacts/api-server/src/lib/schemaBoot.test.ts",
  "artifacts/mbs-crm/public/favicon.ico", "artifacts/mbs-crm/public/favicon-32x32.png",
  "artifacts/mbs-crm/public/favicon-180x180.png", "artifacts/mbs-crm/public/favicon-192x192.png",
  "artifacts/mbs-crm/public/favicon-512x512.png",
] as const;

export function checkRestoreDeletions(deletions: string[], tree: Set<string>): string[] {
  const failures: string[] = [];
  for (const deleted of deletions) {
    const replacements = RECOVERY_REPLACEMENTS[deleted];
    if (replacements && replacements.some((replacement) => !tree.has(replacement))) {
      failures.push(`${deleted} was restored away but required replacement is missing: ${replacements.join(", ")}`);
    }
  }
  return failures;
}

const git = (args: string[], cwd: string): string => execFileSync("git", args, { cwd, encoding: "utf8" });

type GitReader = (args: string[], cwd: string) => string;

export function recoveryGuard(
  cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
  readGit: GitReader = git,
): string[] {
  // Both inputs deliberately come from the same committed tree. Reading the
  // worktree here would let an uncommitted edit make the guard disagree with
  // the tree that will actually be committed.
  const tree = new Set(readGit(["ls-tree", "-r", "--name-only", "HEAD"], cwd).trim().split("\n"));
  const missing = RECOVERY_CRITICAL_PATHS.filter((file) => !tree.has(file));
  const failures = missing.length ? [`Recovery-critical files are missing: ${missing.join(", ")}`] : [];
  let migrationsSource: string;
  try {
    migrationsSource = readGit(["show", "HEAD:lib/db/src/migrate.ts"], cwd);
  } catch {
    failures.push("Migration runner source is missing from committed HEAD");
    migrationsSource = "";
  }
  for (const reference of migrationsSource.matchAll(/\b(\d{3}_[a-z0-9_]+\.sql)\b/gi)) {
    const candidate = `lib/db/migrations/${reference[1]}`;
    if (!tree.has(candidate)) failures.push(`Migration runner references missing recovery migration ${candidate}`);
  }

  const commits = readGit(["log", "--format=%H%x09%s", "HEAD"], cwd).trim().split("\n").filter(Boolean);
  for (const line of commits) {
    const [hash, subject] = line.split("\t", 2);
    if (!subject?.startsWith("Restored to ")) continue;
    const parent = `${hash}^`;
    const deletions = readGit(["diff", "--name-status", parent, hash], cwd).split("\n")
      .filter((entry) => entry.startsWith("D\t")).map((entry) => entry.slice(2));
    failures.push(...checkRestoreDeletions(deletions, tree).map((failure) => `${hash}: ${failure}`));
  }
  return failures;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = recoveryGuard();
  if (failures.length) {
    for (const failure of failures) process.stderr.write(`${failure}\n`);
    process.exitCode = 1;
  } else process.stdout.write("Recovery guard passed.\n");
}