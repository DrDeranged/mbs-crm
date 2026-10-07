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
  // Applied by the transactional migration ledger before lint verification.
  // Preserve its applied identity; the exemption is exact-byte scoped, not a
  // filename-only bypass. Empty/existing-schema rehearsal still executes it.
  "067_campaign_attribution.sql": "f2990978aa8e8a905a11dd746986b21e89a97d428474651a703d97559b2988ba",
};

function lineAt(sql: string, index: number): number {
  return sql.slice(0, index).split("\n").length;
}

type Guard = { start: number; end: number; condition: string; duplicateHandler: boolean };
function maskSqlComments(contents: string): string {
  let output = "", quote = "", blockDepth = 0;
  for (let i = 0; i < contents.length; i++) {
    const c = contents[i], next = contents[i + 1];
    if (blockDepth) {
      if (c === "/" && next === "*") { blockDepth++; output += "  "; i++; }
      else if (c === "*" && next === "/") { blockDepth--; output += "  "; i++; }
      else output += c === "\n" ? "\n" : " ";
    } else if (quote) {
      output += c;
      if (c === quote) {
        if (next === quote) { output += next; i++; }
        else quote = "";
      }
    } else if (c === "'" || c === '"') { quote = c; output += c; }
    else if (c === "/" && next === "*") { blockDepth = 1; output += "  "; i++; }
    else if (c === "-" && next === "-") {
      while (i < contents.length && contents[i] !== "\n") { output += " "; i++; }
      if (i < contents.length) output += "\n";
    } else output += c;
  }
  return output;
}
function guardedDoRanges(sql: string): Guard[] {
  const ranges: Guard[] = [];
  const blocks = /\bDO\s+(\$[a-z_0-9]*\$)[\s\S]*?END\s+\1\s*;/gi;
  for (const match of sql.matchAll(blocks)) {
    const block = match[0];
    if (/EXCEPTION\s+WHEN\s+duplicate_object\s+THEN\s+NULL\s*;/i.test(block)) {
      ranges.push({ start: match.index, end: match.index + block.length, condition: "", duplicateHandler: true });
    }
    const stack: Array<{ start: number; condition: string; thenEnd?: number }> = [];
    // Track actual control-flow guards; an unrelated pg_constraint query no
    // longer exempts every DDL statement in a procedural block.
    const control = block.replace(/'(?:''|[^'])*'/g, text => " ".repeat(text.length));
    for (const token of control.matchAll(/\bIF\s+(?:NOT\s+)?EXISTS\s*\([\s\S]*?\)\s*THEN|\bEND\s+IF\b|\bELSE\b/gi)) {
      if (/^END/i.test(token[0])) {
        const open = stack.pop();
        if (open && /^IF\s+NOT\s+EXISTS/i.test(open.condition)) {
          ranges.push({ start: match.index + open.start, end: match.index + (open.thenEnd ?? token.index), condition: open.condition, duplicateHandler: false });
        }
      } else if (/^ELSE/i.test(token[0])) {
        if (stack.length) stack[stack.length - 1].thenEnd = token.index;
      } else stack.push({ start: token.index + token[0].length, condition: block.slice(token.index, token.index + token[0].length) });
    }
  }
  return ranges;
}

function inGuardedRange(index: number, ranges: Guard[], operation: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return ranges.some(({ start, end, condition, duplicateHandler }) => {
    if (index < start || index >= end) return false;
    if (duplicateHandler) return operation === "ADD CONSTRAINT";
    const column = operation === "ADD CONSTRAINT" ? "conname" : operation === "ADD COLUMN" ? "column_name"
      : operation === "CREATE INDEX" ? "indexname" : "table_name";
    const catalog = operation === "ADD CONSTRAINT" ? /pg_constraint/i : operation === "CREATE INDEX" ? /pg_indexes/i : /information_schema\.(columns|tables)/i;
    return catalog.test(condition) && new RegExp(`\\b${column}\\s*=\\s*'${escaped}'`, "i").test(condition);
  });
}

export function lintMigrationSql(file: string, contents: string): MigrationLintViolation[] {
  const withoutComments = maskSqlComments(contents);
  const guardedRanges = guardedDoRanges(withoutComments);
  const violations: MigrationLintViolation[] = [];
  const checks: Array<{ operation: string; regex: RegExp }> = [
    { operation: "CREATE TABLE", regex: /\bCREATE\s+(?:(?:UNLOGGED|TEMP(?:ORARY)?)\s+)?TABLE\b\s*/gi },
    { operation: "CREATE INDEX", regex: /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b\s*(?:CONCURRENTLY\b\s*)?/gi },
    { operation: "ADD COLUMN", regex: /\bADD\s+COLUMN\b\s*/gi },
  ];

  for (const { operation, regex } of checks) {
    for (const match of withoutComments.matchAll(regex)) {
      if (/^\s*IF\s+NOT\s+EXISTS\b/i.test(withoutComments.slice(match.index + match[0].length))) continue;
      const name = withoutComments.slice(match.index + match[0].length).match(/^\s*("(?:""|[^"])+"|[\w$]+)/)?.[1]?.replace(/^"|"$/g, "").replaceAll('""', '"') ?? "";
      if (!inGuardedRange(match.index, guardedRanges, operation, name)) {
        violations.push({ file, line: lineAt(contents, match.index), operation });
      }
    }
  }

  for (const match of withoutComments.matchAll(/\bADD\s+CONSTRAINT\s+("(?:""|[^"])+"|[a-zA-Z_][\w$]*)/gi)) {
    const constraint = match[1].replace(/^"|"$/g, "").replaceAll('""', '"');
    if (inGuardedRange(match.index, guardedRanges, "ADD CONSTRAINT", constraint)) continue;
    const prefix = withoutComments.slice(Math.max(0, match.index - 500), match.index);
    const escaped = constraint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const dropGuard = new RegExp(`DROP\\s+CONSTRAINT\\s+IF\\s+EXISTS\\s+"?${escaped}"?(?=\\s|;)`, "i");
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