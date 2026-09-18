import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { processRunner, type ProcessRunner } from "./process";
import { assertLocalPostgresUrl, localPostgresUrl } from "./localPostgres";

export const CLONE_DATABASE = "production_clone";
export const CLONE_ROOT = path.resolve(import.meta.dirname, "../..", ".local/db-clone-prod");
const PORT = 55432;
const FALLBACK_SCHEMA = path.resolve(import.meta.dirname, "../..", "lib/db/schema-ci-baseline/000_pre_runner_schema.sql");
const WORKSPACE_ROOT = path.resolve(import.meta.dirname, "../..");

export type SourceKind = "backup" | "schema-only";
export type CloneSource = { path: string; kind: SourceKind };
export type CloneMetadata = {
  host: "127.0.0.1"; port: number; username: string; database: string;
  sourceKind: SourceKind; sourceFingerprint: string; restoredAt: string;
};
export type CloneConfig = {
  workspaceRoot: string; localRoot: string; cloneRoot: string; dataDir: string;
  socketDir: string; logFile: string; metadataFile: string; markerFile: string;
  port: number; database: string; username: string;
  postgresBinary: string; pgCtlBinary: string; psqlBinary: string;
  pgRestoreBinary: string; dropdbBinary: string; createdbBinary: string; initdbBinary: string;
  process: ProcessRunner;
};
export type ManagedClusterConfig = CloneConfig;
export type ManagedCloneInspection = { state: "running" | "stopped"; metadata: CloneMetadata; postgresMajor: string };

export function defaultCloneConfig(workspaceRoot = WORKSPACE_ROOT): CloneConfig {
  const localRoot = path.join(workspaceRoot, ".local");
  const cloneRoot = path.join(localRoot, "db-clone-prod");
  return {
    workspaceRoot, localRoot, cloneRoot, dataDir: path.join(cloneRoot, "data"),
    socketDir: path.join(cloneRoot, "socket"), logFile: path.join(cloneRoot, "postgres.log"),
    metadataFile: path.join(localRoot, "db-clone-prod.json"), markerFile: path.join(cloneRoot, "cluster-marker.json"),
    port: PORT, database: CLONE_DATABASE, username: "postgres",
    postgresBinary: "postgres", pgCtlBinary: "pg_ctl", psqlBinary: "psql",
    pgRestoreBinary: "pg_restore", dropdbBinary: "dropdb", createdbBinary: "createdb",
    initdbBinary: "initdb", process: processRunner,
  };
}

export function serializeCloneMetadata(metadata: CloneMetadata): string { return `${JSON.stringify(metadata, null, 2)}\n`; }

type Marker = {
  format: 3; workspaceIdentity: string; cloneIdentity: string; database: string; username: string;
  port: number; postgresMajor: string;
};
const exists = async (p: string) => lstat(p).then(() => true).catch((e: any) => e?.code === "ENOENT" ? false : Promise.reject(e));
const sha = (v: string) => createHash("sha256").update(v).digest("hex");

/** Validate every existing path component, including the path's parent. */
export async function validateManagedPaths(config: CloneConfig): Promise<void> {
  const root = path.resolve(config.workspaceRoot);
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error("Refusing symlink in managed clone paths");
  const rootReal = await realpath(root);
  const paths = [config.localRoot, config.cloneRoot, config.dataDir, config.socketDir, config.logFile,
    config.metadataFile, config.markerFile];
  for (const candidate of paths) {
    const absolute = path.resolve(candidate);
    const rel = path.relative(root, absolute);
    if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("Refusing managed clone path outside containment");
    let current = root;
    for (const part of rel.split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      try {
        const info = await lstat(current);
        if (info.isSymbolicLink()) throw new Error("Refusing symlink in managed clone paths");
        const real = await realpath(current);
        const fromRoot = path.relative(rootReal, real);
        if (fromRoot.startsWith("..") || path.isAbsolute(fromRoot)) throw new Error("Refusing managed clone path outside workspace");
      } catch (e: any) {
        if (e?.code !== "ENOENT") throw e;
        break;
      }
    }
  }
}

export async function assertRealPathContainment(root: string, candidates: string[]): Promise<void> {
  const cfg = defaultCloneConfig(root);
  cfg.localRoot = root;
  cfg.cloneRoot = root;
  cfg.dataDir = candidates[0] ?? root;
  await validateManagedPaths(cfg);
}
export async function assertManagedFilesystem(config = defaultCloneConfig()): Promise<void> {
  await validateManagedPaths(config);
  await mkdir(config.localRoot, { recursive: true });
  await mkdir(config.cloneRoot, { recursive: true });
  await validateManagedPaths(config);
}

async function major(config: CloneConfig): Promise<string> {
  const r = await config.process.capture(config.postgresBinary, ["--version"]);
  const m = `${r.stdout}\n${r.stderr}`.match(/PostgreSQL\)?\s+(\d+)/);
  if (r.code !== 0 || !m) throw new Error("Unable to determine PostgreSQL major version");
  return m[1];
}
async function command(config: CloneConfig, binary: string, args: string[], operation: string): Promise<void> {
  let result;
  try { result = await config.process.capture(binary, args); }
  catch { throw new Error(`${operation} failed`); }
  if (result.code !== 0) throw new Error(`${operation} failed`);
}
async function readMarker(config: CloneConfig): Promise<Marker> {
  try { return JSON.parse(await readFile(config.markerFile, "utf8")) as Marker; }
  catch { throw new Error("Refusing to use an unowned managed PostgreSQL data directory"); }
}
async function ownership(config: CloneConfig, marker: Marker): Promise<boolean> {
  const workspaceIdentity = sha(await realpath(config.workspaceRoot));
  const cloneIdentity = sha(await realpath(config.cloneRoot));
  return marker.format === 3 && marker.workspaceIdentity === workspaceIdentity && marker.cloneIdentity === cloneIdentity &&
    marker.database === config.database && marker.username === config.username && marker.port === config.port;
}
async function status(config: CloneConfig): Promise<boolean> {
  let result;
  try { result = await config.process.capture(config.pgCtlBinary, ["-D", config.dataDir, "status"]); }
  catch { throw new Error("PostgreSQL status is indeterminate"); }
  if (result.code === 0) return true;
  if (result.code === 3) return false;
  throw new Error("PostgreSQL status is indeterminate");
}

export async function initializeCluster(config = defaultCloneConfig()): Promise<void> {
  await assertManagedFilesystem(config);
  const dataExists = await exists(config.dataDir);
  const m = dataExists ? await readMarker(config) : null;
  if (m && !(await ownership(config, m))) throw new Error("Managed clone ownership marker mismatch; refusing to delete data");
  const currentMajor = await major(config);
  if (dataExists && m && (m.postgresMajor !== currentMajor ||
      (await readFile(path.join(config.dataDir, "PG_VERSION"), "utf8").catch(() => "" )).trim() !== currentMajor)) {
    if (await status(config)) {
      await command(config, config.pgCtlBinary, ["-D", config.dataDir, "stop", "-m", "fast", "-w"], "PostgreSQL stop");
      if (await status(config)) throw new Error("Managed clone server did not stop");
    }
    await validateManagedPaths(config);
    await rm(config.dataDir, { recursive: true, force: true });
    await rm(config.socketDir, { recursive: true, force: true });
    await rm(config.logFile, { force: true });
    await mkdir(config.dataDir, { recursive: true });
  } else if (dataExists) {
    await mkdir(config.socketDir, { recursive: true });
    return;
  } else {
    await mkdir(config.dataDir, { recursive: true });
  }
  await command(config, config.initdbBinary, ["--pgdata", config.dataDir, `--username=${config.username}`, "--auth-local=trust", "--auth-host=trust", "--no-locale", "--encoding=UTF8"], "PostgreSQL initialization");
  await writeFile(path.join(config.dataDir, "postgresql.conf"), `listen_addresses = '127.0.0.1'\nunix_socket_directories = '${config.socketDir}'\nssl = off\n`);
  await writeFile(config.markerFile, `${JSON.stringify({ format: 3, workspaceIdentity: sha(await realpath(config.workspaceRoot)), cloneIdentity: sha(await realpath(config.cloneRoot)), database: config.database, username: config.username, port: config.port, postgresMajor: currentMajor })}\n`);
  await mkdir(config.socketDir, { recursive: true });
}

async function query(config: CloneConfig, database: string, sql: string): Promise<string> {
  const url = localPostgresUrl(config.port, database); assertLocalPostgresUrl(url);
  const r = await config.process.capture(config.psqlBinary, ["--dbname", url, "--tuples-only", "--no-align", "--field-separator=|", "--command", sql]);
  if (r.code !== 0) throw new Error("Local PostgreSQL query failed");
  return r.stdout.trim();
}
async function verifyIdentity(config: CloneConfig): Promise<void> {
  const values = await query(config, "postgres", "SELECT current_setting('data_directory'), current_setting('port'), current_setting('listen_addresses'), current_setting('ssl'), current_user;");
  const [dir, port, listen, ssl, user] = values.split("|").map(v => v.trim());
  if (path.resolve(dir) !== path.resolve(config.dataDir) || port !== String(config.port) || listen !== "127.0.0.1" || ssl !== "off" || user !== config.username)
    throw new Error("Managed clone server identity verification failed");
}

/**
 * Inspect an already-provisioned clone without changing anything on disk.
 * This is deliberately separate from initializeCluster: rehearsal and other
 * read-only consumers must never create, remove, or repair a cluster.
 */
export async function inspectManagedCloneServer(config = defaultCloneConfig()): Promise<ManagedCloneInspection> {
  await validateManagedPaths(config);
  for (const managed of [config.localRoot, config.cloneRoot, config.dataDir, config.socketDir,
    config.metadataFile, config.markerFile]) {
    if (!(await exists(managed))) throw new Error("Managed clone is missing or stale");
  }
  const marker = await readMarker(config);
  if (!(await ownership(config, marker))) throw new Error("Managed clone ownership marker mismatch");
  const currentMajor = await major(config);
  const pgVersion = (await readFile(path.join(config.dataDir, "PG_VERSION"), "utf8")
    .catch(() => "")).trim();
  if (marker.postgresMajor !== currentMajor || pgVersion !== currentMajor) {
    throw new Error("Managed clone PostgreSQL major version mismatch");
  }
  let metadata: CloneMetadata;
  try { metadata = JSON.parse(await readFile(config.metadataFile, "utf8")) as CloneMetadata; }
  catch { throw new Error("Managed clone metadata is missing or invalid"); }
  if (metadata.database !== config.database || metadata.host !== "127.0.0.1" ||
      metadata.port !== config.port || metadata.username !== config.username) {
    throw new Error("Managed clone metadata mismatch");
  }
  const running = await status(config);
  if (running) await verifyIdentity(config);
  return { state: running ? "running" : "stopped", metadata, postgresMajor: currentMajor };
}

export async function startExistingManagedCloneServer(config = defaultCloneConfig()): Promise<{ startedByCaller: boolean }> {
  const inspection = await inspectManagedCloneServer(config);
  if (inspection.state === "running") {
    await verifyIdentity(config);
    return { startedByCaller: false };
  }
  try {
    await command(config, config.pgCtlBinary, ["-D", config.dataDir, "-l", config.logFile,
      "-o", `-p ${config.port} -k ${config.socketDir} -h 127.0.0.1 -c listen_addresses=127.0.0.1 -c ssl=off`,
      "start", "-w"], "PostgreSQL start");
    await verifyIdentity(config);
  } catch (startError) {
    try {
      await stopManagedCloneServer(config);
    } catch (cleanupError) {
      throw new AggregateError(
        [startError, cleanupError],
        "Managed clone start failed and cleanup failed",
      );
    }
    throw startError;
  }
  return { startedByCaller: true };
}

export async function startManagedCloneServer(config = defaultCloneConfig()): Promise<void> {
  await initializeCluster(config);
  if (!(await status(config))) await command(config, config.pgCtlBinary, ["-D", config.dataDir, "-l", config.logFile, "-o", `-p ${config.port} -k ${config.socketDir} -h 127.0.0.1 -c listen_addresses=127.0.0.1 -c ssl=off`, "start", "-w"], "PostgreSQL start");
  await verifyIdentity(config);
}
export async function stopManagedCloneServer(config = defaultCloneConfig()): Promise<void> {
  await validateManagedPaths(config);
  if (!(await exists(config.dataDir))) return;
  const marker = await readMarker(config);
  if (!(await ownership(config, marker))) throw new Error("Refusing to stop an unowned managed PostgreSQL data directory");
  if (!(await status(config))) return;
  await command(config, config.pgCtlBinary, ["-D", config.dataDir, "stop", "-m", "fast", "-w"], "PostgreSQL stop");
  if (await status(config)) throw new Error("Managed clone server did not stop");
}
export async function readCloneMetadata(config = defaultCloneConfig()): Promise<CloneMetadata> { return JSON.parse(await readFile(config.metadataFile, "utf8")) as CloneMetadata; }

async function validateSource(source: string, config?: CloneConfig): Promise<void> {
  const info = await lstat(source).catch(() => { throw new Error("Clone source unavailable (ENOENT)"); });
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Clone source must be a regular non-symlink file");
  const raw = await readFile(source).catch(() => { throw new Error("Clone source cannot be read"); }); const header = raw.subarray(0, 512).toString("utf8");
  if (raw[0] === 0x1f && raw[1] === 0x8b) throw new Error("Compressed/gzip clone sources are not supported");
  if (/^\s*[\ufeff]?[\[{]/.test(header)) throw new Error("Application JSON clone source rejected");
  if (/\.sql$/i.test(source) && !header.trim()) throw new Error("Empty SQL clone source rejected");
  if (!/\.sql$/i.test(source)) {
    const r = await (config?.process ?? processRunner).capture("pg_restore", ["--list", source]);
    if (r.code !== 0) throw new Error("Invalid PostgreSQL custom dump");
  }
}
export async function selectCloneSource(root: string, explicit = process.env.DB_CLONE_BACKUP, config?: CloneConfig): Promise<CloneSource> {
  if (explicit) {
    const source = path.resolve(root, explicit);
    if (/\.json(?:\.gz)?$/i.test(source)) throw new Error("DB_CLONE_BACKUP must be a PostgreSQL dump, not an application JSON backup");
    if (!/\.(?:sql|dump|backup)$/i.test(source)) throw new Error("DB_CLONE_BACKUP must end in .sql, .dump, or .backup");
    await validateSource(source, config); return { path: source, kind: "backup" };
  }
  const directory = path.join(root, "backups/production");
  if (await exists(directory)) {
    const info = await lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("Backup directory is unsafe");
    const rr = await realpath(directory); const wr = await realpath(root);
    if (path.relative(wr, rr).startsWith("..")) throw new Error("Backup directory is outside workspace");
  }
  const names = await readdir(directory).catch((e: any) => e?.code === "ENOENT" ? [] : Promise.reject(e));
  const entries = await Promise.all(names.filter(n => /\.(?:sql|dump|backup)$/i.test(n)).map(async n => ({ file: path.join(directory, n), modifiedAt: (await stat(path.join(directory, n))).mtimeMs })));
  entries.sort((a, b) => b.modifiedAt - a.modifiedAt || a.file.localeCompare(b.file));
  for (const e of entries) try {
    const info = await lstat(e.file); if (!info.isFile() || info.isSymbolicLink()) throw new Error("unsafe");
    const rr = await realpath(e.file); const dr = await realpath(directory);
    if (path.relative(dr, rr).startsWith("..")) throw new Error("unsafe");
    await validateSource(e.file, config); return { path: e.file, kind: "backup" };
  } catch { /* next candidate */ }
  await validateSource(FALLBACK_SCHEMA, config); return { path: FALLBACK_SCHEMA, kind: "schema-only" };
}

export function formatCloneCounts(c: { tables: number; columns: number; ledgerRows: number }): string {
  return `Public base tables: ${c.tables}\nPublic columns: ${c.columns}\nSchema migrations ledger rows: ${c.ledgerRows}`;
}

export async function cloneProduction(config = defaultCloneConfig()): Promise<void> {
  let primaryError: unknown;
  try {
    // Reject an unsafe backup parent before starting the managed server.  Apart
    // from being cheaper, this ensures a symlinked backup cannot trigger any
    // process invocation while it is being inspected.
    const backupDirectory = path.join(config.workspaceRoot, "backups/production");
    const backupParent = path.join(config.workspaceRoot, "backups");
    if (await exists(backupParent)) {
      const parentInfo = await lstat(backupParent);
      if (parentInfo.isSymbolicLink() || !parentInfo.isDirectory()) throw new Error("Backup directory is unsafe");
    }
    if (await exists(backupDirectory)) {
      const backupInfo = await lstat(backupDirectory);
      if (backupInfo.isSymbolicLink() || !backupInfo.isDirectory()) throw new Error("Backup directory is unsafe");
      const backupReal = await realpath(backupDirectory);
      const workspaceReal = await realpath(config.workspaceRoot);
      if (path.relative(workspaceReal, backupReal).startsWith("..")) throw new Error("Backup directory is outside workspace");
    }
    await startManagedCloneServer(config);
    await verifyIdentity(config);
    const sourceExplicit = process.env.DB_CLONE_BACKUP;
    const candidates: CloneSource[] = [];
    if (sourceExplicit) candidates.push(await selectCloneSource(config.workspaceRoot, sourceExplicit, config));
    else {
      const dir = path.join(config.workspaceRoot, "backups/production");
      if (await exists(dir)) {
        const info = await lstat(dir); if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("Backup directory is unsafe");
        const rr = await realpath(dir); const wr = await realpath(config.workspaceRoot);
        if (path.relative(wr, rr).startsWith("..")) throw new Error("Backup directory is outside workspace");
      }
      const names = await readdir(dir).catch((e: any) => e?.code === "ENOENT" ? [] : Promise.reject(e));
      const entries = await Promise.all(names.filter(n => /\.(?:sql|dump|backup)$/i.test(n)).map(async n => ({ path: path.join(dir, n), m: (await stat(path.join(dir, n))).mtimeMs })));
      entries.sort((a, b) => b.m - a.m || a.path.localeCompare(b.path));
      for (const e of entries) try {
        const info = await lstat(e.path); if (!info.isFile() || info.isSymbolicLink()) throw new Error("unsafe");
        const rr = await realpath(e.path); const dr = await realpath(dir);
        if (path.relative(dr, rr).startsWith("..")) throw new Error("unsafe");
        await validateSource(e.path, config); candidates.push({ path: e.path, kind: "backup" });
      } catch { /* skip invalid */ }
      candidates.push({ path: FALLBACK_SCHEMA, kind: "schema-only" });
    }
    const maintenance = localPostgresUrl(config.port, "postgres"); let selected: CloneSource | undefined; let staging = "";
    for (const source of candidates) {
      staging = `${config.database}_staging_${process.pid}_${Date.now()}`;
      try {
        await verifyIdentity(config);
        await command(config, config.createdbBinary, ["--maintenance-db", maintenance, staging], "Staging database creation");
        const args = source.path.endsWith(".sql") ? [ "--dbname", localPostgresUrl(config.port, staging), "--set=ON_ERROR_STOP=on", "--file", source.path ] : ["--exit-on-error", "--no-owner", "--no-privileges", "--dbname", localPostgresUrl(config.port, staging), source.path];
        const r = await config.process.capture(source.path.endsWith(".sql") ? config.psqlBinary : config.pgRestoreBinary, args);
        if (r.code !== 0) throw new Error("Restore failed");
        await query(config, staging, "SELECT 1;");
        selected = source; break;
      } catch (e) {
        let identityValid = true;
        try { await verifyIdentity(config); } catch { identityValid = false; }
        if (identityValid) await command(config, config.dropdbBinary, ["--if-exists", "--maintenance-db", maintenance, staging], "Staging database cleanup").catch(() => {});
        else throw new Error("Managed clone server identity verification failed");
        if (sourceExplicit) throw new Error("Explicit clone source restore failed");
      }
    }
    if (!selected) throw new Error("No usable clone source");
    await verifyIdentity(config);
    const backupName = `${config.database}_previous_${process.pid}_${Date.now()}`;
    const oldExists = await query(config, "postgres", `SELECT 1 FROM pg_database WHERE datname='${config.database}'`);
    if (oldExists) await command(config, config.psqlBinary, ["--dbname", maintenance, "--command", `ALTER DATABASE ${config.database} RENAME TO ${backupName}`], "Existing clone staging");
    try {
      await verifyIdentity(config);
      await command(config, config.psqlBinary, ["--dbname", maintenance, "--command", `ALTER DATABASE ${staging} RENAME TO ${config.database}`], "Clone cutover");
    } catch (error) {
      if (oldExists) await command(config, config.psqlBinary, ["--dbname", maintenance, "--command", `ALTER DATABASE ${backupName} RENAME TO ${config.database}`], "Clone cutover rollback").catch(() => {});
      throw error;
    }
    await verifyIdentity(config);
    if (oldExists) await command(config, config.dropdbBinary, ["--if-exists", "--maintenance-db", maintenance, backupName], "Old clone cleanup");
    const tables = Number(await query(config, config.database, "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p');"));
    const columns = Number(await query(config, config.database, "SELECT count(*) FROM information_schema.columns WHERE table_schema='public';"));
    const ledger = await query(config, config.database, "SELECT to_regclass('public.schema_migrations');");
    const ledgerRows = ledger ? Number(await query(config, config.database, "SELECT count(*) FROM schema_migrations;")) : 0;
    const fingerprint = createHash("sha256").update(await readFile(selected.path)).digest("hex");
    await validateManagedPaths(config);
    await writeFile(config.metadataFile, serializeCloneMetadata({ host: "127.0.0.1", port: config.port, username: config.username, database: config.database, sourceKind: selected.kind, sourceFingerprint: fingerprint, restoredAt: new Date().toISOString() }));
    console.log(`DB clone source: ${selected.kind}`); console.log(formatCloneCounts({ tables, columns, ledgerRows })); console.log("DB CLONE PASS");
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await validateManagedPaths(config);
      await stopManagedCloneServer(config);
    } catch (cleanupError) {
      if (primaryError) throw new AggregateError([primaryError, cleanupError], "DB clone failed and cleanup failed");
      throw cleanupError;
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename))
  cloneProduction().catch(e => { console.error(e instanceof Error ? e.message : "DB clone failed"); process.exitCode = 1; });