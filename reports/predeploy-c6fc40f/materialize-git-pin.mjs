import { readFile, readlink, writeFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { ReplitConnectors } from "@replit/connectors-sdk";
const pin = JSON.parse(await readFile("reports/predeploy-c6fc40f/source-pin.json", "utf8"));
const root = pin.root;
function git(args, input) {
  const p = spawnSync("git", ["-C", root, ...args], { input, maxBuffer: 20 * 1024 * 1024 });
  if (p.status) throw new Error(`Temporary git ${args[0]}: ${p.stderr}`);
  return p.stdout.toString().trim();
}
git(["init", "-q"]);
const normal = pin.files.filter(f => f.mode !== "120000");
const hashes = git(["hash-object", "-w", "--stdin-paths"], normal.map(f => `${root}/${f.path}`).join("\n") + "\n").split("\n");
normal.forEach((f, i) => { if (hashes[i] !== f.sha) throw new Error(`Changed source: ${f.path}`); });
for (const f of pin.files.filter(f => f.mode === "120000")) {
  const actual = git(["hash-object", "-w", "--stdin"], await readlink(`${root}/${f.path}`));
  if (actual !== f.sha) throw new Error(`Changed symlink: ${f.path}`);
}
git(["update-index", "--index-info"], pin.files.map(f => `${f.mode} ${f.sha}\t${f.path}`).join("\n") + "\n");
const actualTree = git(["write-tree"]);
if (actualTree !== pin.tree) throw new Error(`Temporary index tree differs: ${actualTree}`);
const c = new ReplitConnectors();
const r = await c.proxy("github", `/repos/DrDeranged/mbs-crm/git/commits/${pin.requestedCommit}`);
if (!r.ok) throw new Error(`Commit metadata: ${r.status}`);
const data = await r.json();
const person = (p, zone) => `${p.name} <${p.email}> ${Math.floor(new Date(p.date).valueOf() / 1000)} ${zone}`;
const zones = ["+0000"];
for (let m = -720; m <= 840; m += 15) {
  if (m === 0) continue;
  zones.push(`${m < 0 ? "-" : "+"}${String(Math.floor(Math.abs(m) / 60)).padStart(2, "0")}${String(Math.abs(m) % 60).padStart(2, "0")}`);
}
let bytes;
// REST normalizes timestamps to UTC; the stored Git object can retain offsets.
for (const authorZone of zones) {
  for (const committerZone of zones) {
    const header = `tree ${data.tree.sha}\n${data.parents.map(p => `parent ${p.sha}\n`).join("")}author ${person(data.author, authorZone)}\ncommitter ${person(data.committer, committerZone)}\n\n`;
    for (const suffix of ["", "\n", "\n\n"]) {
      const candidate = Buffer.from(header + data.message + suffix);
      const sha = createHash("sha1").update(`commit ${candidate.length}\0`).update(candidate).digest("hex");
      if (sha === pin.requestedCommit) { bytes = candidate; break; }
    }
    if (bytes) break;
  }
  if (bytes) break;
}
if (!bytes) throw new Error("Cannot reconstruct exact unsigned GitHub commit; tree remains verified");
const commit = git(["hash-object", "-t", "commit", "-w", "--stdin"], bytes);
git(["update-ref", "refs/heads/main", commit]);
git(["symbolic-ref", "HEAD", "refs/heads/main"]);
await mkdir("reports/predeploy-c6fc40f", { recursive: true });
await writeFile("reports/predeploy-c6fc40f/temporary-git-pin.json", JSON.stringify({
  commit, tree: actualTree, verifiedFiles: pin.files.length,
  productSourceChanges: false, workspaceGitChanges: false,
}, null, 2));
console.log(`Temporary exact Git checkout ready: ${commit}, tree ${actualTree}`);
