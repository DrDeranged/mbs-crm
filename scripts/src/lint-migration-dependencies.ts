import { createServer } from "node:net";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cloneProduction, defaultCloneConfig, startExistingManagedCloneServer, stopManagedCloneServer } from "./dbCloneProd";
import { localPostgresUrl } from "./localPostgres";

export type MigrationNumber = { name: string; number: number };
export type LintResult = {
  baselineTables: number; baselineColumns: number; migrationsChecked: number;
  tableReferencesChecked: number; columnReferencesChecked: number;
};

const filePattern = /^([0-9]{3,})_([a-z][a-z0-9]*(?:_[a-z0-9]+)*)\.sql$/;

/** Strict, intentionally side-effect-free migration discovery. */
export function numberMigrations(names: string[]): MigrationNumber[] {
  const result: MigrationNumber[] = [];
  const seen = new Set<number>();
  for (const name of names) {
    const match = name.match(filePattern);
    if (!match) throw new Error(`invalid migration filename: ${name}`);
    const number = Number(match[1]);
    if (number <= 0 || !Number.isSafeInteger(number) || seen.has(number)) throw new Error(`duplicate or unsafe migration number: ${name}`);
    seen.add(number);
    result.push({ name, number });
  }
  result.sort((a, b) => a.number - b.number);
  return result;
}

type Operation = { kind: "create" | "reference"; table: string };
export type MigrationSqlAnalysis = { operations: Operation[]; dynamic: boolean };

/**
 * Count syntactically explicit column references without changing the table
 * inventory.  This is intentionally informational: the dependency checks
 * below still use PostgreSQL as the source of truth.
 */
export function countColumnReferences(sql: string): number {
  const clean = sql.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
  const references = new Set<string>();
  const ident = String.raw`(?:"(?:[^"]|"")+"|[a-z_][a-z0-9_$]*)`;
  const relation = `${ident}(?:\\s*\\.\\s*${ident})?`;
  const tableName = (value: string) => value.trim().split(".").at(-1)!.replace(/^"|"$/g, "").replaceAll('""', '"').toLowerCase();
  const columns = (value: string) => value.split(",").map(v => v.trim())
    .filter(v => new RegExp(`^${ident}$`, "i").test(v))
    .map(v => v.replace(/^"|"$/g, "").replaceAll('""', '"').toLowerCase());

  for (const m of clean.matchAll(new RegExp(String.raw`\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+${ident}\s+ON\s+(${relation})\s*\(([^)]*)\)`, "gi"))) {
    for (const column of columns(m[2])) references.add(`index:${tableName(m[1])}:${column}`);
  }
  for (const m of clean.matchAll(new RegExp(String.raw`\bREFERENCES\s+(${relation})\s*(?:\(([^)]*)\))?`, "gi"))) {
    for (const column of columns(m[2] ?? "")) references.add(`references:${tableName(m[1])}:${column}`);
  }
  for (const m of clean.matchAll(new RegExp(String.raw`\bALTER\s+TABLE\s+(${relation})[\s\S]*?\bADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?\s+(${ident})`, "gi"))) {
    references.add(`alter:${tableName(m[1])}:${m[2].replace(/^"|"$/g, "").replaceAll('""', '"').toLowerCase()}`);
  }
  for (const m of clean.matchAll(new RegExp(String.raw`\bINSERT\s+INTO\s+(${relation})\s*\(([^)]*)\)`, "gi"))) {
    for (const column of columns(m[2])) references.add(`insert:${tableName(m[1])}:${column}`);
  }
  for (const m of clean.matchAll(new RegExp(String.raw`\bUPDATE\s+(${relation})\s+SET\s+([^;]+?)(?=\bWHERE\b|;|$)`, "gi"))) {
    for (const assignment of m[2].split(",")) {
      const column = assignment.match(new RegExp(`^\\s*(${ident})\\s*=`, "i"))?.[1];
      if (column) references.add(`update:${tableName(m[1])}:${column.replace(/^"|"$/g, "").replaceAll('""', '"').toLowerCase()}`);
    }
  }
  for (const m of clean.matchAll(new RegExp(String.raw`\b(${ident})\s*\.\s*(${ident})\b`, "gi"))) {
    references.add(`qualified:${m[1].replace(/^"|"$/g, "").toLowerCase()}:${m[2].replace(/^"|"$/g, "").toLowerCase()}`);
  }
  for (const m of clean.matchAll(new RegExp(String.raw`\b(?:PERFORM|SELECT)\s+(${ident})\s+FROM\s+(${relation})`, "gi"))) {
    references.add(`query:${tableName(m[2])}:${m[1].replace(/^"|"$/g, "").toLowerCase()}`);
  }
  return references.size;
}

/*
 * This is deliberately structural rather than an inventory.  Inventory
 * mutation was the source of several false negatives in the old linter.
 * The migration runner's analyzer has the same operation contract; keeping
 * this tiny adapter in scripts avoids making scripts' rootDir depend on lib.
 */
export function analyzeMigrationSql(sql: string): MigrationSqlAnalysis {
  const operations: Operation[] = [];
  const clean = sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    // String literals can contain prose such as "from the review page"; they
    // are values, not relation references.
    .replace(/'(?:''|[^'])*'/g, "''");
  let dynamic = false;
  if (/\bDO\s+\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\b(?:EXECUTE|format\s*\(|quote_ident\s*\()/i.test(clean)) dynamic = true;
  const relation = String.raw`(?:"(?:[^"]|"")+"|[a-z_][a-z0-9_$]*)(?:\s*\.\s*(?:"(?:[^"]|"")+"|[a-z_][a-z0-9_$]*))?`;
  const identifier = (value: string) =>
    value.trim().replace(/^"|"$/g, "").replaceAll('""', '"').toLowerCase();
  const parts = (value: string) => {
    const identifiers = value.split(".").map(identifier);
    return {
      schema: identifiers.length > 1 ? identifiers.at(-2) : undefined,
      table: identifiers.at(-1)!,
    };
  };
  const name = (value: string) => parts(value).table;
  const ctes = new Set<string>();
  for (const m of clean.matchAll(new RegExp(String.raw`(?:\bWITH\s+(?:RECURSIVE\s+)?|,)\s*(${relation})(?:\s*\(\s*${relation}(?:\s*,\s*${relation})*\s*\))?\s+AS\s*\(`, "gi"))) ctes.add(name(m[1]));
  for (const m of clean.matchAll(new RegExp(String.raw`\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(${relation})`, "gi"))) operations.push({ kind: "create", table: name(m[1]) });
  for (const m of clean.matchAll(new RegExp(String.raw`\b(?:ALTER\s+TABLE|CREATE\s+(?:UNIQUE\s+)?INDEX[\s\S]*?\bON|REFERENCES|FROM|JOIN|UPDATE|INTO|DELETE\s+FROM)\s+(${relation})`, "gi"))) {
    const parsed = parts(m[1]);
    const table = parsed.table;
    if (!ctes.has(table) && parsed.schema !== "pg_catalog" &&
        parsed.schema !== "information_schema" && !table.startsWith("pg_") &&
        !["select", "values", "lateral"].includes(table)) {
      operations.push({ kind: "reference", table });
    }
  }
  return { operations, dynamic };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function errorText(error: unknown): string {
  const value = error as { stderr?: unknown; message?: unknown } | undefined;
  return `${value?.stderr ?? value?.message ?? ""}`;
}
function safePgObject(stderr: string): { object?: string; kind?: "table" | "column" } {
  const relation = stderr.match(/relation "([^"]+)" does not exist/i);
  if (relation) return { object: relation[1], kind: "table" };
  const column = stderr.match(/column ([\w$]+)\.([\w$]+) does not exist/i) ?? stderr.match(/column "([^"]+)" does not exist/i);
  if (column) return { object: column[2] ?? column[1], kind: "column" };
  return {};
}
function dollarBodies(sql: string): string[] {
  sql = sql.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
  const bodies: string[] = [];
  const opener = /\bDO\s+(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)/gi;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(sql))) {
    const end = sql.indexOf(match[1], opener.lastIndex);
    if (end < 0) throw new Error("malformed procedural dollar body");
    bodies.push(sql.slice(opener.lastIndex, end));
    opener.lastIndex = end + match[1].length;
  }
  // A DO keyword without a dollar quote is not a supported, safely
  // inspectable procedural form.
  if (/(?:^|;)\s*DO\s+(?!\$)/i.test(sql)) throw new Error("unsupported procedural SQL");
  return bodies;
}
function stripExistsGuards(body: string): string {
  let output = body;
  const opener = /\bIF\s+(?:NOT\s+)?EXISTS\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(output))) {
    let at = opener.lastIndex;
    let depth = 1;
    let quote = "";
    let end = -1;
    for (; at < output.length; at++) {
      const char = output[at];
      const next = output[at + 1];
      if (quote) {
        if (char === quote && next === quote) { at++; continue; }
        if (char === quote) quote = "";
        continue;
      }
      if (char === "'" || char === '"') { quote = char; continue; }
      if (char === "(") depth++;
      else if (char === ")") depth--;
      if (depth < 0) throw new Error("malformed procedural EXISTS guard");
      if (depth === 0) {
        const then = output.slice(at + 1).match(/^\s*THEN\b/i);
        if (then) {
          end = at + 1 + then[0].length;
          break;
        }
      }
    }
    if (end < 0) throw new Error("malformed procedural EXISTS guard");
    output = output.slice(0, match.index) + " ".repeat(end - match.index) + output.slice(end);
    opener.lastIndex = match.index;
  }
  return output;
}
function proceduralStatements(body: string): string[] {
  const clean = stripExistsGuards(
    body.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " "),
  );
  const statements: string[] = [];
  const pattern = /\b(PERFORM|SELECT|INSERT|UPDATE|DELETE|ALTER\s+TABLE)\b([\s\S]*?);/gi;
  for (const match of clean.matchAll(pattern)) {
    const keyword = match[1].toUpperCase().replace(/\s+/g, " ");
    const expression = match[2].trim();
    if (!expression || /\b(EXECUTE|FORMAT|QUOTE_IDENT)\b/i.test(expression)) throw new Error("dynamic or unsupported procedural SQL");
    statements.push(`${keyword === "PERFORM" ? "SELECT" : keyword} ${expression};`);
  }
  // Anything that looks like an executable statement but was not recognized
  // is rejected rather than silently skipping a lazy branch.
  if (/\b(?:PERFORM|SELECT|INSERT|UPDATE|DELETE|ALTER\s+TABLE)\b/i.test(clean) &&
      statements.length === 0) throw new Error("unsupported procedural SQL");
  return statements;
}
function splitSql(sql: string): string[] {
  const result: string[] = []; let start = 0; let quote = ""; let dollar = ""; let depth = 0;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i], n = sql[i + 1];
    if (quote === "--") { if (c === "\n") quote = ""; continue; }
    if (quote) { if (c === quote && n === quote) { i++; continue; } if (c === quote) quote = ""; continue; }
    if (c === "-" && n === "-") { quote = "--"; i++; continue; }
    if (quote) continue;
    if (c === "$") { const m = sql.slice(i).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/); if (m) { if (dollar === m[0]) { i += m[0].length - 1; dollar = ""; } else if (!dollar) { dollar = m[0]; i += m[0].length - 1; } continue; } }
    if (dollar) continue;
    if (c === "'" || c === '"') { quote = c; continue; }
    if (c === "(") depth++; else if (c === ")") depth--;
    else if (c === ";" && depth === 0) { if (sql.slice(start, i).trim()) result.push(sql.slice(start, i).trim()); start = i + 1; }
  }
  if (dollar || quote === "'") throw new Error("malformed SQL statement");
  if (sql.slice(start).trim()) result.push(sql.slice(start).trim());
  return result;
}
function statementTable(sql: string): string | undefined {
  const match = sql.match(/\b(?:FROM|JOIN|UPDATE|INTO|DELETE\s+FROM|ALTER\s+TABLE)\s+(?:"[^"]+"|[a-z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[a-z_][\w$]*))?/i);
  return match?.[0].split(/\s+/).at(-1)?.split(".").at(-1)?.replace(/^"|"$/g, "").toLowerCase();
}
function columnCreatorForStatement(sql: string, column: string, futureColumns: Map<string, number>): number | undefined {
  const table = statementTable(sql);
  return table ? futureColumns.get(`${table}.${column.toLowerCase()}`) : undefined;
}

async function query(config: ReturnType<typeof defaultCloneConfig>, sql: string): Promise<string> {
  const result = await config.process.capture(config.psqlBinary, ["--dbname", localPostgresUrl(config.port, config.database),
    "--tuples-only", "--no-align", "--field-separator=|", "--command", sql]);
  if (result.code !== 0) throw new Error("baseline catalog query failed");
  return result.stdout.trim();
}
async function validateProceduralBodies(
  config: ReturnType<typeof defaultCloneConfig>, migration: MigrationNumber, sql: string,
  future: Map<string, number>, futureColumns: Map<string, number>,
): Promise<void> {
  if (/\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\b/i.test(sql))
    throw new Error(`${migration.name}: unsupported opaque procedural SQL`);
  let topLevelStatements: string[];
  try { topLevelStatements = splitSql(sql); } catch (error) {
    throw new Error(`${migration.name}: ${error instanceof Error ? error.message : "unsupported procedural SQL"}`);
  }
  for (let topLevelIndex = 0; topLevelIndex < topLevelStatements.length; topLevelIndex++) {
    const topLevel = topLevelStatements[topLevelIndex];
    if (!/^\s*DO\b/i.test(topLevel)) continue;
    let body: string;
    try {
      const bodies = dollarBodies(topLevel);
      if (bodies.length !== 1) throw new Error("unsupported procedural SQL");
      body = bodies[0];
    } catch (error) {
      throw new Error(`${migration.name}: ${error instanceof Error ? error.message : "unsupported procedural SQL"}`);
    }
    let statements: string[];
    try { statements = proceduralStatements(body); } catch (error) {
      throw new Error(`${migration.name}: ${error instanceof Error ? error.message : "unsupported procedural SQL"}`);
    }
    const validated: string[] = [];
    const prelude = topLevelStatements.slice(0, topLevelIndex).join(";\n");
    for (const statement of statements) {
      const result = await config.process.capture(config.psqlBinary, [
        "--dbname", localPostgresUrl(config.port, config.database),
        "--set=ON_ERROR_STOP=on", "--command",
        `BEGIN; ${prelude}; ${[...validated, statement].join("\n")} ROLLBACK;`,
      ]);
      if (result.code === 0) {
        validated.push(statement);
        continue;
      }
      if (/^(?:ALTER\s+TABLE|UPDATE|INSERT|DELETE)\b/i.test(statement) &&
          /\bIF\s+(?:NOT\s+)?EXISTS\b|EXCEPTION\s+WHEN\s+duplicate_object/i.test(body) &&
          /\b(?:already exists|duplicate_object|duplicate key)\b/i.test(result.stderr)) continue;
      const safe = safePgObject(result.stderr);
      const columnCreator = safe.kind === "column" && safe.object
        ? columnCreatorForStatement(statement, safe.object, futureColumns) : undefined;
      const creator = safe.object && (future.get(safe.object) ?? columnCreator);
      const classification = creator && creator > migration.number ? "FORWARD" : "MISSING";
      const object = safe.kind === "column" && safe.object && statementTable(statement)
        ? `${statementTable(statement)}.${safe.object}` : safe.object;
      throw new Error(`${migration.name}: ${object ?? "schema object"}: ${classification}`);
    }
  }
}

export async function lintMigrationDependencies(root = path.resolve(import.meta.dirname, "../..")): Promise<LintResult> {
  const migrationDir = path.join(root, "lib/db/migrations");
  const names = await readdir(migrationDir);
  const migrations = numberMigrations(names);
  const workspace = await mkdtemp(path.join(os.tmpdir(), "migration-dependency-lint-"));
  const port = await freePort();
  const config = defaultCloneConfig(workspace);
  config.port = port;
  config.log = () => {};
  config.backupSource = path.join(workspace, "backups/production/baseline.sql");
  let started = false;
  let primary: unknown;
  try {
    const baseline = path.join(root, "lib/db/schema-ci-baseline/000_pre_runner_schema.sql");
    const backup = path.join(workspace, "backups/production/baseline.sql");
    await writeFile(backup, await readFile(baseline), { flag: "w" }).catch(async () => {
      const { mkdir } = await import("node:fs/promises"); await mkdir(path.dirname(backup), { recursive: true });
      await writeFile(backup, await readFile(baseline));
    });
    await cloneProduction(config);
    ({ startedByCaller: started } = await startExistingManagedCloneServer(config));
    const baselineRows = await query(config, `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position`);
    const baselineTables = new Set<string>();
    const baselineColumns = new Set<string>();
    for (const row of baselineRows.split("\n").filter(Boolean)) {
      const [table, column] = row.split("|"); baselineTables.add(table); baselineColumns.add(`${table}.${column}`);
    }
    const baselineTableCount = baselineTables.size;
    const baselineColumnCount = baselineColumns.size;
    await query(config, `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now(),
        checksum text NOT NULL,
        failed_at timestamptz,
        error text,
        superseded_at timestamptz
      )
    `);
    baselineTables.add("schema_migrations");
    const future = new Map<string, number>();
    const futureColumns = new Map<string, number>();
    const tableRefs = new Set<string>(); let columns = 0;
    for (const migration of migrations) {
      const sql = await readFile(path.join(migrationDir, migration.name), "utf8");
      const analysis = analyzeMigrationSql(sql);
      if (analysis.dynamic) throw new Error(`${migration.name}: dynamic SQL cannot be analyzed`);
      for (const operation of analysis.operations) {
        if (operation.kind === "create") future.set(operation.table, migration.number);
        else tableRefs.add(`${migration.number}:${operation.table}`);
      }
      for (const match of sql.matchAll(/\bALTER\s+TABLE\s+(?:"[^"]+"|[a-z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[a-z_][\w$]*))?\s+ADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?\s+(?:"[^"]+"|[a-z_][\w$]*)/gi)) {
        const table = match[0].match(/\bTABLE\s+(?:"([^"]+)"|([a-z_][\w$]*))(?:\s*\.\s*(?:"([^"]+)"|([a-z_][\w$]*)))?/i);
        const column = match[0].match(/\bCOLUMN(?:\s+IF\s+NOT\s+EXISTS)?\s+(?:"([^"]+)"|([a-z_][\w$]*))\s*$/i);
        if (table && column) futureColumns.set(`${(table[3] ?? table[4] ?? table[1] ?? table[2]).toLowerCase()}.${(column[1] ?? column[2]).toLowerCase()}`, migration.number);
      }
    }
    const visible = new Set(baselineTables);
    for (const migration of migrations) {
      const sql = await readFile(path.join(migrationDir, migration.name), "utf8");
      const analysis = analyzeMigrationSql(sql);
      // Same-file create operations are visible to later operations.
      for (const operation of analysis.operations) {
        if (operation.kind === "reference" && !visible.has(operation.table)) {
          const creator = future.get(operation.table);
          throw new Error(`${migration.name}: ${operation.table}: ${creator && creator > migration.number ? "FORWARD" : "MISSING"}`);
        }
        if (operation.kind === "create") visible.add(operation.table);
      }
      columns += countColumnReferences(sql);
      await validateProceduralBodies(config, migration, sql, future, futureColumns);
      const statements = splitSql(sql);
      const command = `BEGIN;\n${statements.map(statement => `${statement};`).join("\n")}\nCOMMIT;`;
      let result = await config.process.capture(config.psqlBinary, ["--dbname", localPostgresUrl(config.port, config.database),
        "--set=ON_ERROR_STOP=on", "--command", command]);
      if (result.code !== 0) {
        // Replay prefixes in rollback-only transactions to attribute the
        // failure without ever exposing SQL or changing the live schema.
        let failing = sql;
        for (let i = 0; i < statements.length; i++) {
          const probe = await config.process.capture(config.psqlBinary, ["--dbname", localPostgresUrl(config.port, config.database),
            "--set=ON_ERROR_STOP=on", "--command", `BEGIN;\n${statements.slice(0, i + 1).map(statement => `${statement};`).join("\n")}\nROLLBACK;`]);
          if (probe.code !== 0) { failing = statements[i]; result = probe; break; }
        }
        const safe = safePgObject(result.stderr);
        const columnCreator = safe.kind === "column" && safe.object
          ? columnCreatorForStatement(failing, safe.object, futureColumns) : undefined;
        const creator = safe.object && (future.get(safe.object) ?? columnCreator);
        const object = safe.kind === "column" && safe.object && statementTable(failing)
          ? `${statementTable(failing)}.${safe.object}` : safe.object;
        throw new Error(`${migration.name}: ${object ?? "schema object"}: ${creator && creator > migration.number ? "FORWARD" : "MISSING"}`);
      }
    }
    return { baselineTables: baselineTableCount, baselineColumns: baselineColumnCount, migrationsChecked: migrations.length,
      tableReferencesChecked: tableRefs.size, columnReferencesChecked: columns };
  } catch (error) { primary = error; throw error; }
  finally {
    let cleanup: unknown;
    try { if (started) await stopManagedCloneServer(config); } catch (error) { cleanup = error; }
    try { await rm(workspace, { recursive: true, force: true }); } catch (error) { cleanup = cleanup ? new AggregateError([cleanup, error]) : error; }
    if (cleanup && primary) throw new AggregateError([primary, cleanup], "migration dependency lint failed and cleanup failed");
    if (cleanup) throw cleanup;
  }
}

async function main(): Promise<void> {
  try {
    const result = await lintMigrationDependencies();
    console.log(`baseline tables: ${result.baselineTables}`);
    console.log(`baseline columns: ${result.baselineColumns}`);
    console.log(`migrations checked: ${result.migrationsChecked}`);
    console.log(`table references checked: ${result.tableReferencesChecked}`);
    console.log(`column references checked: ${result.columnReferencesChecked}`);
    console.log("MIGRATION DEPENDENCY LINT PASS");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "migration dependency lint failed");
    process.exitCode = 1;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) void main();