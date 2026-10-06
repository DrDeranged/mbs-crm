// Cheap preflight-only checker: no Playwright, Clerk, browser, API server, or fixture DB.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, "../..");
const candidate = "b3975aea8761ce5cdb43ec3206fe995ee012883a";
const localSnapshot = "3d40d822dae9eeb103ba65923b4e445a7c8531a2";
const expectedWebSha = "704b9236468e84d7fd5c85f7c5305ee8659cc4ca2c2c87c5db7786d45ad5d6ca";
const expectedApiSha = "fbb87d2f59917f20c4bf42f8dfd1da8149611add98d6269d189566cb09bfc79c";
const binding = JSON.parse(await readFile(join(root, "reports/opt-in-recertification/final-source-binding.json"), "utf8"));
const clone = JSON.parse(await readFile(join(root, "reports/opt-in-recertification/migration-clone-provenance.json"), "utf8"));
const manifest = JSON.parse(await readFile(join(root, "reports/opt-in-recertification/approval-manifest.json"), "utf8"));
assert.equal(binding.candidate, candidate);
assert.equal(binding.sourceFilesMatched, 881);
assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), localSnapshot);
assert.equal(clone.sourceKind, "schema-only");
assert.equal(clone.realProductionBackup, false);
assert.equal(clone.productionDataRehearsalCertified, false);
assert.equal((await readFile(join(root, "reports/opt-in-recertification/preflight-exit.txt"), "utf8")).trim(), "0");

const webSha = createHash("sha256").update(await readFile("/home/runner/workspace/.local/opt-in-recertification/public/index.html")).digest("hex");
async function treeHash(directory) {
  const hash = createHash("sha256");
  async function walk(dir, relative = "") {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      const rel = join(relative, entry.name);
      if (entry.isDirectory()) await walk(join(dir, entry.name), rel);
      else if (entry.isFile()) { hash.update(rel); hash.update("\0"); hash.update(await readFile(join(dir, entry.name))); hash.update("\0"); }
    }
  }
  await walk(directory);
  return hash.digest("hex");
}
const apiSha = await treeHash(join(root, "artifacts/api-server/dist"));
assert.equal(webSha, expectedWebSha);
assert.equal(apiSha, expectedApiSha);

const source = async path => readFile(join(root, path), "utf8");
const sandbox = await source("scripts/visual-refresh/sandbox.mjs");
const twilio = await source("artifacts/api-server/src/routes/twilio.ts");
const integration = await source("artifacts/api-server/src/lib/integrationHealth.ts");
const settingsRoute = await source("artifacts/api-server/src/routes/settings.ts");
const ownedNumbers = await source("artifacts/api-server/src/lib/telephonySettings.ts");
const applications = await source("artifacts/api-server/src/routes/applications.ts");
assert.ok(sandbox.includes("!/^(TWILIO_"));
assert.ok(twilio.includes('const ACCOUNT_SID = process.env["TWILIO_ACCOUNT_SID"];'));
assert.ok(twilio.includes('const reason = getTwilioFailureReason();'));
assert.ok(twilio.includes('res.status(503).json({ error: "Twilio token unavailable", reason })'));
assert.ok(integration.includes('if (!env["TWILIO_ACCOUNT_SID"]) return "missing:TWILIO_ACCOUNT_SID"'));
assert.ok(settingsRoute.includes('router.get("/settings/telephony/owned-numbers"'));
assert.ok(settingsRoute.includes("listOwnedTwilioNumbers()"));
assert.ok(settingsRoute.includes('res.status(503).json({ error: "Twilio owned-number lookup unavailable" })'));
assert.ok(ownedNumbers.includes('process.env["TWILIO_ACCOUNT_SID"]'));
assert.ok(ownedNumbers.includes('process.env["TWILIO_AUTH_TOKEN"]'));
assert.ok(ownedNumbers.includes('throw new Error("Twilio owned-number lookup unavailable")'));
assert.ok(applications.includes('router.get("/leads/:id/application"'));
assert.ok(applications.includes('res.status(404).json({ error: "No application on file" })'));

assert.equal(manifest.additions.expectedTotal, 12);
assert.equal(manifest.additions.cases.length, 6);
assert.deepEqual(manifest.removals[0].cases, ["leads-390-rep","leads-768-rep","pipeline-390-rep","pipeline-768-rep"]);
assert.equal(manifest.removals[0].expectedBaselineTotal, 4);
assert.equal(manifest.removals[0].expectedArchivedTotal, 4);
assert.equal(manifest.removals[0].expectedCandidateTotal, 0);
const exemptions = JSON.parse(await readFile(join(root, "reports/structural-certification-2026-10-03/after/exempt-controls.json"), "utf8"));
assert.equal(Object.keys(exemptions).length, 36);
console.log(JSON.stringify({ status: "PASS: source/fixture proof checked without browser, Clerk, or fixture DB",
  candidate, localSnapshot, sourceFilesMatched: binding.sourceFilesMatched, webSha, apiSha,
  cloneSourceKind: clone.sourceKind, productionDataRehearsalCertified: clone.productionDataRehearsalCertified,
  preflightExit: 0, additions: manifest.additions.expectedTotal, removals: manifest.removals[0].expectedCandidateTotal,
  unchangedExemptionCases: Object.keys(exemptions).length }, null, 2));
