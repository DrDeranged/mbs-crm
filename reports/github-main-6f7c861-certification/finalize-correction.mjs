import { readFile, writeFile } from "node:fs/promises";
const dir="reports/github-main-6f7c861-certification/";
const initial=JSON.parse(await readFile(`${dir}initial-browser-pass/mobile-comparisons.json`,"utf8"));
const clockCapture=JSON.parse(await readFile(`${dir}mobile-clock-recheck.json`,"utf8"));
const targetKeys=[390,768].flatMap(width=>["admin","manager","rep"].map(role=>`leads-${width}-${role}`));
const fresh=Object.fromEntries(clockCapture.captured.map(row=>[`${row.phase}:${row.key}`,row]));
for(const key of targetKeys){
  for(const phase of ["target","baseline"]){
    const captured=fresh[`${phase}:${key}`];
    const replacement={phase,key,controls:captured.controls,exemptions:captured.exemptions};
    const index=initial.mobileInventories.findIndex(row=>row.phase===phase&&row.key===key);
    if(index===-1)initial.mobileInventories.push(replacement);
    else initial.mobileInventories[index]=replacement;
  }
}
const certified=JSON.parse(await readFile("reports/structural-certification-2026-10-03/after/role-controls.json","utf8"));
const exempt=JSON.parse(await readFile("reports/structural-certification-2026-10-03/after/exempt-controls.json","utf8"));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const diff=(a,b)=>(a||[]).flatMap((value,index)=>same(value,b?.[index])?[]:[{index,actual:value,expected:b?.[index]}]);
const capturedByKey=Object.fromEntries(initial.mobileInventories.map(row=>[`${row.phase}:${row.key}`,row]));
for(const comparison of initial.comparisons){
  if(!targetKeys.includes(comparison.key))continue;
  const target=capturedByKey[`target:${comparison.key}`],baseline=capturedByKey[`baseline:${comparison.key}`];
  comparison.controlsEqual=same(target.controls,baseline.controls);
  comparison.exemptionsEqual=same(target.exemptions,baseline.exemptions);
  comparison.certifiedInventoryEqual=same(target.controls,certified[comparison.key]);
  comparison.certifiedExemptionsEqual=same(target.exemptions,exempt[comparison.key]);
  comparison.differences={
    baselineControls:!comparison.controlsEqual,baselineExemptions:!comparison.exemptionsEqual,
    certifiedControls:!comparison.certifiedInventoryEqual,certifiedExemptions:!comparison.certifiedExemptionsEqual,
  };
  comparison.differenceDetails={
    freshBaselineControls:diff(target.controls,baseline.controls),
    freshBaselineExemptions:diff(target.exemptions,baseline.exemptions),
    certifiedControls:diff(target.controls,certified[comparison.key]),
    certifiedExemptions:diff(target.exemptions,exempt[comparison.key]),
  };
}
initial.clockCorrection={
  fixedTime:clockCapture.fixedTime,loginCompletedBeforeFix:true,replacedLeadKeys:targetKeys,
  baselineAndTargetRecords:clockCapture.captured.length,
  untouchedInitialComparisonKeys:initial.comparisons.filter(row=>!targetKeys.includes(row.key)).map(row=>row.key),
  unchangedFromInitialPass:true,normalization:"none",
};
initial.finalStructuralPass=initial.comparisons.length===36&&initial.comparisons.every(row=>
  row.controlsEqual&&row.exemptionsEqual&&row.certifiedInventoryEqual&&row.certifiedExemptionsEqual);
initial.certifiedDifferenceSummary="Six recaptured Leads keys still differ from certified inventory in idle-distance text only. Target and retained baseline match. No text normalization was applied; the other 30 comparison objects remain the initial measurements.";
await writeFile(`${dir}mobile-comparisons.json`,JSON.stringify(initial,null,2));

const originalGeometry=JSON.parse(await readFile(`${dir}initial-browser-pass/table-geometry.json`,"utf8"));
const leads=originalGeometry.geometry.filter(row=>row.page==="leads");
for(const row of leads)row.screenshot=`screenshots/leads-${row.width}-${row.sidebar}.png`;
const correction=JSON.parse(await readFile(`${dir}correction-diagnostics/overbroad-correction-attempt.json`,"utf8"));
const deals=correction.deals.map(row=>({...row}));
const leadShots=originalGeometry.screenshots.filter(name=>name.startsWith("screenshots/leads-"));
const dealShots=deals.map(row=>row.screenshot);
await writeFile(`${dir}table-geometry.json`,JSON.stringify({
  fixtureData:"Disposable synthetic fixture; Deals UI Table view explicitly selected and verified.",
  geometry:[...leads,...deals],screenshots:[...leadShots,...dealShots],
  correctedDealsTableView:true,removedInvalidInitialDealsGeometry:true,
},null,2));

const failed=initial.comparisons.filter(row=>!row.controlsEqual||!row.exemptionsEqual||!row.certifiedInventoryEqual||!row.certifiedExemptionsEqual);
const summary={
  fixedTime:clockCapture.fixedTime,captureScope:"Only /leads at 390px and 768px for admin, manager and rep, target plus retained baseline.",
  captureCount:clockCapture.captured.length,loginBeforeClock:true,
  clockObserved:clockCapture.captured.every(row=>row.clock===clockCapture.fixedTime),
  missingBaselineAssets:clockCapture.missingBaselineAssets,renderErrors:clockCapture.renderErrors,
  finalLeadKeys:targetKeys.map(key=>{
    const comparison=initial.comparisons.find(row=>row.key===key);
    return {key,targetEqualsFreshBaseline:comparison.controlsEqual&&comparison.exemptionsEqual,
      controlsEqualCertified:comparison.certifiedInventoryEqual,exemptionsEqualCertified:comparison.certifiedExemptionsEqual,
      differences:comparison.differenceDetails.certifiedControls.map(item=>({index:item.index,target:item.actual?.name,certified:item.expected?.name}))};
  }),
  dealsTableCorrection:{
    screenshots:dealShots,
    allVisibleRowsSynthetic:deals.every(row=>row.table.visible&&row.table.rowCount>0&&row.table.containsSynthetic),
    geometry:deals.map(row=>({width:row.width,sidebar:row.sidebar,horizontalScrolling:row.horizontalScrolling,containedToTable:row.scrollContainedToTable,wholePage:row.scrollWholePage})),
  },
  originalEvidenceArchive:"initial-browser-pass/",
  supersededHarnessAttempt:"correction-diagnostics/",
};
await writeFile(`${dir}corrective-pass.json`,JSON.stringify(summary,null,2));
const verdict=[
  "# GitHub main 6f7c861 browser certification — corrected evidence","",
  "Commit proof: 6f7c8611ed4087a14e62ff99a0f5dbb5f3b33835; 963 committed files matched; published: false. Target: .local/certification-6f7c861/target. Frozen baseline: .local/certification-2af927c/baselines/target-2af927c.","",
  "- **Strict mobile comparisons: FAIL — "+(36-failed.length)+"/36 exact.** Final mobile-comparisons.json preserves the original 30 measured comparison objects unchanged and replaces only six Leads keys from target and retained-baseline captures at 2026-10-03T18:00:00.000Z. Clock was set after login and observed at that exact time. Target and baseline match on all six; certified inventory still differs at two idle-label positions per key (target “19d idle”, certified “18d idle”). No normalization or exemptions were added. Exact diffs are recorded in mobile-comparisons.json; fixed-clock evidence is in mobile-clock-recheck.json.","",
  "- **Deals geometry corrected:** each of four captures explicitly selects the UI Table button and asserts visible table.deals-data-table, two body rows and synthetic fixture text before measuring. At 1280 and 1366, collapsed and pinned: horizontal scrolling yes, contained within table; whole page no horizontal overflow. Original valid Leads captures and geometry are retained. Corrected screenshots: "+dealShots.join(", ")+".","",
  "- Theme evidence and assertions were not rerun or modified; prior result remains in theme-assertions.json.",
  "- Focused recapture: 0 missing baseline assets and 0 page render errors.",
  "- Concurrent full preflight is external to this browser correction. It was not rerun or independently reclassified; see the main-agent preflight artifacts.","",
  "Original browser evidence is preserved under initial-browser-pass/. An intermediate correction-harness iteration accidentally recaptured all mobile routes; those extra captures are not used in final comparisons and are archived under correction-diagnostics/. The final JSON uses exactly six corrected Leads keys plus the untouched original 30 comparisons. No application source, workflows, packages, real CRM data, publish or push were changed.",
];
await writeFile(`${dir}browser-verdict.md`,verdict.join("\n"));
console.log(JSON.stringify({
  finalExact:36-failed.length,failedKeys:failed.map(row=>row.key),clock:clockCapture.fixedTime,
  deals:summary.dealsTableCorrection.geometry,untouchedComparisons:initial.clockCorrection.untouchedInitialComparisonKeys.length,
},null,2));