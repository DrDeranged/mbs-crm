import path from "node:path";
import os from "node:os";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import {
  defaultCloneConfig,
  startExistingManagedCloneServer,
  stopManagedCloneServer,
  type CloneConfig,
} from "./dbCloneProd";
import { localPostgresUrl } from "./localPostgres";
import { processRunner, type ProcessRunner } from "./process";

export type LedgerRow = { name: string; checksum: string; state: string };
export type LedgerSnapshot = { valid: boolean; rows: LedgerRow[] };
export type ColumnSignature = {
  name: string; type: string; nullable: boolean; defaultExpression: string | null;
  identity: string; generated: string;
};
export type TableSnapshot = { columns: Map<string, ColumnSignature> };
export type SchemaSnapshot = {
  valid: boolean; ledger: LedgerSnapshot; tables: Map<string, TableSnapshot>;
};
export type SnapshotDiff = {
  ledgerOnlyClone: string[]; ledgerOnlyDev: string[]; ledgerChanged: string[];
  tablesOnlyClone: string[]; tablesOnlyDev: string[]; columnsOnlyClone: string[];
  columnsOnlyDev: string[]; columnsChanged: string[];
};

const emptyDiff = (): SnapshotDiff => ({
  ledgerOnlyClone: [], ledgerOnlyDev: [], ledgerChanged: [], tablesOnlyClone: [], tablesOnlyDev: [],
  columnsOnlyClone: [], columnsOnlyDev: [], columnsChanged: [],
});

export function normalizeMigrationName(name: string): string {
  return name.replace(/\.sql$/i, "");
}
export function normalizeDefault(value: unknown): string | null {
  return value == null ? null : String(value).replace(/\s+/g, " ").trim();
}
const sorted = (v: Iterable<string>) => [...v].sort((a, b) => a.localeCompare(b));

export function diffSnapshots(clone: SchemaSnapshot, dev: SchemaSnapshot): SnapshotDiff {
  const out = emptyDiff();
  const cl = new Map(clone.ledger.rows.map(r => [normalizeMigrationName(r.name), r]));
  const dl = new Map(dev.ledger.rows.map(r => [normalizeMigrationName(r.name), r]));
  for (const n of cl.keys()) if (!dl.has(n)) out.ledgerOnlyClone.push(n);
  for (const n of dl.keys()) if (!cl.has(n)) out.ledgerOnlyDev.push(n);
  for (const n of cl.keys()) if (dl.has(n)) {
    const a = cl.get(n)!, b = dl.get(n)!;
    if (a.checksum !== b.checksum || a.state !== b.state) out.ledgerChanged.push(n);
  }
  for (const n of clone.tables.keys()) if (!dev.tables.has(n)) out.tablesOnlyClone.push(n);
  for (const n of dev.tables.keys()) if (!clone.tables.has(n)) out.tablesOnlyDev.push(n);
  for (const table of clTables(clone, dev)) {
    const a = clone.tables.get(table)!.columns, b = dev.tables.get(table)!.columns;
    for (const n of a.keys()) if (!b.has(n)) out.columnsOnlyClone.push(`${table}.${n}`);
    for (const n of b.keys()) if (!a.has(n)) out.columnsOnlyDev.push(`${table}.${n}`);
    for (const n of a.keys()) if (b.has(n) && JSON.stringify(a.get(n)) !== JSON.stringify(b.get(n)))
      out.columnsChanged.push(`${table}.${n}`);
  }
  for (const key of Object.keys(out) as (keyof SnapshotDiff)[]) out[key] = sorted(out[key]) as never;
  return out;
}
function clTables(a: SchemaSnapshot, b: SchemaSnapshot): string[] {
  return sorted([...a.tables.keys()].filter(n => b.tables.has(n)));
}
export function formatSnapshotDiff(diff: SnapshotDiff): string {
  const line = (label: string, values: string[]) => `${label}: ${values.length ? values.join(", ") : "none"}`;
  return [
    line("Clone-only ledger rows", diff.ledgerOnlyClone), line("Dev-only ledger rows", diff.ledgerOnlyDev),
    line("Changed ledger rows", diff.ledgerChanged), line("Clone-only tables", diff.tablesOnlyClone),
    line("Dev-only tables", diff.tablesOnlyDev), line("Clone-only columns", diff.columnsOnlyClone),
    line("Dev-only columns", diff.columnsOnlyDev), line("Changed columns", diff.columnsChanged),
  ].join("\n");
}
export function snapshotsMatch(a: SchemaSnapshot, b: SchemaSnapshot): boolean {
  const d = diffSnapshots(a, b);
  return a.valid && b.valid && Object.values(d).every(v => v.length === 0);
}

export function assertDevelopmentUrl(value: string, cloneUrl: string): URL {
  let u: URL;
  try { u = new URL(value); } catch { throw new Error("DATABASE_URL must be a valid PostgreSQL URL"); }
  if (!["postgres:", "postgresql:"].includes(u.protocol)) throw new Error("DATABASE_URL must be a PostgreSQL URL");
  let c: URL;
  try { c = new URL(cloneUrl); } catch { throw new Error("Managed clone URL is invalid"); }
  const same = u.hostname.toLowerCase() === c.hostname.toLowerCase() &&
    u.port === c.port && u.pathname === c.pathname && decodeURIComponent(u.username) === decodeURIComponent(c.username);
  if (same) throw new Error("DATABASE_URL must not target the managed clone");
  return u;
}

const SEP = "\x1f";
const snapshotSql = `BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='schema_migrations') AS ledger_exists \\gset
\\if :ledger_exists
SELECT (count(*) FILTER (WHERE column_name IN (
  'name','checksum','applied_at','failed_at','error','superseded_at'
)) = 6) AS ledger_valid
  FROM information_schema.columns WHERE table_schema='public' AND table_name='schema_migrations' \\gset
\\if :ledger_valid
SELECT 'L',replace(name::text,E'\\\\x1f',' '),replace(checksum::text,E'\\\\x1f',' '),
       CASE WHEN failed_at IS NOT NULL OR error IS NOT NULL THEN 'failed'
            WHEN superseded_at IS NOT NULL THEN 'superseded' ELSE 'applied' END
  FROM schema_migrations;
\\else
SELECT 'X','','','';
\\endif
\\else
SELECT 'X','','','';
\\endif
SELECT 'T',table_name,'' FROM information_schema.tables
 WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> 'schema_migrations'
UNION SELECT 'T',c.relname,'' FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind='p' AND c.relname <> 'schema_migrations';
SELECT 'C',i.table_name, i.column_name, format_type(a.atttypid,a.atttypmod),
       CASE WHEN i.is_nullable='YES' THEN 'true' ELSE 'false' END,
       replace(coalesce(i.column_default,''),E'\\\\x1f',' '),
       coalesce(i.identity_generation,''), CASE WHEN i.is_generated='ALWAYS' THEN 'ALWAYS' ELSE '' END
  FROM information_schema.columns i JOIN pg_attribute a ON a.attname=i.column_name
  JOIN pg_class c ON c.oid=a.attrelid AND c.relname=i.table_name
  JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE i.table_schema='public' AND i.table_name <> 'schema_migrations'
   AND n.nspname='public' AND a.attnum > 0 AND NOT a.attisdropped;
COMMIT;`;

export function parseSnapshotOutput(output: string): SchemaSnapshot {
  const ledger: LedgerSnapshot = { valid: false, rows: [] };
  const tables = new Map<string, TableSnapshot>();
  for (const line of output.split(/\r?\n/)) {
    const p = line.split(SEP);
    if (p[0] === "L" && p.length >= 4) {
      ledger.valid = true;
      if (p[1]) ledger.rows.push({ name: normalizeMigrationName(p[1]), checksum: p[2], state: p[3] });
    } else if (p[0] === "X") ledger.valid = false;
    else if (p[0] === "T" && p[1] && p[1] !== "schema_migrations") tables.set(p[1], { columns: new Map() });
    else if (p[0] === "C" && p[1] !== "schema_migrations" && p.length >= 8 && tables.has(p[1])) tables.get(p[1])!.columns.set(p[2], {
      name: p[2], type: p[3], nullable: p[4] === "true", defaultExpression: normalizeDefault(p[5]),
      identity: p[6], generated: p[7],
    });
  }
  return { valid: ledger.valid, ledger, tables };
}

export async function snapshotDatabase(url: string, runner: ProcessRunner = processRunner): Promise<SchemaSnapshot> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "db-divergence-"));
  const sqlFile = path.join(directory, "snapshot.sql");
  try {
    await writeFile(sqlFile, snapshotSql, { mode: 0o600 });
    const result = await runner.capture("psql", ["--dbname", url, "--tuples-only", "--no-align",
      `--field-separator=${SEP}`, "--set=ON_ERROR_STOP=on", "--file", sqlFile]);
    if (result.code !== 0) throw new Error("Database snapshot query failed");
    return parseSnapshotOutput(result.stdout);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function compareDatabases(devUrl: string, cloneConfig = defaultCloneConfig(), runner: ProcessRunner = cloneConfig.process): Promise<{ diff: SnapshotDiff; valid: boolean }> {
  const cloneUrl = localPostgresUrl(cloneConfig.port, cloneConfig.database);
  assertDevelopmentUrl(devUrl, cloneUrl);
  let startedByCaller = false;
  try {
    ({ startedByCaller } = await startExistingManagedCloneServer(cloneConfig));
    const [cloneResult, devResult] = await Promise.allSettled([
      snapshotDatabase(cloneUrl, runner),
      snapshotDatabase(devUrl, runner),
    ]);
    if (cloneResult.status === "rejected") throw new Error("Managed clone snapshot failed");
    if (devResult.status === "rejected") throw new Error("Development database snapshot failed");
    const clone = cloneResult.value;
    const dev = devResult.value;
    return { diff: diffSnapshots(clone, dev), valid: clone.valid && dev.valid };
  } finally {
    if (startedByCaller) await stopManagedCloneServer(cloneConfig);
  }
}

async function main(): Promise<void> {
  try {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    const result = await compareDatabases(process.env.DATABASE_URL);
    console.log(formatSnapshotDiff(result.diff));
    const clean = result.valid && Object.values(result.diff).every(v => v.length === 0);
    console.log(clean ? "DB DIVERGENCE PASS" : "DB DIVERGENCE FAIL");
    if (!clean) process.exitCode = 1;
  } catch (error) {
    console.error("DB DIVERGENCE FAIL");
    console.error(error instanceof Error ? error.message : "DB divergence could not be completed safely");
    process.exitCode = 1;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) await main();