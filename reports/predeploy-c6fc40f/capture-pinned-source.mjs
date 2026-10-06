import { ReplitConnectors } from "@replit/connectors-sdk";
import { mkdir, writeFile, symlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";

const commit = "c6fc40fa76880972ad2d8b1226ef0fb45c5890ca";
const root = resolve(".local/predeploy-c6fc40f-source");
const evidence = resolve("reports/predeploy-c6fc40f");
const client = new ReplitConnectors();
async function get(path) {
  const response = await client.proxy("github", `/repos/DrDeranged/mbs-crm/${path}`);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}
const head = await get("git/refs/heads/main");
const pinned = await get(`git/commits/${commit}`);
const tree = await get(`git/trees/${pinned.tree.sha}?recursive=1`);
if (tree.truncated) throw new Error("Truncated GitHub tree");
const blobs = tree.tree.filter(item => item.type === "blob");
const result = spawnSync("git", ["cat-file", "--batch"], {
  input: blobs.map(item => item.sha).join("\n") + "\n",
  maxBuffer: 200 * 1024 * 1024,
});
if (result.status) throw new Error("Local Git blob read failed");
let cursor = 0;
let downloads = 0;
await mkdir(root, { recursive: true });
for (const item of blobs) {
  const end = result.stdout.indexOf(10, cursor);
  const header = result.stdout.subarray(cursor, end).toString();
  cursor = end + 1;
  let bytes;
  if (header.endsWith(" missing")) {
    const blob = await get(`git/blobs/${item.sha}`);
    if (blob.encoding !== "base64") throw new Error(`Unexpected encoding: ${item.path}`);
    bytes = Buffer.from(blob.content, "base64");
    downloads++;
  } else {
    const length = Number(header.split(" ")[2]);
    bytes = result.stdout.subarray(cursor, cursor + length);
    cursor += length + 1;
  }
  const hash = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  if (hash !== item.sha) throw new Error(`Blob mismatch: ${item.path}`);
  const destination = resolve(root, item.path);
  if (!destination.startsWith(root + "/")) throw new Error("Unsafe tree path");
  await mkdir(dirname(destination), { recursive: true });
  if (item.mode === "120000") await symlink(bytes.toString(), destination);
  else await writeFile(destination, bytes, { mode: item.mode === "100755" ? 0o755 : 0o644 });
}
await mkdir(evidence, { recursive: true });
await writeFile(`${evidence}/source-pin.json`, JSON.stringify({
  requestedCommit: commit, observedMain: head.object.sha, tree: pinned.tree.sha,
  root, verifiedBlobCount: blobs.length, downloadedMissingBlobs: downloads,
  files: blobs.map(({ path, sha, mode }) => ({ path, sha, mode })),
}, null, 2));
console.log(JSON.stringify({ root, commit, observedMain: head.object.sha, verifiedBlobCount: blobs.length, downloads }));
