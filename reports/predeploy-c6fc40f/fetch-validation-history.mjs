import { ReplitConnectors } from "@replit/connectors-sdk";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
const root = JSON.parse(await readFile("reports/predeploy-c6fc40f/source-pin.json", "utf8")).root;
const api = new ReplitConnectors();
const hash = (kind, bytes) => createHash("sha1").update(`${kind} ${bytes.length}\0`).update(bytes).digest("hex");
function git(args, input) {
  const p = spawnSync("git", ["-C", root, ...args], { input });
  if (p.status) throw new Error(`Temporary git ${args[0]} failed`);
  return p.stdout.toString().trim();
}
await mkdir(`${root}/.git/objects/info`, { recursive: true });
await writeFile(`${root}/.git/objects/info/alternates`, "/home/runner/workspace/.git/objects\n");
async function get(path) {
  const response = await api.proxy("github", `/repos/DrDeranged/mbs-crm/${path}`);
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
}
const zones = ["+0000", "-0400"];
for (let m = -720; m <= 840; m += 15) zones.push(`${m < 0 ? "-" : "+"}${String(Math.floor(Math.abs(m) / 60)).padStart(2, "0")}${String(Math.abs(m) % 60).padStart(2, "0")}`);
function commitBytes(data) {
  const person = (p, zone) => `${p.name} <${p.email}> ${Math.floor(new Date(p.date).valueOf() / 1000)} ${zone}`;
  for (const a of zones) for (const c of zones) for (const suffix of ["", "\n", "\n\n"]) {
    const bytes = Buffer.from(`tree ${data.tree.sha}\n${data.parents.map(p => `parent ${p.sha}\n`).join("")}author ${person(data.author, a)}\ncommitter ${person(data.committer, c)}\n\n${data.message}${suffix}`);
    if (hash("commit", bytes) === data.sha) return bytes;
  }
  if (data.verification?.payload && data.verification?.signature) {
    const signed = data.verification.payload.replace("\n\n", `\ngpgsig ${data.verification.signature.trimEnd().split("\n").join("\n ")}\n\n`);
    if (hash("commit", Buffer.from(signed)) === data.sha) return Buffer.from(signed);
  }
  throw new Error(`Cannot verify historical commit ${data.sha}`);
}
async function ensureTree(sha) {
  if (spawnSync("git", ["-C", root, "cat-file", "-e", sha]).status === 0) return;
  const tree = await get(`git/trees/${sha}`);
  const bytes = Buffer.concat(tree.tree.flatMap(e => [
    Buffer.from(`${e.mode.replace(/^0+/, "")} ${e.path}\0`), Buffer.from(e.sha, "hex"),
  ]));
  if (hash("tree", bytes) !== sha) throw new Error("Historical tree hash mismatch");
  git(["hash-object", "-t", "tree", "-w", "--stdin"], bytes);
  for (const child of tree.tree.filter(e => e.type === "tree")) await ensureTree(child.sha);
}
const queue = ["c6fc40fa76880972ad2d8b1226ef0fb45c5890ca"];
const seen = new Set();
let downloaded = 0;
while (queue.length) {
  const sha = queue.pop();
  if (seen.has(sha)) continue;
  seen.add(sha);
  if (seen.size > 150) throw new Error("History import limit reached");
  const exists = spawnSync("git", ["-C", root, "cat-file", "-e", `${sha}^{commit}`]).status === 0;
  if (exists && sha !== "c6fc40fa76880972ad2d8b1226ef0fb45c5890ca") continue;
  const data = await get(`git/commits/${sha}`);
  if (!exists) {
    git(["hash-object", "-t", "commit", "-w", "--stdin"], commitBytes(data));
    downloaded++;
  }
  if (data.message.startsWith("Restored to ")) {
    await ensureTree(data.tree.sha);
    for (const parent of data.parents) await ensureTree((await get(`git/commits/${parent.sha}`)).tree.sha);
  }
  queue.push(...data.parents.map(p => p.sha));
}
await writeFile("reports/predeploy-c6fc40f/history-pin.json", JSON.stringify({
  requestedCommit: "c6fc40fa76880972ad2d8b1226ef0fb45c5890ca", downloadedVerifiedCommits: downloaded,
  localObjectsReadOnly: true, sourceChanges: false,
}, null, 2));
console.log(`Verified historical commit objects imported: ${downloaded}`);
