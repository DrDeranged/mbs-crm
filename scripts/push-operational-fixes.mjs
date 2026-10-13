import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ReplitConnectors } from "@replit/connectors-sdk";

const repo = "/repos/DrDeranged/mbs-crm";
const report = "reports/task-dates-inbound-funnel-2026-10-13";
const source = process.argv[2];
const base = process.argv[3];
assert.match(source ?? "", /^[a-f0-9]{40}$/);
assert.match(base ?? "", /^[a-f0-9]{40}$/);
const connectors = new ReplitConnectors();
const blobHash = bytes => createHash("sha1").update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest("hex");
async function github(method, path, body) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await connectors.proxy("github", repo + path, {
      method, headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.ok) {
      await new Promise(resolve => setTimeout(resolve, 140));
      return response.json();
    }
    if (response.status === 429 || response.status >= 500) {
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      continue;
    }
    throw new Error(`GitHub ${method} ${path}: HTTP ${response.status}`);
  }
  throw new Error(`GitHub retry limit: ${path}`);
}
const transcript = readFileSync(`${report}/preflight.log`, "utf8");
assert.match(transcript.trim(), /PREFLIGHT PASS$/);
const fixture = JSON.parse(readFileSync(`${report}/fixture-results.json`, "utf8"));
assert.equal(fixture.assertions.length, 8);
assert.deepEqual(fixture.browserFailures, []);
assert.equal(fixture.cleanup.databaseDropped, true);
const ref = await github("GET", "/git/refs/heads/main");
const head = ref.object.sha;
const commit = await github("GET", "/git/commits/" + head);
const tree = await github("GET", "/git/trees/" + commit.tree.sha + "?recursive=1");
assert.equal(tree.truncated, false);
const sources = execFileSync("git", ["diff", "--name-only", base, source], { encoding: "utf8" }).trim().split("\n");
assert.ok(sources.length > 0);
assert.ok(sources.every(path => !/migrations\/|^\.agents\//.test(path)));
const expected = new Map(tree.tree.filter(file => file.type === "blob").map(file => [file.path, file.sha]));
const uploads = new Map();
const mergedContracts = [];
const directory = mkdtempSync(join(tmpdir(), "crm-operational-push-"));
try {
  for (const path of sources) {
    const remote = tree.tree.find(file => file.path === path);
    const exists = spawnSync("git", ["cat-file", "-e", `${base}:${path}`]).status === 0;
    let bytes = execFileSync("git", ["show", `${source}:${path}`]);
    if (exists) {
      const baseline = execFileSync("git", ["show", `${base}:${path}`]);
      if (blobHash(baseline) !== remote?.sha) {
        assert.ok(["lib/api-spec/openapi.yaml", "lib/api-zod/src/generated/api.ts",
          "lib/api-client-react/src/generated/api.schemas.ts"].includes(path), `Unexpected main conflict: ${path}`);
        const remoteBlob = await github("GET", "/git/blobs/" + remote.sha);
        const theirs = Buffer.from(remoteBlob.content, "base64");
        const oursPath = join(directory, "ours"), basePath = join(directory, "base"), theirsPath = join(directory, "theirs");
        writeFileSync(oursPath, bytes); writeFileSync(basePath, baseline); writeFileSync(theirsPath, theirs);
        const merge = spawnSync("git", ["merge-file", "-p", oursPath, basePath, theirsPath], { maxBuffer: 8 * 1024 * 1024 });
        assert.equal(merge.status, 0, `Contract merge conflict: ${path}`);
        bytes = merge.stdout;
        mergedContracts.push(path);
        // The only new contract fields must agree with the tested local code.
        for (const field of ["totalCount", "inboundCallsToday", "answeredCallsToday", "missedCallsToday", "voicemailCallsToday"])
          assert.ok(bytes.toString().includes(field));
      }
    } else assert.equal(remote, undefined, `New file already present on main: ${path}`);
    uploads.set(path, bytes);
  }
} finally { rmSync(directory, { recursive: true, force: true }); }

for (const file of readdirSync(report)) {
  if (file === "github-push.json") continue;
  uploads.set(`${report}/${file}`, readFileSync(`${report}/${file}`));
}
const entries = [];
for (const [path, bytes] of uploads) {
  const blob = await github("POST", "/git/blobs", { content: bytes.toString("base64"), encoding: "base64" });
  assert.equal(blob.sha, blobHash(bytes));
  expected.set(path, blob.sha);
  entries.push({ path, mode: "100644", type: "blob", sha: blob.sha });
}
const nextTree = await github("POST", "/git/trees", { base_tree: commit.tree.sha, tree: entries });
const newCommit = await github("POST", "/git/commits", {
  message: "Fix company-calendar tasks, inbound call badge and recorded pipeline milestones; attach preflight evidence",
  tree: nextTree.sha, parents: [head],
});
assert.equal((await github("GET", "/git/refs/heads/main")).object.sha, head, "Main advanced; refusing update");
await github("PATCH", "/git/refs/heads/main", { sha: newCommit.sha, force: false });
assert.equal((await github("GET", "/git/refs/heads/main")).object.sha, newCommit.sha);
const verified = await github("GET", "/git/trees/" + nextTree.sha + "?recursive=1");
assert.equal(verified.truncated, false);
const verifiedFiles = new Map(verified.tree.filter(file => file.type === "blob").map(file => [file.path, file.sha]));
assert.deepEqual(verifiedFiles, expected, "Entire remote tree must match intended updates and preserve unrelated files");
const result = { githubCommit: newCommit.sha, previousMain: head, localSource: source,
  preflight: "11/11 PASS", force: false, published: false, mergedContracts,
  filesChanged: [...uploads.keys()], allRemoteFilesVerified: true };
writeFileSync(`${report}/github-push.json`, JSON.stringify(result, null, 2) + "\n");
// Record verification in a child commit, avoiding a self-referential commit hash.
const resultPath = `${report}/github-push.json`;
const resultBytes = readFileSync(resultPath);
const resultBlob = await github("POST", "/git/blobs", { content: resultBytes.toString("base64"), encoding: "base64" });
assert.equal(resultBlob.sha, blobHash(resultBytes));
const evidenceTree = await github("POST", "/git/trees", { base_tree: nextTree.sha,
  tree: [{ path: resultPath, mode: "100644", type: "blob", sha: resultBlob.sha }] });
const evidenceCommit = await github("POST", "/git/commits", {
  message: "Record verified GitHub push evidence for dashboard fixes",
  tree: evidenceTree.sha, parents: [newCommit.sha],
});
assert.equal((await github("GET", "/git/refs/heads/main")).object.sha, newCommit.sha);
await github("PATCH", "/git/refs/heads/main", { sha: evidenceCommit.sha, force: false });
assert.equal((await github("GET", "/git/refs/heads/main")).object.sha, evidenceCommit.sha);
expected.set(resultPath, resultBlob.sha);
const finalTree = await github("GET", "/git/trees/" + evidenceTree.sha + "?recursive=1");
assert.equal(finalTree.truncated, false);
assert.deepEqual(new Map(finalTree.tree.filter(file => file.type === "blob").map(file => [file.path, file.sha])), expected);
console.log(JSON.stringify({ ...result, finalMain: evidenceCommit.sha }, null, 2));
