import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const root = "reports/desktop-workspace-release";
const escape = value => String(value).replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
const json = async path => JSON.parse(await readFile(path, "utf8"));
async function files(path) {
  const entries = await readdir(path, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(`${path}/${entry.name}`) : [`${path}/${entry.name}`]))).flat();
}
const structure = await json(`${root}/structure-and-screenshots.json`);
const mobile = await json(`${root}/mobile-build-proof.json`);
const chunks = await json(`${root}/chunk-recovery-proof.json`);
const preflight = await readFile(`${root}/preflight.txt`, "utf8");
assert.equal(structure.comparisons.length, 36);
assert.ok(structure.comparisons.every(row => row.controlsEqual && row.exemptionsEqual && row.certifiedInventoryEqual && row.certifiedExemptionsEqual));
assert.deepEqual(structure.newExceptions, []);
assert.deepEqual(structure.errors, []);
assert.equal(structure.targetScreenshots.length, 50);
assert.equal(structure.baselineScreenshots.length, 20);
assert.ok(mobile.passed && chunks.passed);
assert.match(preflight, /\nPREFLIGHT_EXIT_CODE=0\s*$/);
assert.ok(preflight.includes("PREFLIGHT PASS"));
for (let gate = 1; gate <= 11; gate++) assert.ok(preflight.includes(`PREFLIGHT ${gate}/11:`));

// Preserve the actual initial failures and focused continuations. For each
// unchanged test title, report the most recent observed result, not "ever passed."
const events = [];
for (const path of (await files(`${root}/journeys`)).filter(path => !path.includes("test-output"))) {
  if (path.endsWith(".json")) {
    const result = await json(path);
    if (!Array.isArray(result.suites)) continue;
    const walk = suite => {
      for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) for (const run of test.results ?? []) {
        events.push({ title: spec.title, status: run.status, time: Date.parse(run.startTime ?? result.stats.startTime), source: path });
      }
      for (const child of suite.suites ?? []) walk(child);
    };
    for (const suite of result.suites) walk(suite);
  } else if (path.endsWith(".log")) {
    const time = (await stat(path)).mtimeMs;
    for (const line of (await readFile(path, "utf8")).split("\n")) {
      const match = line.match(/^\s*([✓✘])\s+\d+\s+.+? › (.+) \([\d.]+(?:ms|s|m)\)\s*$/);
      if (match) events.push({ title: match[2], status: match[1] === "✓" ? "passed" : "failed", time, source: path });
    }
  }
}
events.sort((a, b) => a.time - b.time);
const latest = new Map(events.map(event => [event.title, event]));
const journeys = [...latest.values()].sort((a, b) => a.title.localeCompare(b.title));
assert.equal(journeys.length, 14, "All fourteen requested browser scenarios must have evidence");
assert.ok(journeys.every(row => row.status === "passed"), JSON.stringify(journeys.filter(row => row.status !== "passed")));
const tail = preflight.trimEnd().split("\n").slice(-28).join("\n");
const summary = {
  verdict: "PASS — requested desktop workspace and release proof; not published",
  mobileComparisons: "36/36, both fresh matched baseline and exact certified inventory/exempt controls",
  screenshots: { target: 50, matchedMobileBaseline: 20 },
  journeys, chunkRecovery: chunks, mobileBuild: mobile,
  preflight: { gates: 11, exitCode: 0, transcript: "preflight.txt", sha256: createHash("sha256").update(preflight).digest("hex"), actualTail: tail },
  scope: {
    authentication: "Real development Clerk session obtained by ticket; no password/SSO certification",
    telephony: "Idle softphone UI and desktop/mobile OS handoff without a registered device; available-device action policy unit-tested. No carrier call or native dialer invoked.",
    safety: "Disposable schema-only browser fixture clones, synthetic records, provider credentials stripped, local storage bytes verified; external delivery blocked",
    deployment: "No publishing, live deployment configuration changes or production writes",
    migrations: "No application schema changes or migrations added/applied; existing preflight rehearsal uses disposable clones",
  },
};
await writeFile(`${root}/release-summary.json`, JSON.stringify(summary, null, 2));
await writeFile(`${root}/preflight-tail.txt`, tail + "\n");
const markdown = `# Desktop workspace release proof\n\n**Verdict: PASS; not published.**\n\n- Strict mobile comparisons: **36/36**, no new exceptions; retained certified revision ${structure.baselineRevision}.\n- Screenshots: **50 target + 20 matched mobile baseline** at 390/768/1024/1280/1440, Light and Dark.\n- Requested browser scenarios: **14/14 latest results passed**, with original failures and focused corrections retained.\n- Mobile iOS and Android manifests and compiled API literals: **https://app.my-business-solutions.com**; obsolete host absent. SHA-256 evidence: mobile-build-proof.json.\n- Actual production lazy chunk aborted: **one reload recovers**, repeat same-build failure adds **zero reloads**; new-build/non-chunk policy unit-tested.\n- Full **11-gate preflight PASS**, actual exit **0**. Complete authoritative transcript: preflight.txt.\n\n## Scope and limits\n${Object.values(summary.scope).map(value => `- ${value}`).join("\n")}\n\n## Browser evidence\n${journeys.map(row => `- **PASS** ${row.title} — ${row.source}`).join("\n")}\n\n## Actual final preflight tail\n\n\`\`\`text\n${tail}\n\`\`\`\n\n## Reproduce\n\n- Build API/web from these source files with production NODE_ENV and BASE_PATH=/.\n- Run pnpm exec playwright test --config playwright.desktop-workspace.config.ts --grep 'journey:|desktop:' using development Clerk and disposable fixtures. Never enable live delivery.\n- Run node scripts/desktop-workspace/capture.mjs; retained baseline directory is .local/certification-2af927c/baselines/target-2af927c. --baseline-only / --target-only reuse the opposite evidence phase.\n- Run node scripts/desktop-workspace/chunk-proof.mjs.\n- For a fresh iOS/Android export, use a free METRO_PORT and EXPO_PUBLIC_DOMAIN=app.my-business-solutions.com, run the mobile build, then node scripts/desktop-workspace/mobile-proof.mjs.\n- Run pnpm preflight, retain its full transcript and actual exit status, then node scripts/desktop-workspace/report.mjs.\n\nGitHub push receipt is generated after the commit and verified separately to avoid a self-referential commit hash. Source and evidence blob hashes are checked against the returned remote tree.\n`;
await writeFile(`${root}/README.md`, markdown);
const figure = async (phase, file) => `<figure><img loading="lazy" src="data:image/png;base64,${(await readFile(`${root}/${phase}/${file}`)).toString("base64")}" alt="${escape(`${phase}: ${file}`)}"><figcaption>${escape(file)}</figcaption></figure>`;
const targetGallery = (await Promise.all(structure.targetScreenshots.map(file => figure("target", file)))).join("");
const baselineGallery = (await Promise.all(structure.baselineScreenshots.map(file => figure("baseline", file)))).join("");
let push = null;
try { push = await json(`${root}/github-push-proof.json`); } catch (error) { if (error.code !== "ENOENT") throw error; }
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MBS CRM desktop workspace release proof</title><style>body{margin:0;background:#f4f7fa;color:#132c41;font:15px/1.6 system-ui,sans-serif}main{max-width:1400px;margin:auto;padding:36px}h1{font-size:32px;line-height:1.2}.status{color:#176f42;font-weight:700}.metrics{display:flex;gap:18px;flex-wrap:wrap}.metric,section{background:white;border:1px solid #dce4eb;border-radius:10px;padding:20px;margin:16px 0}.metric strong{display:block;font-size:28px}.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}figure{margin:0}img{width:100%;height:auto;border:1px solid #dae3eb;border-radius:6px}figcaption{font:12px/1.5 ui-monospace,monospace;overflow-wrap:anywhere}pre{background:#f3f6f9;padding:18px;overflow:auto;max-height:560px;font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;font-size:13px}td,th{text-align:left;padding:9px;border-bottom:1px solid #e1e8ee}small{overflow-wrap:anywhere}summary{cursor:pointer;font-weight:650}@media(max-width:600px){main{padding:16px}.gallery{grid-template-columns:1fr}td,th{padding:6px}}</style><main><p>MBS CRM · RELEASE EVIDENCE</p><h1>Desktop workspace and release proof</h1><p class="status">PASS — verified source and evidence; not published</p><div class="metrics"><div class="metric"><strong>36/36</strong>Exact mobile comparisons</div><div class="metric"><strong>50 + 20</strong>Target and baseline screenshots</div><div class="metric"><strong>14/14</strong>Latest browser scenario results</div><div class="metric"><strong>11/11</strong>Preflight gates · exit 0</div></div><section><h2>What changed</h2><p>Unsaved appearance defaults to Light. Desktop uses a 56px rail, delayed hover overlay, account-scoped pin and keyboard toggle. The existing palette searches authorized records and directories. Deals uses nine equal columns with wrapped card values. Wide Lead detail has independently scrollable content and activity panes without duplicate timelines. iOS/Android production exports use the requested custom domain.</p><p>Browser-discovered duplicate Search, correlated search-query aliases and a wide sticky summary overlap were fixed before the final focused checks. Original failing results remain in the evidence folder; the table below identifies each latest result source.</p><ul>${Object.values(summary.scope).map(value => `<li>${escape(value)}</li>`).join("")}</ul>${push ? `<p><strong>Verified GitHub main:</strong> <code>${escape(push.remoteCommit)}</code><br><small>${escape(push.commitUrl)}</small></p>` : "<p>GitHub receipt is attached after the source/evidence commit is verified.</p>"}</section><section><h2>Browser scenario verdicts</h2><table><tr><th>Result</th><th>Scenario</th><th>Actual evidence</th></tr>${journeys.map(row => `<tr><td class="status">PASS</td><td>${escape(row.title)}</td><td><small>${escape(row.source)}</small></td></tr>`).join("")}</table></section><section><h2>Actual final preflight tail</h2><pre>${escape(tail)}</pre><details><summary>Complete authoritative eleven-gate preflight transcript</summary><pre>${escape(preflight)}</pre></details></section><section><h2>Compiled mobile API-host evidence</h2><pre>${escape(JSON.stringify(mobile, null, 2))}</pre><h2>Genuine built-preview chunk recovery</h2><pre>${escape(JSON.stringify(chunks, null, 2))}</pre></section><section><details open><summary>50 target screenshots · five pages, five widths, Light and Dark</summary><div class="gallery">${targetGallery}</div></details></section><section><details><summary>20 matched certified-baseline mobile screenshots</summary><p>Retained revision ${escape(structure.baselineRevision)}. Both ordinary and previously exempt application controls compare exactly; no new exceptions.</p><div class="gallery">${baselineGallery}</div></details></section><section><details><summary>Strict structural results and reproduction</summary><pre>${escape(JSON.stringify(structure, null, 2))}</pre><pre>${escape(markdown)}</pre></details></section></main></html>`;
await writeFile(`${root}/release-report.html`, html);
console.log(`RELEASE REPORT PASS — ${journeys.length} browser scenarios, full preflight, 70 inline screenshots`);