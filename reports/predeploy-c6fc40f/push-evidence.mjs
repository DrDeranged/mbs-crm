import { ReplitConnectors } from "@replit/connectors-sdk";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const prefix = "reports/predeploy-c6fc40f/";
const exportRoot = "/tmp/predeploy-c6fc40f-evidence-export/";
const manifest = JSON.parse(await readFile(`${exportRoot}upload-manifest.json`, "utf8"));
const client = new ReplitConnectors();
async function api(path, method = "GET", body) {
  const response = await client.proxy("github", `/repos/DrDeranged/mbs-crm/${path}`, {
    method, ...(body ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}),
  });
  if (!response.ok) throw new Error(`GitHub ${method} ${path}: ${response.status}`);
  return response.json();
}
const uploaded = [];
let next = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < manifest.files.length) {
    const record = manifest.files[next++];
    if (!record.path.startsWith(prefix)) throw new Error("Evidence path escaped report prefix");
    const bytes = await readFile(exportRoot + record.path.slice(prefix.length));
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== record.sha256) throw new Error(`Export changed: ${record.path}`);
    const blob = await api("git/blobs", "POST", { content: bytes.toString("base64"), encoding: "base64" });
    uploaded.push({ path: record.path, mode: "100644", type: "blob", sha: blob.sha });
  }
}));
const ref = await api("git/ref/heads/main");
const parent = ref.object.sha;
const oldCommit = await api(`git/commits/${parent}`);
const before = await api(`git/trees/${oldCommit.tree.sha}?recursive=1`);
if (before.truncated) throw new Error("Cannot verify truncated remote tree");
const tree = await api("git/trees", "POST", { base_tree: oldCommit.tree.sha, tree: uploaded });
const after = await api(`git/trees/${tree.sha}?recursive=1`);
if (after.truncated) throw new Error("Cannot verify truncated evidence tree");
const afterMap = new Map(after.tree.map(e => [e.path, e]));
for (const entry of before.tree.filter(e => e.type !== "tree" && !e.path.startsWith(prefix))) {
  const actual = afterMap.get(entry.path);
  if (!actual || actual.sha !== entry.sha || actual.mode !== entry.mode) throw new Error(`Non-report change: ${entry.path}`);
}
for (const entry of after.tree.filter(e => e.type !== "tree" && !e.path.startsWith(prefix))) {
  if (!before.tree.some(e => e.path === entry.path && e.sha === entry.sha && e.mode === entry.mode)) {
    throw new Error(`Unexpected non-report addition: ${entry.path}`);
  }
}
const commit = await api("git/commits", "POST", {
  message: "Record pre-deploy validation evidence for c6fc40f; no product changes or publishing",
  tree: tree.sha, parents: [parent],
});
const latest = await api("git/ref/heads/main");
if (latest.object.sha !== parent) throw new Error("Remote main moved; refusing a raced update");
await api("git/refs/heads/main", "PATCH", { sha: commit.sha, force: false });
const verified = await api("git/ref/heads/main");
if (verified.object.sha !== commit.sha) throw new Error("Remote evidence commit verification failed");
const receipt = {
  sourceCommit: "c6fc40fa76880972ad2d8b1226ef0fb45c5890ca",
  parent, evidenceCommit: commit.sha, evidenceTree: tree.sha,
  uploadedFiles: uploaded.length, allNonReportPathsPreserved: true,
  published: false, force: false,
};
await writeFile(`${prefix}github-push-receipt.json`, JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt, null, 2));
