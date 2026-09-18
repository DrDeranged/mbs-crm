import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile, utimes, readFile, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { assertLocalPostgresUrl, localPostgresUrl } from "./localPostgres";
import { assertRealPathContainment, cloneProduction, defaultCloneConfig, formatCloneCounts, readCloneMetadata, selectCloneSource, serializeCloneMetadata, startExistingManagedCloneServer, stopManagedCloneServer, initializeCluster } from "./dbCloneProd";
import { processRunner, type ProcessRunner } from "./process";

type Call = { command: string; args: string[] };
function fakeRunner(handler: (command: string, args: string[]) => { code: number; stdout?: string; stderr?: string } = () => ({ code: 0 })): ProcessRunner & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    run: async (command, args) => { calls.push({ command, args }); const result = handler(command, args); if (result.code) throw new Error(`${command} failed`); },
    capture: async (command, args) => { calls.push({ command, args }); const result = handler(command, args); return { code: result.code, stdout: result.stdout ?? "", stderr: result.stderr ?? "" }; },
  };
}

async function ownedStaleConfig(statusCode: number) {
  const root = await mkdtemp(path.join(os.tmpdir(), "clone-owned-"));
  const config = defaultCloneConfig(root);
  const runner = fakeRunner((command, args) => {
    if (command === config.postgresBinary) return { code: 0, stdout: "postgres (PostgreSQL) 16.10" };
    if (command === config.pgCtlBinary && args.at(-1) === "status") return { code: statusCode };
    return { code: 0 };
  });
  config.process = runner;
  await initializeCluster(config);
  await writeFile(path.join(config.dataDir, "PG_VERSION"), "15\n");
  await writeFile(path.join(config.dataDir, "sentinel"), "keep");
  runner.calls.length = 0;
  return { root, config, runner };
}

test("local URL validation permits loopback and rejects remote credentials without echoing them", () => {
  const generated = localPostgresUrl(55432);
  assert.equal(new URL(generated).username, "postgres");
  assert.equal(new URL(generated).password, "");
  assert.equal(generated.includes("?"), false);
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    assert.doesNotThrow(() => assertLocalPostgresUrl(`postgresql://${host}:55432/production_clone`));
  }
  const secretUrl = "postgresql://user:super-secret@example.com/prod";
  assert.throws(() => assertLocalPostgresUrl(secretUrl), (error: Error) => {
    assert.equal(error.message, "Refusing non-local PostgreSQL URL");
    assert.equal(error.message.includes("super-secret"), false);
    return true;
  });
});

test("backup selection is newest, with deterministic tie ordering and schema fallback", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clone-source-"));
  const directory = path.join(root, "backups/production");
  await mkdir(directory, { recursive: true });
  const older = path.join(directory, "older.sql");
  const newer = path.join(directory, "newer.sql");
  await writeFile(older, "CREATE TABLE older(id integer);\n");
  await writeFile(newer, "CREATE TABLE newer(id integer);\n");
  await utimes(older, new Date(1000), new Date(1000));
  await utimes(newer, new Date(2000), new Date(2000));
  assert.equal((await selectCloneSource(root)).path, newer);
  const explicit = path.join(root, "explicit.sql");
  await writeFile(explicit, "CREATE TABLE explicit(id integer);\n");
  assert.equal((await selectCloneSource(root, explicit)).path, explicit);
});

test("application JSON backups are rejected clearly", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clone-json-"));
  const json = path.join(root, "backup.json.gz");
  await writeFile(json, "");
  await assert.rejects(() => selectCloneSource(root, json), /application JSON/);
});

test("count formatting is stable and metadata-safe", () => {
  const output = formatCloneCounts({ tables: 3, columns: 12, ledgerRows: 0 });
  assert.equal(output, "Public base tables: 3\nPublic columns: 12\nSchema migrations ledger rows: 0");
  assert.equal(output.includes("postgres"), false);
});

test("default configuration is injectable and rooted in workspace .local", () => {
  const config = defaultCloneConfig("/tmp/test-workspace");
  assert.equal(config.cloneRoot, "/tmp/test-workspace/.local/db-clone-prod");
  assert.equal(config.port, 55432);
  assert.equal(config.username, "postgres");
});

test("metadata serialization contains only safe connection and fingerprint fields", () => {
  const value = serializeCloneMetadata({
    host: "127.0.0.1", port: 55432, username: "postgres", database: "production_clone",
    sourceKind: "schema-only", sourceFingerprint: "a".repeat(64), restoredAt: "2020-01-01T00:00:00.000Z",
  });
  assert.equal(value.includes("password"), false);
  assert.equal(value.includes("postgresql://"), false);
  assert.equal(value.includes("sourceRelativePath"), false);
});

test("metadata fingerprint is not a source path or basename", () => {
  const value = serializeCloneMetadata({
    host: "127.0.0.1", port: 1, username: "postgres", database: "production_clone",
    sourceKind: "backup", sourceFingerprint: "deadbeef", restoredAt: "now",
  });
  assert.equal(value.includes("backup.sql"), false);
  assert.equal(value.includes("/tmp"), false);
});

test("JSON rejection is independent of extension and BOM", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clone-json-content-"));
  const source = path.join(root, "backup.sql");
  await writeFile(source, "\ufeff  [ { \"rows\": 1 } ]");
  await assert.rejects(() => selectCloneSource(root, source), /JSON/);
});

test("gzip rejection is independent of extension", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clone-gzip-content-"));
  const source = path.join(root, "backup.sql");
  await writeFile(source, Buffer.from([0x1f, 0x8b, 0x08, 0x00]));
  await assert.rejects(() => selectCloneSource(root, source), /gzip/);
});

test("fallback selection works when production backup directory is absent", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clone-fallback-"));
  const selected = await selectCloneSource(root);
  assert.equal(selected.kind, "schema-only");
  assert.equal(path.basename(selected.path), "000_pre_runner_schema.sql");
});

test("explicit invalid source does not silently fall back", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clone-explicit-"));
  await assert.rejects(() => selectCloneSource(root, path.join(root, "missing.sql")), /ENOENT/);
});

test("custom configuration keeps all managed paths beneath its clone root", () => {
  const config = defaultCloneConfig("/workspace");
  for (const value of [config.dataDir, config.socketDir, config.logFile, config.markerFile]) {
    assert.equal(path.relative(config.cloneRoot, value).startsWith(".."), false);
  }
});

test("generated local connection has no password", () => {
  const generated = localPostgresUrl(54321, "production_clone");
  assert.equal(new URL(generated).password, "");
  assert.equal(new URL(generated).username, "postgres");
});

test("realpath containment rejects managed symlink paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clone-links-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "clone-outside-"));
  const link = path.join(root, "data");
  await symlink(outside, link);
  await assert.rejects(() => assertRealPathContainment(root, [link]), /symlink/);
  await assert.rejects(() => assertRealPathContainment(root, [path.join(root, "..")]), /containment/);
});

test("lifecycle stop refuses a symlink before invoking pg_ctl", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clone-life-link-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "clone-life-out-"));
  const config = defaultCloneConfig(root);
  await mkdir(config.localRoot, { recursive: true });
  await symlink(outside, config.cloneRoot);
  let calls = 0;
  config.process = { run: async () => { calls++; }, capture: async () => { calls++; return { code: 0, stdout: "", stderr: "" }; } };
  await assert.rejects(() => stopManagedCloneServer(config), /symlink/);
  assert.equal(calls, 0);
});

test("lifecycle initialization rejects an ownership marker before destructive calls", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clone-life-owner-"));
  const config = defaultCloneConfig(root);
  await mkdir(config.dataDir, { recursive: true });
  await writeFile(config.markerFile, JSON.stringify({ format: 3, workspaceIdentity: "wrong", cloneIdentity: "wrong", database: config.database, username: config.username, port: config.port, postgresMajor: "16" }));
  let destructive = 0;
  config.process = { run: async () => { destructive++; }, capture: async () => ({ code: 0, stdout: "PostgreSQL 16", stderr: "" }) };
  await assert.rejects(() => initializeCluster(config), /ownership/);
  assert.equal(destructive, 0);
});

test("owned stale-major plus indeterminate pg_ctl status aborts and preserves data", async () => {
  const { config, runner } = await ownedStaleConfig(2);
  await assert.rejects(() => initializeCluster(config), /indeterminate/);
  assert.equal(await readFile(path.join(config.dataDir, "sentinel"), "utf8"), "keep");
  assert.equal(runner.calls.some(c => c.command === config.initdbBinary || c.command === config.pgCtlBinary && c.args.includes("stop")), false);
});

test("owned stale-major plus definite stopped status safely reinitializes after ownership match", async () => {
  const { config, runner } = await ownedStaleConfig(3);
  await initializeCluster(config);
  assert.equal(runner.calls.some(c => c.command === config.initdbBinary), true);
  await assert.rejects(() => readFile(path.join(config.dataDir, "sentinel"), "utf8"), /ENOENT/);
});

test("stop command failure preserves data and returns a redacted fixed error", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clone-stop-failure-"));
  const config = defaultCloneConfig(root);
  let statusCalls = 0;
  const runner = fakeRunner((command, args) => {
    if (command === config.postgresBinary) return { code: 0, stdout: "PostgreSQL 16" };
    if (command === config.pgCtlBinary && args.at(-1) === "status") return { code: statusCalls++ ? 0 : 0 };
    if (command === config.pgCtlBinary && args.includes("stop")) return { code: 1, stderr: "fake-secret /private/source" };
    return { code: 0 };
  });
  config.process = runner;
  await initializeCluster(config);
  await writeFile(path.join(config.dataDir, "sentinel"), "keep");
  await assert.rejects(() => stopManagedCloneServer(config), (e: Error) => {
    assert.equal(e.message, "PostgreSQL stop failed");
    assert.equal(e.message.includes("fake-secret"), false);
    assert.equal(e.message.includes("/private/source"), false);
    return true;
  });
  assert.equal(await readFile(path.join(config.dataDir, "sentinel"), "utf8"), "keep");
});

test("start identity mismatch performs no database cutover and finalizer attempts stop", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clone-identity-"));
  await mkdir(path.join(root, "backups/production"), { recursive: true });
  const source = path.join(root, "backups/production/one.sql");
  await writeFile(source, "CREATE TABLE one(id int);\n");
  const config = defaultCloneConfig(root);
  let status = 3;
  const runner = fakeRunner((command, args) => {
    if (command === config.postgresBinary) return { code: 0, stdout: "PostgreSQL 16" };
    if (command === config.pgCtlBinary && args.at(-1) === "status") return { code: status };
    if (command === config.pgCtlBinary && args.includes("start")) { status = 0; return { code: 0 }; }
    if (command === config.psqlBinary) return { code: 0, stdout: "/wrong|9999|0.0.0.0|on|other" };
    return { code: 0 };
  });
  config.process = runner;
  await assert.rejects(() => cloneProduction(config));
  assert.equal(runner.calls.some(c => c.command === config.dropdbBinary || c.args.some(a => a.includes("RENAME TO"))), false);
  assert.equal(runner.calls.some(c => c.command === config.pgCtlBinary && c.args.includes("stop")), true);
});

test("automatic candidate flow retries older valid SQL only after newest staging restore fails", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clone-candidates-"));
  const dir = path.join(root, "backups/production"); await mkdir(dir, { recursive: true });
  const newest = path.join(dir, "newest.sql"), older = path.join(dir, "older.sql");
  await writeFile(newest, "CREATE TABLE newest(id int);\n"); await writeFile(older, "CREATE TABLE older(id int);\n");
  await utimes(newest, new Date(2000), new Date(2000)); await utimes(older, new Date(1000), new Date(1000));
  const config = defaultCloneConfig(root); let status = 3; let restoreCount = 0;
  const runner = fakeRunner((command, args) => {
    if (command === config.postgresBinary) return { code: 0, stdout: "PostgreSQL 16" };
    if (command === config.pgCtlBinary && args.at(-1) === "status") return { code: status };
    if (command === config.pgCtlBinary && args.includes("start")) { status = 0; return { code: 0 }; }
    if (command === config.pgCtlBinary && args.includes("stop")) { status = 3; return { code: 0 }; }
    if (command === config.psqlBinary && args.includes("--command")) {
      const sql = args[args.indexOf("--command") + 1] ?? "";
      if (sql.includes("current_setting")) return { code: 0, stdout: `${config.dataDir}|${config.port}|127.0.0.1|off|${config.username}` };
      if (sql.includes("pg_database")) return { code: 0, stdout: "" };
      if (sql.includes("SELECT 1")) return { code: 0, stdout: "1" };
      return { code: 0, stdout: "0" };
    }
    if (command === config.psqlBinary && args.includes("--file")) return { code: restoreCount++ ? 0 : 1, stderr: "restore failed" };
    return { code: 0 };
  });
  config.process = runner;
  await cloneProduction(config);
  const restores = runner.calls.filter(c => c.command === config.psqlBinary && c.args.includes("--file"));
  assert.equal(restores.length, 2); assert.equal(restores[0].args.at(-1), newest); assert.equal(restores[1].args.at(-1), older);
  assert.equal(runner.calls.findIndex(c => c.command === config.createdbBinary) < runner.calls.findIndex(c => c.command === config.psqlBinary && c.args.includes("--file")), true);
  const cutoverIndex = runner.calls.findIndex(c => c.args.some(a => a.includes("RENAME TO")));
  assert.equal(cutoverIndex > runner.calls.indexOf(restores[1]), true);
});

test("explicit invalid or restore-failed source never falls back or drops production clone", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clone-explicit-fail-"));
  const source = path.join(root, "bad.sql"); await writeFile(source, "CREATE TABLE bad(id int);\n");
  const config = defaultCloneConfig(root); let status = 3;
  const runner = fakeRunner((command, args) => {
    if (command === config.postgresBinary) return { code: 0, stdout: "PostgreSQL 16" };
    if (command === config.pgCtlBinary && args.at(-1) === "status") return { code: status };
    if (command === config.pgCtlBinary && args.includes("start")) { status = 0; return { code: 0 }; }
    if (command === config.createdbBinary) return { code: 0 };
    if (command === config.psqlBinary && args.includes("--file")) return { code: 1, stderr: "failure" };
    if (command === config.psqlBinary) return { code: 0, stdout: `${config.dataDir}|${config.port}|127.0.0.1|off|${config.username}` };
    return { code: 0 };
  });
  config.process = runner; const old = process.env.DB_CLONE_BACKUP; process.env.DB_CLONE_BACKUP = source;
  try { await assert.rejects(() => cloneProduction(config)); } finally { if (old === undefined) delete process.env.DB_CLONE_BACKUP; else process.env.DB_CLONE_BACKUP = old; }
  assert.equal(runner.calls.some(c => c.args.some(a => a.includes("RENAME TO"))), false);
});

test("reversible cutover rolls back when second rename fails and never drops backup", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clone-rollback-")); const config = defaultCloneConfig(root);
  const source = path.join(root, "source.sql"); await writeFile(source, "CREATE TABLE x(id int);\n");
  let status = 3, renames = 0;
  const runner = fakeRunner((command, args) => {
    if (command === config.postgresBinary) return { code: 0, stdout: "PostgreSQL 16" };
    if (command === config.pgCtlBinary && args.at(-1) === "status") return { code: status };
    if (command === config.pgCtlBinary && args.includes("start")) { status = 0; return { code: 0 }; }
    if (command === config.psqlBinary && args.includes("--command")) {
      const sql = args[args.indexOf("--command") + 1] ?? "";
      if (sql.includes("current_setting")) return { code: 0, stdout: `${config.dataDir}|${config.port}|127.0.0.1|off|${config.username}` };
      if (sql.includes("pg_database")) return { code: 0, stdout: "1" };
      if (sql.includes("RENAME TO")) return ++renames === 2 ? { code: 1 } : { code: 0 };
      return { code: 0, stdout: "1" };
    }
    return { code: 0 };
  });
  config.process = runner; const old = process.env.DB_CLONE_BACKUP; process.env.DB_CLONE_BACKUP = source;
  try { await assert.rejects(() => cloneProduction(config)); } finally { if (old === undefined) delete process.env.DB_CLONE_BACKUP; else process.env.DB_CLONE_BACKUP = old; }
  const rename = runner.calls.filter(c => c.args.some(a => a.includes("RENAME TO")));
  assert.equal(rename.length, 3); assert.equal(rename[2].args.some(a => a.includes("TO " + config.database)), true);
  assert.equal(runner.calls.some(c => c.command === config.dropdbBinary), false);
});

test("restore and capture stderr never expose fake secret or source path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clone-redact-")); const source = path.join(root, "fake-secret-source.sql");
  await writeFile(source, "CREATE TABLE x(id int);\n"); const config = defaultCloneConfig(root); let status = 3;
  const runner = fakeRunner((command, args) => {
    if (command === config.postgresBinary) return { code: 0, stdout: "PostgreSQL 16" };
    if (command === config.pgCtlBinary && args.at(-1) === "status") return { code: status };
    if (command === config.pgCtlBinary && args.includes("start")) { status = 0; return { code: 0 }; }
    if (command === config.psqlBinary && args.includes("--file")) return { code: 1, stderr: "fake-secret /hidden/source.sql" };
    if (command === config.psqlBinary) return { code: 0, stdout: `${config.dataDir}|${config.port}|127.0.0.1|off|${config.username}` };
    return { code: 0 };
  });
  config.process = runner; const old = process.env.DB_CLONE_BACKUP; process.env.DB_CLONE_BACKUP = source;
  try { await assert.rejects(() => cloneProduction(config), (e: Error) => { assert.equal(e.message.includes("fake-secret"), false); assert.equal(e.message.includes(source), false); return true; }); } finally { if (old === undefined) delete process.env.DB_CLONE_BACKUP; else process.env.DB_CLONE_BACKUP = old; }
});

test("backup parent directory symlink is rejected before restore or process calls", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clone-backup-link-")); const outside = await mkdtemp(path.join(os.tmpdir(), "clone-backup-out-"));
  await symlink(outside, path.join(root, "backups")); const config = defaultCloneConfig(root); const runner = fakeRunner((command) => command === config.postgresBinary ? { code: 0, stdout: "PostgreSQL 16" } : { code: 0 }); config.process = runner;
  await assert.rejects(() => cloneProduction(config)); assert.equal(runner.calls.length, 0);
});

test("real integration restores a one-table SQL clone and stops cleanly", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clone-real-")); const dir = path.join(root, "backups/production");
  await mkdir(dir, { recursive: true }); await writeFile(path.join(dir, "sample.sql"), "CREATE TABLE sample(id int);\n");
  const server = net.createServer(); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port; await new Promise<void>(resolve => server.close(() => resolve()));
  const config = defaultCloneConfig(root); config.port = port; config.process = processRunner;
  try {
    await cloneProduction(config); const metadata = await readCloneMetadata(config);
    assert.equal(metadata.host, "127.0.0.1"); assert.equal(metadata.port, port); assert.equal(metadata.sourceKind, "backup");
    const status = await processRunner.capture(config.pgCtlBinary, ["-D", config.dataDir, "status"]); assert.equal(status.code, 3);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("cloneProduction symlink path finalizer invokes zero pg_ctl", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clone-final-link-")); const outside = await mkdtemp(path.join(os.tmpdir(), "clone-final-out-"));
  const config = defaultCloneConfig(root); await mkdir(config.localRoot, { recursive: true }); await symlink(outside, config.cloneRoot);
  const runner = fakeRunner(); config.process = runner; await assert.rejects(() => cloneProduction(config));
  assert.equal(runner.calls.filter(c => c.command === config.pgCtlBinary).length, 0);
});

test("marker ownership mismatch invokes zero destructive calls", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clone-owner-final-")); const config = defaultCloneConfig(root);
  await mkdir(config.dataDir, { recursive: true }); await writeFile(config.markerFile, JSON.stringify({ format: 3, workspaceIdentity: "wrong", cloneIdentity: "wrong", database: config.database, username: config.username, port: config.port, postgresMajor: "16" }));
  const runner = fakeRunner(); config.process = runner; await assert.rejects(() => cloneProduction(config));
  assert.equal(runner.calls.filter(c => c.command === config.pgCtlBinary || c.command === config.dropdbBinary).length, 0);
});

test("existing-clone start failure attempts safe shutdown", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clone-start-cleanup-"));
  const config = defaultCloneConfig(root);
  let status = 3;
  const runner = fakeRunner((command, args) => {
    if (command === config.postgresBinary) {
      return { code: 0, stdout: "postgres (PostgreSQL) 16.10" };
    }
    if (command === config.pgCtlBinary && args.at(-1) === "status") {
      return { code: status };
    }
    if (command === config.pgCtlBinary && args.includes("start")) {
      status = 0;
      return { code: 0 };
    }
    if (command === config.pgCtlBinary && args.includes("stop")) {
      status = 3;
      return { code: 0 };
    }
    if (command === config.psqlBinary) {
      return { code: 1, stderr: "identity probe failed" };
    }
    return { code: 0 };
  });
  config.process = runner;
  await initializeCluster(config);
  await writeFile(path.join(config.dataDir, "PG_VERSION"), "16\n");
  await writeFile(
    config.metadataFile,
    serializeCloneMetadata({
      host: "127.0.0.1",
      port: config.port,
      username: config.username,
      database: config.database,
      sourceKind: "schema-only",
      sourceFingerprint: "a".repeat(64),
      restoredAt: new Date(0).toISOString(),
    }),
  );
  runner.calls.length = 0;

  await assert.rejects(
    () => startExistingManagedCloneServer(config),
    /Local PostgreSQL query failed/,
  );
  assert.equal(
    runner.calls.some((call) => call.command === config.pgCtlBinary && call.args.includes("stop")),
    true,
  );
  assert.equal(status, 3);
});