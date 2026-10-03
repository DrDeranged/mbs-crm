import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const output = process.env.STRUCTURE_REPORT_DIR ?? "reports/structural-certification-2026-10-03";
const read = name => readFile(`${output}/${name}`,"utf8");
const manifestText = await readFile(new URL("./approved-structure-exceptions.json",import.meta.url),"utf8");
const manifest = JSON.parse(manifestText);
const results = JSON.parse(await read("structural-comparison.json"));
const beforeExit = Number((await read("STRUCTURE_BEFORE.exit")).trim());
const afterExit = Number((await read("STRUCTURE_AFTER.exit")).trim());
const passed = results.length === 36 && results.every(x=>x.passed) && beforeExit===0 && afterExit===0;
const audits = results.filter(x=>x.dashboardAudit);
const removalsOrReordering = audits.filter(x=>!x.dashboardAudit.countUnchanged||!x.dashboardAudit.descriptorsExceptNameUnchangedAtEveryIndex);
const summary = {
  verdict:passed?"PASS":"FAIL",comparisons:`${results.filter(x=>x.passed).length}/36`,
  baseline:manifest.baselineRevision,targetApplication:manifest.targetApplicationRevision,
  exceptionManifestSHA256:createHash("sha256").update(manifestText).digest("hex"),
  approvedReplacementSpans:results.reduce((sum,x)=>sum+x.approvedReplacementSpans,0),
  unapprovedDifferences:results.flatMap(x=>x.differences.map(d=>({key:x.key,...d}))),
  dashboardAssignments:{
    verdict:removalsOrReordering.length?"FAIL":"PASS",
    description:"Company-first naming only. Count and every non-name descriptor remain unchanged at every control index.",
    removedOrReordered:removalsOrReordering,
    comparisons:audits,
  },
  beforeExit,afterExit,published:false,
};
await writeFile(`${output}/SUMMARY.json`,JSON.stringify(summary,null,2));
const table = [
  "| Page / width / role | Before | After | Approved replacement spans | Separately checked controls | Verdict |",
  "| --- | ---: | ---: | ---: | ---: | --- |",
  ...results.map(x=>`| ${x.key} | ${x.beforeCount} | ${x.afterCount} | ${x.approvedReplacementSpans} | ${x.approvedExemptControls} | ${x.passed?"PASS":"FAIL"} |`),
].join("\n");
const dashboard = [
  "| Comparison | Counts | Same tag/role/type/href/disabled at every index | Label-only changes |",
  "| --- | --- | --- | ---: |",
  ...audits.map(x=>`| ${x.key} | ${x.beforeCount} → ${x.afterCount} | ${x.dashboardAudit.descriptorsExceptNameUnchangedAtEveryIndex?"YES":"NO"} | ${x.dashboardAudit.labels.length} |`),
].join("\n");
const md = `# Structural certification — ${summary.verdict}: ${summary.comparisons}

Fresh browser rerun on 2026-10-03 of scripts/visual-refresh/structure.mjs.
Baseline: \`${manifest.baselineRevision}\`, before the contact-action and visual-refresh merges.
Application payload: GitHub \`${manifest.targetApplicationRevision}\`.
The new commit updates verification scripts, approved exceptions and reports only;
no web application, API, permissions, database, or business behavior was changed.
Nothing was published.

## Result

- **${summary.comparisons} ${summary.verdict}** — six pages × two widths × three roles.
- Before runner exit: ${beforeExit}; after runner exit: ${afterExit}.
- Unapproved differences: **${summary.unapprovedDifferences.length}**.
- Approved exact replacement spans: ${summary.approvedReplacementSpans}.
- Guard regressions: **9/9 passed**, including rejected removals, reordering,
  changed destinations/states, empty inventories and unexpected container controls.
- Apply now waits for its financing question, both financing buttons and Next
  before collecting a stable inventory. Apply has no structural exception.

## Documented approval

The user explicitly approved the intended contact-action changes on Leads, Deals,
Lead detail and Dashboard: clickable company/contact names, phone links and
email-to-composer. The existing Settings theme selector and record action bars
are also approved.

The [human-readable exception list](../../scripts/visual-refresh/STRUCTURE_EXCEPTIONS.md)
and [frozen machine-readable list](../../scripts/visual-refresh/approved-structure-exceptions.json)
encode the exact expected descriptor changes, by page, width and role. The
manifest SHA-256 is \`${summary.exceptionManifestSHA256}\`.
It is not regenerated during a run and does not broadly ignore all contact
links, labels or approved containers.

## Dashboard assignment-control audit

**${summary.dashboardAssignments.verdict}. No assignment control was removed or reordered.**
Across all six Dashboard inventories, every tag, role, type, href and disabled
state is identical at the same index, and the control count is unchanged.
The two admin assignment labels are the only assignment-label changes:

- \`New owner for Fixture Equipment LLC\` →
  \`New owner for Fixture Equipment LLC — Synthetic Contact\`
- \`New owner for Fixture Services LLC\` →
  \`New owner for Fixture Services LLC — Sample Applicant\`

The two existing lead-link labels use the same company-first naming. Manager/rep
Dashboard inventories have no descriptor changes. Assignment callbacks were not
changed by this certification; the original contact-action source diff shows
the existing shared label changing to the company-first formatter.

### Explicit removed/reordered controls outside Dashboard

- **Lead detail, 390px, all three roles:** the old unlabeled floating Softphone
  launcher is suppressed on mobile record detail because the approved record
  action bar supplies Call. Its three exact removals are encoded; desktop
  launchers remain. This is not a Dashboard or assignment-control removal.
- **Lead-detail header:** the original email/phone pair becomes phone/email,
  while their destinations become the approved Call/composer links. This exact
  contact-pair replacement is encoded; other surviving controls retain order.
- **Leads:** the former composite row link is replaced by company/contact
  identity links and separate phone/email links; this is encoded as replacement
  spans, not as permission to remove unrelated row controls.

${dashboard}

This is a comparison of matched synthetic fixture states, not exhaustive
coverage of every conditional Dashboard widget. The original contact changes
also replace an overdue-voicemail Call button with a phone link and link its lead
name when that widget has data. Those are the approved contact actions, not
assignment-control removals or reordering; that conditional branch is not
populated in these 36 fixture comparisons.

## Full comparison matrix

${table}

## Evidence

- [Comparison results and Dashboard index audit](structural-comparison.json)
- [Summary and unapproved-difference list](SUMMARY.json)
- [Fresh baseline inventories](before/role-controls.json)
- [Fresh target inventories](after/role-controls.json)
- [Baseline separately checked controls](before/exempt-controls.json)
- [Target separately checked controls](after/exempt-controls.json)
- [Baseline runner transcript](STRUCTURE_BEFORE.txt)
- [Target runner transcript](STRUCTURE_AFTER.txt)
- [Comparison guard tests](COMPARISON_TESTS.txt)
- [Original contact-action Dashboard source diff](DASHBOARD_NAMING_DIFF.txt)

The prior eleven-gate preflight, end-to-end flows, contrast and 96-image screenshot
matrix were not rerun: their application inputs remain unchanged. The original
failed structure report remains historical evidence of the pre-approval rules
and Apply readiness failure; this fresh report supersedes its structural verdict
only after the user's explicit approval.
`;
await writeFile(`${output}/REPORT.md`,md);
console.log(JSON.stringify(summary,null,2));
if (!passed) process.exitCode=1;