import { test } from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import {
  assertDevelopmentUrl, diffSnapshots, formatSnapshotDiff, parseSnapshotOutput, snapshotDatabase,
  type SchemaSnapshot,
} from "./db-divergence";
import type { ProcessRunner } from "./process";

const schema = (ledger: SchemaSnapshot["ledger"], tables: Record<string, Record<string, any>>): SchemaSnapshot => ({
  valid: ledger.valid, ledger, tables: new Map(Object.entries(tables).map(([table, columns]) => [
    table, { columns: new Map(Object.entries(columns).map(([name, value]) => [name, { name, ...value }])) },
  ])),
});
const ledger = (...rows: { name: string; checksum: string; state: string }[]) => ({ valid: true, rows });

test("diffs ledger rows, tables, and every column signature", () => {
  const a = schema(ledger(
    { name: "002.sql", checksum: "old", state: "applied" },
    { name: "clone.sql", checksum: "x", state: "failed" },
  ), {
    removed: { gone: { type: "text" } },
    same: { changed: { type: "integer", nullable: false, defaultExpression: "1", identity: "", generated: "" } },
  });
  const b = schema(ledger(
    { name: "002", checksum: "new", state: "superseded" },
    { name: "dev.sql", checksum: "x", state: "applied" },
  ), {
    added: { newcol: { type: "text" } },
    same: {
      changed: { type: "bigint", nullable: true, defaultExpression: "2", identity: "BY DEFAULT", generated: "ALWAYS" },
    },
  });
  assert.deepEqual(diffSnapshots(a, b), {
    ledgerOnlyClone: ["clone"], ledgerOnlyDev: ["dev"], ledgerChanged: ["002"],
    tablesOnlyClone: ["removed"], tablesOnlyDev: ["added"], columnsOnlyClone: [],
    columnsOnlyDev: [], columnsChanged: ["same.changed"],
  });
  const c = schema(ledger({ name: "002", checksum: "new", state: "applied" }), {
    same: { changed: { type: "bigint", nullable: true, defaultExpression: "2", identity: "BY DEFAULT", generated: "ALWAYS" } },
  });
  assert.deepEqual(diffSnapshots(a, c).ledgerChanged, ["002"]);
  assert.deepEqual(diffSnapshots(schema(ledger(), { same: { changed: { type: "bigint", nullable: true, defaultExpression: "2", identity: "BY DEFAULT", generated: "ALWAYS" } } }), c).columnsChanged, []);
  assert.deepEqual(diffSnapshots(schema(ledger(), { same: { changed: { type: "integer", nullable: false, defaultExpression: "1", identity: "", generated: "" } } }), c).columnsChanged, ["same.changed"]);
});

test("diff formatting is deterministic and redacts values", () => {
  const text = formatSnapshotDiff({
    ledgerOnlyClone: ["z", "a"], ledgerOnlyDev: [], ledgerChanged: ["m"], tablesOnlyClone: [],
    tablesOnlyDev: ["b", "a"], columnsOnlyClone: [], columnsOnlyDev: [], columnsChanged: [],
  });
  assert.match(text, /Clone-only ledger rows: z, a/);
  assert.doesNotMatch(text, /secret|checksum|default/i);
  const sorted = diffSnapshots(schema(ledger({ name: "z", checksum: "1", state: "applied" }, { name: "a", checksum: "2", state: "applied" }), {}), schema(ledger(), {}));
  assert.deepEqual(sorted.ledgerOnlyClone, ["a", "z"]);
});

test("parser excludes schema_migrations from tables and detects missing/malformed ledgers", () => {
  const parsed = parseSnapshotOutput([
    `L\u001f001.sql\u001fabc\u001fapplied`, `T\u001fschema_migrations\u001f`, `T\u001fusers\u001f`,
    `C\u001fusers\u001fid\u001finteger\u001ftrue\u001f\u001f\u001f\u001f`,
  ].join("\n"));
  assert.equal(parsed.valid, true);
  assert.deepEqual([...parsed.tables.keys()], ["users"]);
  assert.equal(parseSnapshotOutput("X\u001f").valid, false);
  assert.equal(parseSnapshotOutput("").valid, false);
});

test("URL guard rejects clone, non-PostgreSQL, and malformed URLs without echoing secrets", () => {
  assert.throws(() => assertDevelopmentUrl("postgresql://postgres:supersecret@127.0.0.1:55432/production_clone", "postgresql://postgres@127.0.0.1:55432/production_clone"), /managed clone/i);
  for (const value of ["https://user:supersecret@example.com/db", "not a url"]) {
    assert.throws(() => assertDevelopmentUrl(value, "postgresql://postgres@127.0.0.1:55432/production_clone"), error => {
      assert.doesNotMatch(String(error), /supersecret|example\.com/); return true;
    });
  }
});

test("snapshot runner uses a temporary SQL file, read-only transaction, timeout, and cleans it up", async () => {
  let file = "";
  const runner: ProcessRunner = {
    run: async () => {},
    capture: async (_command, args) => {
      file = args[args.indexOf("--file") + 1];
      const sql = await readFile(file, "utf8");
      assert.match(sql, /BEGIN READ ONLY/);
      assert.match(sql, /statement_timeout = '15s'/);
      assert.ok(args.includes("--set=ON_ERROR_STOP=on"));
      return { code: 0, stdout: "X\u001f\n", stderr: "" };
    },
  };
  const result = await snapshotDatabase("postgresql://user:secret@example.com/dev", runner);
  assert.equal(result.valid, false);
  await assert.rejects(access(file));
});

test("snapshot runner does not expose database URL in query failures", async () => {
  const secret = "postgresql://u:verysecret@example.com/dev";
  const runner: ProcessRunner = { run: async () => {}, capture: async () => ({ code: 1, stdout: "", stderr: secret }) };
  await assert.rejects(snapshotDatabase(secret, runner), error => {
    assert.doesNotMatch(String(error), /verysecret|example\.com/); return true;
  });
});