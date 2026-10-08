import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, readdir, copyFile, rm } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { PgDialect } from "drizzle-orm/pg-core";
import { pushSchema } from "drizzle-kit/api";
import * as schema from "./schema/index";
import { discoverMigrations, runMigrations } from "./migrate";
import { inspectAttributionCatalog } from "./attributionCatalog";
import { snapshotLedger } from "./migrationRehearsalRunner";

const root = path.resolve(import.meta.dirname, "../../..");
const migrationsDir = path.join(root, "lib/db/migrations");
const source = new URL(process.env.ATTRIBUTION_REHEARSAL_BASE_URL ?? "");
if (source.hostname !== "127.0.0.1" || source.pathname !== "/postgres") throw new Error("Rehearsal requires isolated local PostgreSQL");
const admin = new Pool({ connectionString: source.href });
const dialect = new PgDialect();
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject).listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}
async function boot(url: string): Promise<object> {
  const port = await freePort();
  const child = spawn(process.execPath, ["--enable-source-maps", path.join(root, "artifacts/api-server/dist/index.mjs")], {
    env: { ...process.env, DATABASE_URL: url, NODE_ENV: "production", PORT: String(port), MIGRATE_ON_BOOT: "true",
      DRIP_AUTOMATION_ENABLED: "false", USFA_POLLER_ENABLED: "false", USFA_APPLICATION_POLLER_ENABLED: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", data => { log += String(data); });
  child.stderr.on("data", data => { log += String(data); });
  try {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`API boot exited ${child.exitCode}: ${log}`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/healthz`);
        const state = await response.json() as { phase?: string };
        if (state.phase === "ready") {
          assert(!log.includes("MIGRATION FAILED"), log);
          assert(log.includes("schema OK"), log);
          console.log(`BOOT ${JSON.stringify({ status: response.status, ...state })}`);
          console.log(log);
          return { http: response.status, phase: state.phase, schemaFailure: false };
        }
      } catch { /* Listener can be absent during startup, bounded above. */ }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new Error(`API boot timed out: ${log}`);
  } finally {
    child.kill("SIGTERM");
    await Promise.race([new Promise(resolve => child.once("exit", resolve)), new Promise(resolve => setTimeout(resolve, 5000))]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}
async function catalog(pool: Pool): Promise<string> {
  const result = await pool.query(`SELECT jsonb_build_object(
    'columns',(SELECT jsonb_agg(x ORDER BY table_name,column_name) FROM (
      SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns
      WHERE table_schema='public' AND table_name<>'schema_migrations') x),
    'constraints',(SELECT jsonb_agg(x ORDER BY table_name,conname) FROM (
      SELECT c.relname table_name,k.conname,pg_get_constraintdef(k.oid) definition,k.convalidated FROM pg_constraint k
      JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname<>'schema_migrations') x),
    'indexes',(SELECT jsonb_agg(x ORDER BY tablename,indexname) FROM (
      SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename<>'schema_migrations') x)
    ) AS catalog`);
  return createHash("sha256").update(JSON.stringify(result.rows[0].catalog)).digest("hex");
}
const oldDir = await mkdtemp(path.join(root, ".local/attribution-before-"));
const files = await readdir(migrationsDir);
for (const name of files.filter(n => n.endsWith(".sql") && Number(n.slice(0, 3)) <= 66)) {
  await copyFile(path.join(migrationsDir, name), path.join(oldDir, name));
}
const migrations = await discoverMigrations(migrationsDir);
const original = migrations.find(m => m.id.startsWith("067_"))!;
const rename = migrations.find(m => m.id.startsWith("068_"))!;
const results: object[] = [];
try {
  for (const scenario of ["production-profile", "publish-model-sync", "partial-profile", "fresh-empty"]) {
    const name = `attribution_${scenario.replaceAll("-", "_")}`;
    await admin.query(`CREATE DATABASE "${name}"`);
    await admin.query(`ALTER DATABASE "${name}" SET log_statement='ddl'`);
    const url = new URL(source); url.pathname = `/${name}`;
    const pool = new Pool({ connectionString: url.href });
    const database = drizzle(pool);
    let ddlBatches = 0;
    const counted = (executor: { execute: typeof database.execute }): any => ({
      execute: async (query: Parameters<typeof database.execute>[0]) => {
        const text = dialect.sqlToQuery(query as never).sql;
        const statements = text.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, "")
          .replace(/'(?:''|[^'])*'/g, "''");
        if (/(?:^|;)\s*(?:CREATE|ALTER|DROP|DO)\b/i.test(statements)) ddlBatches++;
        return executor.execute(query);
      },
      transaction: (callback: (tx: any) => Promise<unknown>) => database.transaction(tx => callback(counted(tx))),
    });
    try {
      if (scenario !== "fresh-empty") {
        const baseline = await runMigrations({ db: database, migrationsDir: oldDir, metadataOnly: false });
        assert.equal(baseline.failed, null, JSON.stringify(baseline.failed));
        assert.equal(baseline.pending.length, 0);
        if (scenario === "publish-model-sync") {
          // Actual Drizzle model diff, not a replay of recovery SQL.
          const diff = await pushSchema(schema, database, ["public"], ["*"]);
          console.log(`MODEL-SYNC statements=${diff.statementsToExecute.length}`);
          for (const statement of diff.statementsToExecute) await pool.query(statement);
        } else if (scenario === "production-profile") {
          await pool.query(original.sql);
          await pool.query(rename.sql);
          // This is the exact historical production profile before publishing
          // the next model head. Prepare new model additions separately, just as
          // managed publishing does, before testing DDL-free startup recovery.
          const diff = await pushSchema(schema, database, ["public"], ["*"]);
          console.log(`PRODUCTION-PROFILE next-publish model statements=${diff.statementsToExecute.length}`);
          for (const statement of diff.statementsToExecute) await pool.query(statement);
        } else await pool.query("ALTER TABLE campaigns ADD COLUMN tracking_since timestamptz");
        if (scenario !== "publish-model-sync") {
          await pool.query("INSERT INTO schema_migrations(name,checksum,failed_at,error) VALUES($1,$2,now(),$3)",
            [original.id, original.checksum, 'column "tracking_since" of relation "campaigns" already exists']);
        }
      }
      const before = await snapshotLedger(pool), catalogBefore = await catalog(pool);
      const pgLog = process.env.ATTRIBUTION_REHEARSAL_PG_LOG!;
      const logBefore = (await readFile(pgLog)).length;
      const metadataOnly = scenario === "production-profile" || scenario === "publish-model-sync";
      const report = await runMigrations({ db: counted(database), metadataOnly });
      assert.equal(report.failed, null, JSON.stringify(report.failed));
      assert.equal(report.pending.length, 0);
      assert.deepEqual(await inspectAttributionCatalog(database), { missing: [], conflicts: [] });
      const after = await snapshotLedger(pool), catalogAfter = await catalog(pool);
      assert.equal(after.count, migrations.length);
      if (metadataOnly) {
        assert.equal(ddlBatches, 0, "Existing production/model-sync schema must execute zero DDL");
        assert.equal(catalogBefore, catalogAfter, "Existing application catalog changed");
        assert.equal(after.rows.find(r => r.name === original.id)?.state, "superseded");
      }
      const bootResult = await boot(url.href);
      assert.equal(await catalog(pool), catalogAfter, "Application boot changed the schema");
      const schemaLog = (await readFile(pgLog)).subarray(logBefore).toString();
      // PostgreSQL's log_statement=ddl already classifies these entries. Count
      // every statement entry: a leading comment or BEGIN must not hide DDL.
      const postgresDdlStatements = [...schemaLog.matchAll(/\bLOG:\s+(?:statement:|execute[^:]*:)/gi)].length;
      if (metadataOnly) assert.equal(postgresDdlStatements, 0, "PostgreSQL observed schema DDL during recovery or boot");
      const repeated = await runMigrations({ db: counted(database), metadataOnly: true });
      assert.equal(repeated.failed, null);
      assert.equal(repeated.applied.length, 0);
      // Definitions that conflict must fail before ledger adoption or DDL.
      if (scenario === "production-profile") {
        await pool.query("ALTER TABLE campaigns ALTER COLUMN tracking_since TYPE text");
        const rejected = await runMigrations({ db: counted(database), metadataOnly: true });
        assert(rejected.failed?.error.includes("column campaigns.tracking_since"));
        console.log("CATALOG DRIFT REJECTION PASS");
      }
      if (scenario === "partial-profile") {
        const recovery = migrations.find(m => m.id.startsWith("069_"))!;
        await pool.query(recovery.sql);
        await pool.query(recovery.sql);
        assert.equal(await catalog(pool), catalogAfter);
        console.log("069 RAW SQL REPLAY TWICE: catalog unchanged PASS");
      }
      const result = { scenario, sourceKind: "isolated-metadata-matched-fixture-not-production-data",
        ledgerBefore: before, ledgerAfter: after, ddlBatches, postgresDdlStatements,
        catalogBefore, catalogAfter, boot: bootResult, verdict: "PASS" };
      results.push(result);
      console.log(`ATTRIBUTION-REHEARSAL ${JSON.stringify(result)}`);
    } finally {
      await pool.end();
      // Pool.end() can resolve before the clients' TCP shutdown reaches PostgreSQL.
      // A forced drop then sends 57P01 to an ending idle client and can emit an
      // unhandled pool error. Wait for real server-side disconnects; do not hide
      // connection leaks or operational errors behind a FORCE cleanup.
      const deadline = Date.now() + 10_000;
      while (true) {
        const remaining = await admin.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM pg_stat_activity WHERE datname=$1", [name],
        );
        if (remaining.rows[0].count === "0") break;
        if (Date.now() >= deadline) throw new Error(`Rehearsal connections did not close for ${scenario}`);
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      await admin.query(`DROP DATABASE "${name}"`);
    }
  }
  console.log(`ATTRIBUTION RECOVERY REHEARSAL PASS scenarios=${results.length}`);
} finally {
  await admin.end();
  await rm(oldDir, { recursive: true, force: true });
}
