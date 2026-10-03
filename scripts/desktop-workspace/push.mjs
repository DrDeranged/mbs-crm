import { ReplitConnectors } from "@replit/connectors-sdk";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

const repo = "DrDeranged/mbs-crm";
const root = "reports/desktop-workspace-release";
const connectors = new ReplitConnectors();
async function github(method, path, body) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await connectors.proxy("github", `/${path}`, {
      method, headers: { "Content-Type": "application/json", Accept: "application/vnd.github+json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.ok) return response.json();
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 3) {
      throw new Error(`GitHub ${method} ${path}: HTTP ${response.status}`);
    }
    console.log(`GitHub transient HTTP ${response.status}; bounded retry ${attempt + 1}/3`);
    await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
  }
}
const sources = [
  ".agents/memory/MEMORY.md", ".agents/memory/web-visual-scope.md", ".agents/memory/visual-baseline-html-polls.md",
  "artifacts/api-server/src/routes/leads.ts", "artifacts/api-server/src/routes/deals.ts", "artifacts/api-server/src/lib/leadsRoute.test.ts",
  "artifacts/mbs-crm-mobile/package.json", "artifacts/mbs-crm-mobile/scripts/build.js",
  "artifacts/mbs-crm-mobile/scripts/deployment-domain.cjs", "artifacts/mbs-crm-mobile/scripts/deployment-domain.test.cjs",
  "artifacts/mbs-crm/src/components/app-shell.tsx", "artifacts/mbs-crm/src/components/appearance-provider.tsx",
  "artifacts/mbs-crm/src/components/command-palette.tsx", "artifacts/mbs-crm/src/components/desktop-sidebar.tsx",
  "artifacts/mbs-crm/src/hooks/use-desktop-sidebar.ts", "artifacts/mbs-crm/src/styles/desktop-workspace.css",
  "artifacts/mbs-crm/src/index.css", "artifacts/mbs-crm/src/main.tsx", "artifacts/mbs-crm/src/lib/appearance.ts",
  "artifacts/mbs-crm/src/lib/appearance.test.ts", "artifacts/mbs-crm/src/pages/deals.tsx",
  "artifacts/mbs-crm/src/pages/lead-detail.tsx", "artifacts/mbs-crm/src/pages/lead-detail/header.tsx",
  "artifacts/mbs-crm/src/pages/lender-management.tsx",
  "lib/api-spec/openapi.yaml", "lib/api-client-react/src/generated/api.schemas.ts", "lib/api-zod/src/generated/api.ts",
  "tests/desktop-workspace.spec.ts", "tests/web-visual-refresh.spec.ts", "playwright.desktop-workspace.config.ts",
  // Retain the reusable isolation/readiness helpers needed to reproduce the
  // collected proof. No structural exception manifest is included or expanded.
  "scripts/visual-refresh/sandbox.mjs", "scripts/visual-refresh/readiness.mjs",
];
async function files(path) {
  return (await Promise.all((await readdir(path, { withFileTypes: true })).map(entry =>
    entry.isDirectory() ? files(`${path}/${entry.name}`) : [`${path}/${entry.name}`]))).flat();
}
const paths = [...new Set([
  ...sources,
  ...(await files("scripts/desktop-workspace")),
  ...(await files(root)).filter(path => /\.(?:md|json|txt|log|png)$/.test(path) && !path.includes("github-push-proof")),
])].sort();
// Trace ZIPs contain authentication headers/cookies. They are deliberately not
// uploaded; original verdicts, logs, screenshots and error contexts are enough.
assert.ok(paths.every(path => !path.endsWith(".zip") && !path.includes(".env")));
const summary = JSON.parse(await readFile(`${root}/release-summary.json`, "utf8"));
assert.ok(summary.journeys.every(row => row.status === "passed"));
assert.equal(summary.preflight.exitCode, 0);
const ref = await github("GET", `repos/${repo}/git/refs/heads/main`);
const previousCommit = ref.object.sha;
const parent = await github("GET", `repos/${repo}/git/commits/${previousCommit}`);
const before = await github("GET", `repos/${repo}/git/trees/${parent.tree.sha}?recursive=1`);
assert.equal(before.truncated, false);
const oldFiles = new Map(before.tree.filter(entry => entry.type === "blob").map(entry => [entry.path, entry]));
const entries = [];
const evidence = [];
// Serialize the remote branch update; only blob uploads are parallel.
const pending = [...paths];
await Promise.all(Array.from({ length: 1 }, async () => {
  while (pending.length) {
    const path = pending.shift();
    console.log(`GitHub checking ${path}`);
    const bytes = await readFile(path);
    const sha = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    evidence.push({ path, blob: sha, sha256, bytes: bytes.length });
    if (oldFiles.get(path)?.sha === sha) continue;
    const blob = await github("POST", `repos/${repo}/git/blobs`, { content: bytes.toString("base64"), encoding: "base64" });
    assert.equal(blob.sha, sha);
    entries.push({ path, mode: oldFiles.get(path)?.mode ?? "100644", type: "blob", sha });
  }
}));
assert.ok(entries.length > 0, "Nothing intentional changed; do not invent a commit");
const tree = await github("POST", `repos/${repo}/git/trees`, { base_tree: parent.tree.sha, tree: entries });
const commit = await github("POST", `repos/${repo}/git/commits`, {
  message: "Reclaim desktop workspace and verify release readiness\n\nLight default; desktop rail/hover/pin and authorized palette; equal Deals columns and wide independent Lead panes; native production-host proof; genuine bounded chunk recovery; strict 36 mobile comparisons, 70 screenshots, passing browser cases and complete eleven-gate preflight. No publish or application migrations.",
  tree: tree.sha, parents: [previousCommit],
});
const latest = await github("GET", `repos/${repo}/git/refs/heads/main`);
assert.equal(latest.object.sha, previousCommit, "Remote main changed; stop rather than overwrite concurrent work");
await github("PATCH", `repos/${repo}/git/refs/heads/main`, { sha: commit.sha, force: false });
const verified = await github("GET", `repos/${repo}/git/refs/heads/main`);
assert.equal(verified.object.sha, commit.sha);
const after = await github("GET", `repos/${repo}/git/trees/${tree.sha}?recursive=1`);
assert.equal(after.truncated, false);
const remoteFiles = new Map(after.tree.filter(entry => entry.type === "blob").map(entry => [entry.path, entry]));
for (const file of evidence) assert.equal(remoteFiles.get(file.path)?.sha, file.blob, `Wrong remote bytes: ${file.path}`);
const intended = new Set(paths);
const preserved = [...oldFiles.keys()].filter(path => !intended.has(path));
for (const path of preserved) assert.equal(remoteFiles.get(path)?.sha, oldFiles.get(path).sha, `Unrelated remote file changed: ${path}`);
assert.deepEqual(
  [...remoteFiles.keys()].filter(path => remoteFiles.get(path).sha !== oldFiles.get(path)?.sha).sort(),
  entries.map(entry => entry.path).sort(),
);
const receipt = {
  passed: true, repository: repo, branch: "main", previousCommit, remoteCommit: commit.sha,
  commitUrl: `https://github.com/${repo}/commit/${commit.sha}`, tree: tree.sha,
  changedPaths: entries.map(entry => entry.path).sort(), verifiedFiles: evidence.sort((a, b) => a.path.localeCompare(b.path)),
  unrelatedRemoteFilesPreserved: preserved.length, force: false, published: false,
  receiptNote: "Generated after commit verification; omitted from its own commit to avoid a self-referential hash",
};
await writeFile(`${root}/github-push-proof.json`, JSON.stringify(receipt, null, 2));
console.log(`GITHUB VERIFIED ${commit.sha} — ${entries.length} intentional changed paths; ${preserved.length} unrelated remote files unchanged`);