import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { startSandbox } from "../../scripts/visual-refresh/sandbox.mjs";
import { waitForPage } from "../../scripts/visual-refresh/readiness.mjs";

const out="reports/github-main-6f7c861-certification";
const webRoot=resolve(".local/certification-6f7c861/target");
const baselineRoot=resolve(".local/certification-2af927c/baselines/target-2af927c");
const clockTime=new Date("2026-10-03T18:00:00Z");
const pages=[["dashboard","/dashboard"],["leads","/leads"],["lead-detail","/leads/1"],["pipeline","/deals"],["apply","/apply"],["settings","/settings"]];
const roles=["admin","manager","rep"];
const mobileFresh=[],deals=[],renderErrors=[],missingAssets=[];
const browser=await chromium.launch({executablePath:"/repl/tools/bin/chromium",headless:true});
const sandbox=await startSandbox({build:false,webRoot,port:4320});
const types={html:"text/html",js:"application/javascript",css:"text/css",svg:"image/svg+xml",png:"image/png",ico:"image/x-icon",woff2:"font/woff2",woff:"font/woff",jpg:"image/jpeg",webp:"image/webp",json:"application/json",webmanifest:"application/manifest+json"};
async function inventory(page){
  return page.locator("button,a,input,select,textarea,[role=combobox],[contenteditable=true]").evaluateAll(els=>{
    const describe=e=>({tag:e.tagName,role:e.getAttribute("role"),type:e.getAttribute("type"),name:e.getAttribute("aria-label")||e.getAttribute("placeholder")||e.textContent?.trim().replace(/\s+/g," "),href:e.getAttribute("href"),disabled:e.hasAttribute("disabled")});
    const exempt=e=>!!e.closest("[data-appearance-control],nav[aria-label='Record actions']");
    return {controls:els.filter(e=>!exempt(e)).map(describe),exemptions:els.filter(exempt).map(describe)};
  });
}
try{
  await mkdir(`${out}/screenshots`,{recursive:true});
  for(const role of roles){
    const context=await browser.newContext({viewport:{width:390,height:900},colorScheme:"light",reducedMotion:"reduce",serviceWorkers:"block"});
    const page=await context.newPage();page.on("pageerror",e=>renderErrors.push({phase:"target-mobile",role,message:e.message.slice(0,240)}));
    await sandbox.login(page,role);
    await page.clock.setFixedTime(clockTime);
    const observedClock=await page.evaluate(()=>new Date().toISOString());
    assert.equal(observedClock,"2026-10-03T18:00:00.000Z","Target application clock did not fix after login");
    for(const width of [390,768]){
      await page.setViewportSize({width,height:900});
      for(const [name,path] of pages.filter(([name])=>name==="leads")){
        await page.goto(`${sandbox.url}${path}`,{waitUntil:"networkidle"});await waitForPage(page,name);
        mobileFresh.push({phase:"target",key:`${name}-${width}-${role}`,...await inventory(page)});
      }
    }
    await context.close();
  }
  for(const role of roles){
    const context=await browser.newContext({viewport:{width:390,height:900},colorScheme:"light",reducedMotion:"reduce",serviceWorkers:"block"});
    await context.route("**/*",async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.origin!==sandbox.url||url.pathname.startsWith("/api/"))return route.continue();
      const html=req.resourceType()==="document"||req.headers().accept?.includes("text/html");
      if(!html&&!/\.(?:js|css|woff2?|png|svg|webp|ico|jpg|json|webmanifest)$/.test(url.pathname))return route.continue();
      const path=html?"index.html":decodeURIComponent(url.pathname).replace(/^\/+/,"");
      if(path.split("/").includes(".."))throw new Error("Unsafe retained-baseline path");
      try{const bytes=await readFile(`${baselineRoot}/${path}`);await route.fulfill({status:200,contentType:types[path.split(".").pop()]||"application/octet-stream",body:bytes});}
      catch(e){if(e.code!=="ENOENT")throw e;missingAssets.push(path);await route.fulfill({status:404,contentType:"text/plain",body:`Missing retained baseline asset: ${path}`});}
    });
    const page=await context.newPage();page.on("pageerror",e=>renderErrors.push({phase:"baseline-mobile",role,message:e.message.slice(0,240)}));
    await sandbox.login(page,role);await page.clock.setFixedTime(clockTime);
    assert.equal(await page.evaluate(()=>new Date().toISOString()),"2026-10-03T18:00:00.000Z","Baseline application clock did not fix after login");
    for(const width of [390,768]){
      await page.setViewportSize({width,height:900});
      for(const [name,path] of pages.filter(([name])=>name==="leads")){
        await page.goto(`${sandbox.url}${path}`,{waitUntil:"networkidle"});await waitForPage(page,name);
        mobileFresh.push({phase:"baseline",key:`${name}-${width}-${role}`,...await inventory(page)});
      }
    }
    await context.close();
  }
  const admin=await browser.newContext({viewport:{width:1280,height:900},colorScheme:"light",reducedMotion:"reduce",serviceWorkers:"block"});
  const page=await admin.newPage();page.on("pageerror",e=>renderErrors.push({phase:"deals-table",role:"admin",message:e.message.slice(0,240)}));await sandbox.login(page,"admin");
  for(const width of [1280,1366])for(const sidebar of ["collapsed","pinned"]){
    await page.setViewportSize({width,height:900});
    await page.goto(`${sandbox.url}/deals`,{waitUntil:"networkidle"});await waitForPage(page,"pipeline");
    const pinName=sidebar==="pinned"?"Pin sidebar open":"Unpin sidebar";
    const pin=page.getByRole("button",{name:pinName});
    if(await pin.count())await pin.click();
    await page.waitForFunction(expected=>document.querySelector(`button[aria-label="${expected? "Unpin sidebar":"Pin sidebar open"}"]`)?.getAttribute("aria-pressed")===String(expected),sidebar==="pinned");
    await page.getByRole("button",{name:"Table",exact:true}).click();
    const table=page.locator("table.deals-data-table");
    await table.waitFor({state:"visible"});
    await page.waitForFunction(()=>{const t=document.querySelector("table.deals-data-table");return !!t&&t.querySelectorAll("tbody tr").length>0;});
    const geometry=await page.evaluate(()=>{
      const table=document.querySelector("table.deals-data-table");
      const chain=[];for(let e=table?.parentElement;e;e=e.parentElement){const s=getComputedStyle(e);chain.push({tag:e.tagName,className:String(e.className).slice(0,100),scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,overflowX:s.overflowX});}
      const doc=[document.documentElement,document.body].map(e=>({tag:e.tagName,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,overflowX:getComputedStyle(e).overflowX}));
      const text=table?.innerText||"";
      return {table:{visible:!!table&&!!table.getClientRects().length,scrollWidth:table?.scrollWidth||0,clientWidth:table?.clientWidth||0,rowCount:table?.querySelectorAll("tbody tr").length||0,containsSynthetic:/Synthetic|Fixture|Sample|Applicant|Contact/i.test(text)},document:doc,ancestors:chain};
    });
    const docOverflow=geometry.document.some(x=>x.scrollWidth>x.clientWidth);
    const scrollContainer=geometry.ancestors.find(x=>x.scrollWidth>x.clientWidth&&/(auto|scroll|overlay)/.test(x.overflowX));
    const record={page:"deals",view:"table",width,sidebar,...geometry,horizontalScrolling:!!(docOverflow||scrollContainer),scrollContainedToTable:!!scrollContainer&&!docOverflow,scrollWholePage:docOverflow};
    deals.push(record);
    assert.equal(record.table.visible,true,"Deals table view not visible");
    assert.ok(record.table.rowCount>0,"Deals table has no body rows");
    assert.equal(record.table.containsSynthetic,true,"Deals table rows do not show synthetic fixture data");
    const filename=`screenshots/deals-${width}-${sidebar}-table.png`;
    await page.screenshot({path:`${out}/${filename}`});record.screenshot=filename;
  }
  await admin.close();
  const prior=JSON.parse(await readFile(`${out}/initial-browser-pass/mobile-comparisons.json`,"utf8"));
  const freshBy=Object.fromEntries(mobileFresh.map(r=>[`${r.phase}:${r.key}`,r]));
  const replaceKeys=new Set([390,768].flatMap(width=>roles.map(role=>`leads-${width}-${role}`)));
  for(const key of replaceKeys)for(const phase of ["target","baseline"]){
    const idx=prior.mobileInventories.findIndex(r=>r.phase===phase&&r.key===key);
    const corrected=freshBy[`${phase}:${key}`];
    if(idx<0)prior.mobileInventories.push(corrected);else prior.mobileInventories[idx]=corrected;
  }
  const certified=JSON.parse(await readFile("reports/structural-certification-2026-10-03/after/role-controls.json","utf8"));
  const exempt=JSON.parse(await readFile("reports/structural-certification-2026-10-03/after/exempt-controls.json","utf8"));
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const diff=(a,b)=>(a||[]).flatMap((v,i)=>same(v,b?.[i])?[]:[{index:i,actual:v,expected:b?.[i]}]);
  const all=Object.fromEntries(prior.mobileInventories.map(r=>[`${r.phase}:${r.key}`,r]));
  for(const c of prior.comparisons){
    const t=all[`target:${c.key}`],b=all[`baseline:${c.key}`];
    c.reusedFromInitialBrowserPass=!replaceKeys.has(c.key);
    c.fixedClockRecheck=replaceKeys.has(c.key)?clockTime.toISOString():null;
    c.controlsEqual=same(t.controls,b.controls);c.exemptionsEqual=same(t.exemptions,b.exemptions);
    c.certifiedInventoryEqual=same(t.controls,certified[c.key]);c.certifiedExemptionsEqual=same(t.exemptions,exempt[c.key]);
    c.differences={baselineControls:!c.controlsEqual,baselineExemptions:!c.exemptionsEqual,certifiedControls:!c.certifiedInventoryEqual,certifiedExemptions:!c.certifiedExemptionsEqual};
    c.differenceDetails={freshBaselineControls:diff(t.controls,b.controls),freshBaselineExemptions:diff(t.exemptions,b.exemptions),certifiedControls:diff(t.controls,certified[c.key]),certifiedExemptions:diff(t.exemptions,exempt[c.key])};
  }
  prior.clockCorrection={fixedTime:clockTime.toISOString(),loginBeforeFix:true,correctedKeys:[...replaceKeys],untouchedComparisons:prior.comparisons.filter(c=>!replaceKeys.has(c.key)).length,normalization:"none"};
  prior.certifiedDifferenceSummary="Corrected Leads keys were recaptured at the certified inventory clock. Other 30 key comparisons reused without modification from the initial browser pass.";
  prior.finalStructuralPass=prior.comparisons.length===36&&prior.comparisons.every(c=>c.controlsEqual&&c.exemptionsEqual&&c.certifiedInventoryEqual&&c.certifiedExemptionsEqual);
  await writeFile(`${out}/mobile-comparisons.json`,JSON.stringify(prior,null,2));
  const geom=JSON.parse(await readFile(`${out}/initial-browser-pass/table-geometry.json`,"utf8"));
  const leadRows=geom.geometry.filter(x=>x.page==="leads");
  for(const row of leadRows)row.screenshot=`screenshots/leads-${row.width}-${row.sidebar}.png`;
  geom.geometry=[...leadRows,...deals];
  geom.fixtureData="Two existing synthetic lead and deal rows; Deals Table view explicitly selected and verified.";
  geom.correctedDeals=true;geom.screenshots=[...JSON.parse(await readFile(`${out}/initial-browser-pass/table-geometry.json`,"utf8")).screenshots.filter(x=>x.startsWith("screenshots/leads-")),...deals.map(x=>x.screenshot)];
  await writeFile(`${out}/table-geometry.json`,JSON.stringify(geom,null,2));
  await writeFile(`${out}/corrective-pass.json`,JSON.stringify({fixedClock:clockTime.toISOString(),loginBeforeFix:true,replacedKeys:[...replaceKeys],retainedExistingComparisons:prior.comparisons.filter(c=>c.reusedFromInitialBrowserPass).length,dealView:"Clicked visible button named Table; asserted visible table.deals-data-table, nonzero tbody rows, and synthetic fixture text.",deals,missingAssets,renderErrors},null,2));
  for(const file of ["deals-1280-collapsed.png","deals-1280-pinned.png","deals-1366-collapsed.png","deals-1366-pinned.png"])await rm(`${out}/screenshots/${file}`,{force:true});
  console.log(JSON.stringify({mobileFailures:prior.comparisons.filter(c=>!c.controlsEqual||!c.exemptionsEqual||!c.certifiedInventoryEqual||!c.certifiedExemptionsEqual).map(c=>({key:c.key,differences:c.differenceDetails.certifiedControls})),dealGeometry:deals,missingAssets,renderErrors},null,2));
  assert.equal(missingAssets.length,0,"Missing retained baseline assets");
  assert.equal(renderErrors.length,0,"Render errors during corrective browser pass");
  assert.equal(prior.finalStructuralPass,true,"Corrected strict certified inventory comparison remains failed");
}finally{
  await browser.close();
  await sandbox.close();
}