import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type MigrationLintViolation = {
  file: string;
  line: number;
  operation: string;
};

const legacyUnsafeChecksums: Record<string, string> = {
  // 032 is historical and already deployed; keep its checksum-scoped exemption
  // rather than rewriting an applied migration's identity.
  "032_finance_application_collateral.sql": "57c07e85f37a80aae9c0c2ea3f2f2445887b4728386f4dfcfe3f0e776c25804c",
  "020_lender_submissions.sql": "1ef5d4e359cd3626037a5ea45a08087aaf783b8816ad2b7e5be0301476719f48",
  "030_add_application_collateral.sql": "33c910dadd587a5cc37c2f499c4f185a9b8e3cdb624a515b9ae2b967fb583fdb",
  "031_collateral_library.sql": "adbd86747569c0b02956d5b38debfc81e326c874aa7bbede7a73398d95fde4b3",
  "036_partners_contacts.sql": "35f6d26c0369bd046876d06ad7abfe636c499ddf4d4786bdb4c28e19f59952c9",
};

function lineAt(sql: string, index: number): number {
  return sql.slice(0, index).split("\n").length;
}

function guardedDoRanges(sql: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const blocks = /\bDO\s+\$\$[\s\S]*?END\s+\$\$\s*;/gi;
  for (const match of sql.matchAll(blocks)) {
    const block = match[0];
    if (
      /EXCEPTION\s+WHEN\s+duplicate_object/i.test(block)
      || /pg_constraint|information_schema\.(?:columns|tables)/i.test(block)
    ) {
      ranges.push([match.index, match.index + block.length]);
    }
  }
  return ranges;
}

function inGuardedRange(index: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

export function lintMigrationSql(file: string, contents: string): MigrationLintViolation[] {
  const withoutComments = contents.replace(/--.*$/gm, (comment) => " ".repeat(comment.length));
  const guardedRanges = guardedDoRanges(withoutComments);
  const violations: MigrationLintViolation[] = [];
  const checks: Array<{ operation: string; regex: RegExp }> = [
    { operation: "CREATE TABLE", regex: /\bCREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS\b)/gi },
    { operation: "CREATE INDEX", regex: /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS\b)/gi },
    { operation: "ADD COLUMN", regex: /\bADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS\b)/gi },
  ];

  for (const { operation, regex } of checks) {
    for (const match of withoutComments.matchAll(regex)) {
      if (!inGuardedRange(match.index, guardedRanges)) {
        violations.push({ file, line: lineAt(contents, match.index), operation });
      }
    }
  }

  for (const match of withoutComments.matchAll(/\bADD\s+CONSTRAINT\s+([a-zA-Z_][\w$]*)/gi)) {
    if (inGuardedRange(match.index, guardedRanges)) continue;
    const constraint = match[1];
    const prefix = withoutComments.slice(Math.max(0, match.index - 500), match.index);
    const dropGuard = new RegExp(`DROP\\s+CONSTRAINT\\s+IF\\s+EXISTS\\s+${constraint}\\b`, "i");
    if (!dropGuard.test(prefix)) {
      violations.push({
        file,
        line: lineAt(contents, match.index),
        operation: `ADD CONSTRAINT ${constraint}`,
      });
    }
  }
  return violations;
}

export async function lintMigrationDirectory(directory: string): Promise<MigrationLintViolation[]> {
  const violations: MigrationLintViolation[] = [];
  const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const contents = await readFile(path.join(directory, file), "utf8");
    const fileViolations = lintMigrationSql(file, contents);
    if (fileViolations.length === 0) continue;
    const legacyChecksum = legacyUnsafeChecksums[file];
    const checksum = createHash("sha256").update(contents).digest("hex");
    if (legacyChecksum === checksum) continue;
    violations.push(...fileViolations);
  }
  return violations;
}

async function main(): Promise<void> {
  const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../lib/db/migrations");
  const violations = await lintMigrationDirectory(directory);
  if (violations.length === 0) {
    process.stdout.write("Migration idempotency lint passed.\n");
    return;
  }
  for (const violation of violations) {
    process.stderr.write(
      `${violation.file}:${violation.line} unguarded ${violation.operation}; use IF NOT EXISTS or an idempotent exception/existence guard.\n`,
    );
  }
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}