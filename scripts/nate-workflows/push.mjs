// Scoped, non-forced connector push. The manifest pins the original baseline
// and tested bytes; unrelated remote files and local working edits are preserved.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { ReplitConnectors } from "@replit/connectors-sdk";

const root = "reports/nate-workflows";
const repo = "DrDeranged/mbs-crm";
const manifest = JSON.parse(await readFile(`${root}/intentional-file-manifest.json`, "utf8"));
const connector = new ReplitConnectors();
const git = (...args) => execFileSync("git", ["--no-optional-locks", ...args], { stdio: ["ignore", "pipe", "pipe"] });
async function github(method, path, body) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await connector.proxy("github", `/repos/${repo}/${path}`, {
      method, headers: { "Content-Type": "application/json", Accept: "application/vnd.github+json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.ok) return response.json();
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 3) {
      throw new Error(`GitHub ${method} ${path}: HTTP ${response.status}`);
    }
    await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
  }
}
const previousCommit = (await github("GET", "git/refs/heads/main")).object.sha;
const parent = await github("GET", `git/commits/${previousCommit}`);
const oldTree = await github("GET", `git/trees/${parent.tree.sha}?recursive=1`);
assert.equal(oldTree.truncated, false);
const oldFiles = new Map(oldTree.tree.filter(entry => entry.type === "blob").map(entry => [entry.path, entry]));
const files = [];
for (const file of manifest.files) {
  const bytes = await readFile(file.path);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256, `Tested bytes changed: ${file.path}`);
  // Compute Git's exact content-addressed blob hash without touching the index.
  const actualBlob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  let baseline;
  try { baseline = git("rev-parse", `${manifest.baseline}:${file.path}`).toString().trim(); } catch {}
  const remote = oldFiles.get(file.path)?.sha;
  assert(remote === baseline || remote === actualBlob, `Remote conflict at ${file.path}; reconcile and retest`);
  files.push({ ...file, blob: actualBlob, baseline });
}
await writeFile(`${root}/github-readonly-comparison.json`, JSON.stringify({
  passed: true, previousCommit, parentTree: parent.tree.sha, localBaseline: manifest.baseline,
  localTestedRevision: manifest.testedRevision, files,
}, null, 2));
console.log(`GITHUB READ-ONLY CHECK PASS ${previousCommit}: ${files.length} intentional paths`);
if (!process.argv.includes("--push")) process.exit(0);
const preflight = await readFile(`${root}/preflight-full.log`, "utf8");
assert(/PREFLIGHT PASS\s*$/.test(preflight.trim()), "Authoritative preflight final PASS required");
// Regression tests print simulated gate markers, so markers alone are not proof.
// Correlate every real outer gate with its actual pnpm workspace invocation.
const preflightSource = await readFile("scripts/src/preflight.ts", "utf8");
const actualChecks = [...preflightSource.matchAll(/\{ label: "([^"]+)", script: "([^"]+)" \}/g)];
assert.equal(actualChecks.length, 11, "The authoritative preflight must retain eleven gates");
const escapePattern = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
let outerOffset = 0;
const actualOuterGates = actualChecks.map(([_, label, script], index) => {
  const pattern = new RegExp(`PREFLIGHT ${index + 1}/11: ${escapePattern(label)}\\s*\\n> workspace@\\S+ ${escapePattern(script)}\\s`);
  const match = pattern.exec(preflight.slice(outerOffset));
  assert.ok(match, `Real outer gate ${index + 1} must invoke pnpm run ${script}`);
  outerOffset += match.index + match[0].length;
  return { gate: index + 1, label, script };
});
const certification = JSON.parse(await readFile(`${root}/certification-results.json`, "utf8"));
assert.equal(certification.verdict, "PASS", "Authenticated certification must pass");
assert.equal(certification.criticalBehaviorComplete, true, "Static captures alone cannot certify the assignment and audience journeys");
for (const [name, result] of Object.entries(certification.behaviorAssertions ?? {})) {
  assert.equal(result.passed, true, `Authenticated behavior assertion failed: ${name}`);
}
const entries = [];
for (const file of files) {
  if (oldFiles.get(file.path)?.sha === file.blob) continue;
  const bytes = await readFile(file.path);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256);
  const uploaded = await github("POST", "git/blobs", { content: bytes.toString("base64"), encoding: "base64" });
  assert.equal(uploaded.sha, file.blob);
  entries.push({ path: file.path, mode: oldFiles.get(file.path)?.mode ?? "100644", type: "blob", sha: file.blob });
  await new Promise(resolve => setTimeout(resolve, 150));
}
const tree = await github("POST", "git/trees", { base_tree: parent.tree.sha, tree: entries });
const commit = await github("POST", "git/commits", {
  message: "Complete eligible staff assignments, company-first deal identities, lead sources and campaign open-deal audiences\n\nIsolated role/mobile certification and full preflight; no schema migration, deployment or live communications.",
  tree: tree.sha, parents: [previousCommit],
});
assert.equal((await github("GET", "git/refs/heads/main")).object.sha, previousCommit, "Remote main changed during upload");
await github("PATCH", "git/refs/heads/main", { sha: commit.sha, force: false });
assert.equal((await github("GET", "git/refs/heads/main")).object.sha, commit.sha);
const verifiedTree = await github("GET", `git/trees/${tree.sha}?recursive=1`);
assert.equal(verifiedTree.truncated, false);
const remoteFiles = new Map(verifiedTree.tree.filter(entry => entry.type === "blob").map(entry => [entry.path, entry]));
for (const file of files) {
  assert.equal(remoteFiles.get(file.path)?.sha, file.blob);
  const blob = await github("GET", `git/blobs/${file.blob}`);
  assert.equal(blob.encoding, "base64");
  assert.equal(createHash("sha256").update(Buffer.from(blob.content, "base64")).digest("hex"), file.sha256);
  await new Promise(resolve => setTimeout(resolve, 150));
}
const intended = new Set(files.map(file => file.path));
let preserved = 0;
for (const [path, file] of oldFiles) if (!intended.has(path)) {
  assert.equal(remoteFiles.get(path)?.sha, file.sha, `Unrelated remote file changed: ${path}`);
  preserved++;
}
const proof = { passed: true, repository: repo, remoteCommit: commit.sha, tree: tree.sha,
  previousCommit, commitUrl: `https://github.com/${repo}/commit/${commit.sha}`,
  localTestedRevision: manifest.testedRevision, files, unrelatedRemoteFilesPreserved: preserved,
  preflightSha256: createHash("sha256").update(preflight).digest("hex"), actualOuterGates,
  forced: false, published: false };
await writeFile(`${root}/github-push-proof.json`, JSON.stringify(proof, null, 2));
console.log(`GITHUB VERIFIED ${commit.sha}; ${files.length} file hashes verified; ${preserved} unrelated remote files preserved; not published`);
