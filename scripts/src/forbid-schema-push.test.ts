import assert from "node:assert/strict";
import test from "node:test";
import {
  findForbiddenSchemaPushes,
  shouldScanFile,
} from "./forbid-schema-push";

const kit = ["drizzle", "kit"].join("-");
const api = ["push", "Schema"].join("");
const databaseScript = ["db", "push"].join(":");
const filteredPush = ["pnpm", "--filter", "db", "push"].join(" ");

test("schema path guard detects CLI, package script, filter, and API push paths", () => {
  const findings = findForbiddenSchemaPushes([
    { path: "package.json", content: `{"scripts":{"schema":"${kit} push"}}` },
    { path: "package.json", content: `{"scripts":{"schema":"pnpm run ${databaseScript}"}}` },
    { path: "scripts/post-merge.sh", content: filteredPush },
    { path: "lib/db/check.ts", content: `import { ${api} } from "${kit}/api";` },
  ]);
  assert.deepEqual(
    findings.map(({ path, line }) => `${path}:${line}`),
    ["package.json:1", "package.json:1", "scripts/post-merge.sh:1", "lib/db/check.ts:1"],
  );
});

test("schema path guard ignores ordinary product push references", () => {
  assert.deepEqual(findForbiddenSchemaPushes([
    { path: "package.json", content: `{"dependencies":{"web-push":"^3.6.7"}}` },
    { path: "src/notifications.ts", content: "await sendPushNotification(payload);" },
  ]), []);
});

test("schema path guard permits only the audited schema parity inspection", () => {
  assert.deepEqual(findForbiddenSchemaPushes([
    {
      path: "lib/db/src/schemaCiCheck.ts",
      content: [
        `import { ${api} } from "${kit}/api";`,
        `const diff = await ${api}(schema, database, ["public"], [...SCHEMA_PARITY_TABLE_FILTER]);`,
      ].join("\n"),
    },
  ]), []);

  const findings = findForbiddenSchemaPushes([
    {
      path: "lib/db/src/schemaCiCheck.ts",
      content: `await ${api}(unsafeSchema, productionDatabase, ["public"], ["*"]);`,
    },
    {
      path: "lib/db/src/otherCheck.ts",
      content: `import { ${api} } from "${kit}/api";`,
    },
  ]);
  assert.deepEqual(
    findings.map(({ path, line }) => `${path}:${line}`),
    ["lib/db/src/schemaCiCheck.ts:1", "lib/db/src/otherCheck.ts:1"],
  );
});

test("schema path guard scans source and deployment configuration only", () => {
  assert.equal(shouldScanFile("package.json"), true);
  assert.equal(shouldScanFile(".replit"), true);
  assert.equal(shouldScanFile("artifacts/api/.replit-artifact/artifact.toml"), true);
  assert.equal(shouldScanFile("scripts/post-merge.sh"), true);
  assert.equal(shouldScanFile("reports/preflight.txt"), false);
  assert.equal(shouldScanFile("node_modules/tool/package.json"), false);
});