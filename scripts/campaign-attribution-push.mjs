// Intentional release push through the configured GitHub connector.
// Defaults to read-only comparison. --push requires the saved PASS transcript.
import { ReplitConnectors } from "@replit/connectors-sdk";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

const repo = "DrDeranged/mbs-crm";
const root = "reports/campaign-attribution";
const connector = new ReplitConnectors();
const git = (...args) => execFileSync("git", ["--no-optional-locks", ...args], { stdio: ["ignore", "pipe", "pipe"] });
// Freeze the pre-task baseline and reviewed paths, independent of automatic
// checkpoints that can advance local HEAD before the remote push.
const reviewed = JSON.parse(await readFile(`${root}/github-readonly-comparison.json`, "utf8"));
const localBaseline = reviewed.localBaseline;
const paths = [...new Set([
  ...reviewed.files.map(file => file.path),
  ".agents/memory/applied-seed-migration-lint.md",
  ".agents/memory/github-push-pattern.md",
  "scripts/src/lint-migration-dependencies.ts", "scripts/src/lint-migration-dependencies.test.ts",
  "lib/db/src/migrate.ts", "lib/db/src/migrate.dependencies.test.ts",
  "scripts/src/empty-schema-rehearsal.ts", "scripts/campaign-attribution-render-check.mjs",
])].sort();
assert(paths.length > 0, "No intentional changes");
assert(paths.every(p => /^(artifacts\/(?:api-server|mbs-crm)\/|lib\/(?:db|api-spec|api-client-react|api-zod)\/|docs\/|scripts\/|\.agents\/memory\/)/.test(p)), "Review unexpected changed paths before pushing");
async function github(method, path, body) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await connector.proxy("github", `/repos/${repo}/${path}`, {
      method, headers: { "Content-Type": "application/json", Accept: "application/vnd.github+json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.ok) return response.json();
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 3) throw new Error(`GitHub ${method} ${path}: HTTP ${response.status}`);
    await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
  }
}
const previous = await github("GET", "git/refs/heads/main");
const previousCommit = previous.object.sha;
const parent = await github("GET", `git/commits/${previousCommit}`);
const before = await github("GET", `git/trees/${parent.tree.sha}?recursive=1`);
assert.equal(before.truncated, false);
const oldFiles = new Map(before.tree.filter(e => e.type === "blob").map(e => [e.path, e]));
const files = [];
for (const path of paths) {
  const bytes = await readFile(path);
  const blob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  let baseline = null;
  try { baseline = git("rev-parse", `${localBaseline}:${path}`).toString().trim(); } catch { /* Newly added path. */ }
  const remote = oldFiles.get(path)?.sha ?? null;
  assert(remote === baseline || remote === blob, `Remote-only change to intentional path ${path}; reconcile and retest instead of overwriting`);
  files.push({ path, blob, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length, baseline });
}
await mkdir(root, { recursive: true });
if (!process.argv.includes("--push")) {
  await writeFile(`${root}/github-readonly-comparison.json`, JSON.stringify({ previousCommit, parentTree: parent.tree.sha, localBaseline, files }, null, 2));
  console.log(`GITHUB READ-ONLY CHECK PASS ${previousCommit}: ${files.length} intentional paths; no conflicts`);
  process.exit(0);
}
const preflight = await readFile(`${root}/preflight-full.log`, "utf8");
assert(/PREFLIGHT PASS\s*$/.test(preflight.trim()), "Authoritative preflight final PASS required");
for (let stage = 1; stage <= 11; stage++) assert(preflight.includes(`PREFLIGHT ${stage}/11:`), `Missing preflight gate ${stage}`);
const entries = [];
for (const file of files) {
  if (oldFiles.get(file.path)?.sha === file.blob) continue;
  const bytes = await readFile(file.path);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256, "Source changed after snapshot");
  const uploaded = await github("POST", "git/blobs", { content: bytes.toString("base64"), encoding: "base64" });
  assert.equal(uploaded.sha, file.blob);
  entries.push({ path: file.path, mode: oldFiles.get(file.path)?.mode ?? "100644", type: "blob", sha: file.blob });
  await new Promise(resolve => setTimeout(resolve, 150));
}
const tree = await github("POST", "git/trees", { base_tree: parent.tree.sha, tree: entries });
const commit = await github("POST", "git/commits", {
  message: "Add campaign attribution, durable replies, typed referrals and reconciled KPIs\n\nAppend-only migrations; protected manager comparison; safe public referral context; complete preflight evidence. No publish or live communication/configuration changes.",
  tree: tree.sha, parents: [previousCommit],
});
assert.equal((await github("GET", "git/refs/heads/main")).object.sha, previousCommit, "Remote main changed during push");
await github("PATCH", "git/refs/heads/main", { sha: commit.sha, force: false });
assert.equal((await github("GET", "git/refs/heads/main")).object.sha, commit.sha);
const after = await github("GET", `git/trees/${tree.sha}?recursive=1`);
assert.equal(after.truncated, false);
const remoteFiles = new Map(after.tree.filter(e => e.type === "blob").map(e => [e.path, e]));
for (const file of files) assert.equal(remoteFiles.get(file.path)?.sha, file.blob, `Wrong remote source: ${file.path}`);
const intended = new Set(paths);
let preserved = 0;
for (const [path, file] of oldFiles) if (!intended.has(path)) {
  assert.equal(remoteFiles.get(path)?.sha, file.sha, `Unrelated remote change: ${path}`); preserved++;
}
const receipt = { passed: true, repository: repo, branch: "main", previousCommit, remoteCommit: commit.sha, tree: tree.sha,
  commitUrl: `https://github.com/${repo}/commit/${commit.sha}`, preflightSha256: createHash("sha256").update(preflight).digest("hex"),
  verifiedFiles: files, unrelatedRemoteFilesPreserved: preserved, forced: false, published: false };
await writeFile(`${root}/github-push-proof.json`, JSON.stringify(receipt, null, 2));
console.log(`GITHUB VERIFIED ${commit.sha}; ${files.length} source files verified; ${preserved} unrelated remote files preserved; not published`);
