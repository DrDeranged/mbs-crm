import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve("reports/web-visual-refresh");
const read = name => readFile(resolve(root, name), "utf8");
const json = async name => JSON.parse(await read(name));
const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));
const structure = await json("structural-comparison.json");
const tokens = await json("contrast-tokens.json");
const rendered = await json("contrast-rendered.json");
const targets = await json("touch-targets.json");
const screenshots = [];
for (const phase of ["before", "after"]) {
  for (const file of await readdir(resolve(root, phase))) {
    if (/^(dashboard|leads|lead-detail|pipeline|apply|settings)-(390|768|1280|1440)-(light|dark)\.png$/.test(file)) {
      screenshots.push(`${phase}/${file}`);
    }
  }
}
if (screenshots.length !== 96) throw new Error(`Screenshot matrix incomplete: ${screenshots.length}/96`);
const rows = [];
for (const page of ["dashboard", "leads", "lead-detail", "pipeline", "apply", "settings"]) {
  for (const width of [390, 768, 1280, 1440]) {
    for (const mode of ["light", "dark"]) {
      const figures = [];
      for (const phase of ["before", "after"]) {
        const bytes = await readFile(resolve(root, `${phase}/${page}-${width}-${mode}.png`));
        figures.push(`<figure><figcaption>${phase === "before" ? "Before" : "After"} — ${width}px, ${mode}${phase === "before" && mode === "dark" ? " (existing dark-class styling; no theme provider)" : ""}</figcaption><img loading="lazy" alt="${escape(`${phase} ${page} at ${width}px in ${mode} mode`)}" src="data:image/png;base64,${bytes.toString("base64")}"></figure>`);
      }
      rows.push(`<section class="comparison"><h3>${escape(page)} — ${width}px, ${mode}</h3><div class="pair">${figures.join("")}</div></section>`);
    }
  }
}
const tokenRows = tokens.map(row => `<tr><td>${escape(row.mode)}</td><td>${escape(row.foreground)}</td><td>${escape(row.background)}</td><td>${escape(row.ratio)}</td><td>${escape(row.threshold)}</td><td>${row.passed ? "PASS" : "FAIL"}</td></tr>`).join("");
const structureRows = structure.map(row => `<tr><td>${escape(row.key)}</td><td>${row.beforeCount}</td><td>${row.afterCount}</td><td>${row.passed ? "PASS" : "FAIL"}</td></tr>`).join("");
const index = {
  status: "NOT CERTIFIED — final journey, floating-state, performance and preflight evidence remain required",
  screenshots,
  rawEvidence: [
    "before/controls.json", "after/controls.json", "before/role-controls.json",
    "after/role-controls.json", "after/appearance-controls.json",
    "structural-comparison.json", "contrast-tokens.json", "contrast-rendered.json",
    "touch-targets.json", "before/lighthouse", "after/lighthouse",
    "journeys", "PREFLIGHT_FULL.txt", "PREFLIGHT_TAIL.txt",
  ],
};
await writeFile(resolve(root, "evidence-index.json"), JSON.stringify(index, null, 2));
await writeFile(resolve(root, "EVIDENCE_REPORT.html"), `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>MBS CRM visual refresh — evidence, not final certification</title>
<style>
body{margin:0;background:#f5f7fa;color:#0e2a47;font:16px/1.55 system-ui,sans-serif;font-variant-numeric:tabular-nums}
main{max-width:1400px;margin:auto;padding:32px}h1{font-size:30px}h2{margin-top:48px}
.notice{padding:20px;border:2px solid #9b421b;background:#fff5e9;border-radius:8px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}figure{margin:0;background:#fff;border:1px solid #c5ced9}
figcaption{padding:12px;font-weight:600}img{display:block;width:100%;height:auto}
.comparison{margin:36px 0}table{width:100%;border-collapse:collapse;background:white}
td,th{text-align:left;padding:8px 12px;border:1px solid #c5ced9}thead{background:#e9eef4}
code{overflow-wrap:anywhere}.scroll{overflow:auto}@media(max-width:700px){main{padding:16px}.pair{grid-template-columns:1fr}}
</style><main>
<h1>MBS CRM visual refresh: evidence index</h1>
<div class="notice"><strong>NOT CERTIFIED. Task remains incomplete.</strong>
<p>This report preserves measured evidence, including unsuccessful attempts. It is not a release verdict, final preflight certification or proof of a GitHub push. Nothing has been published.</p></div>
<h2>Scope and evidence boundaries</h2>
<p>Existing desktop/mobile web CRM only. The sole new interactive control is the Settings appearance selector. The logo, Expo app, API contracts, record permissions, migrations and business workflows are outside this refresh.</p>
<p>Protected captures use synthetic records in disposable databases and actual development Clerk sessions. Request-triggered external delivery is blocked and live provider credentials are removed from the fixture API. Mocked loading/error tests are visual-state evidence, not authentication or persistence proof.</p>
<p>The baseline source revision is <code>56a88efe65b17949e1c0057638772f05ebb8f169</code>. Dark baseline images show its existing dark-class styling, not a working theme provider. Its temporary build was lost; a source rebuild is now retained in ignored workspace storage. Benchmark reruns must be identified separately from the original measurements.</p>
<h2>Measured results and remaining limits</h2>
<ul>
<li>Screenshot matrix: ${screenshots.length}/96 captures.</li>
<li>Ordered structural inventories: ${structure.filter(row => row.passed).length}/${structure.length} passing recorded comparisons. Dashboard, Leads, Lead detail, Pipeline, Apply and Settings at 390/768px use matched admin/manager/rep fixtures. The new Settings appearance selector is separately inventoried; other controls are not exempted.</li>
<li>Contrast: ${tokens.length} intended token/composite pair records and ${rendered.length} rendered-page scans. The table below reports the recorded measurements; it does not substitute for uncollected hover, focus, drag or floating-state coverage.</li>
<li>Mobile targets: ${targets.length} recorded scans. Dimensions alone do not prove every overlap, clipping or composite-control state.</li>
<li>Authenticated journey attempts and raw failure contexts are retained under <code>journeys/</code>. A passing public smoke suite is not proof of protected persistence.</li>
<li>Original Lighthouse outputs are retained. The original Lead detail 390px third repeat regressed by 18 points, so the performance requirement is not accepted. Quiet matched reruns remain required.</li>
<li>The recorded eleven-gate preflight transcript ended with PASS and exit 0, but it predates subsequent changes. It is historical evidence, not final-revision certification.</li>
<li>No final GitHub main hash is certified or reported here. Push is deferred until the complete final evidence passes.</li>
</ul>
<h2>Raw evidence index</h2>
<p>All relative paths refer to <code>reports/web-visual-refresh/</code>. The self-contained screenshot images below require no external files.</p>
<ul>${index.rawEvidence.map(file => `<li><code>${escape(file)}</code></li>`).join("")}</ul>
<h2>Ordered structural comparisons</h2><div class="scroll"><table><thead><tr><th>Fixture</th><th>Before</th><th>After</th><th>Result</th></tr></thead><tbody>${structureRows}</tbody></table></div>
<h2>Recorded contrast pairings</h2>
<p>Normal text uses WCAG AA 4.5:1; intended non-text controls, focus indicators and chart distinctions use 3:1. Translucent surfaces are evaluated against their allowed underlying backgrounds. Official logo marks and document/signature paper are distinct from application body surfaces.</p>
<div class="scroll"><table><thead><tr><th>Mode</th><th>Foreground</th><th>Background/composite</th><th>Ratio</th><th>Threshold</th><th>Result</th></tr></thead><tbody>${tokenRows}</tbody></table></div>
<h2>Before/after matrix</h2>${rows.join("")}
</main></html>`);
console.log("Wrote indexed, self-contained evidence report; certification remains explicitly incomplete.");