import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { startSandbox } from "../../scripts/visual-refresh/sandbox.mjs";
import { waitForPage } from "../../scripts/visual-refresh/readiness.mjs";

const out = "reports/github-main-6f7c861-certification";
const webRoot = resolve(".local/certification-6f7c861/target");
const baselineRoot = resolve(".local/certification-2af927c/baselines/target-2af927c");
const pages = [["dashboard", "/dashboard"], ["leads", "/leads"], ["lead-detail", "/leads/1"], ["pipeline", "/deals"], ["apply", "/apply"], ["settings", "/settings"]];
const roles = ["admin", "manager", "rep"];
const inventoryClock = new Date("2026-10-03T18:00:00Z");
const types = { html:"text/html", js:"application/javascript", css:"text/css", svg:"image/svg+xml", png:"image/png", ico:"image/x-icon", woff2:"font/woff2", woff:"font/woff", jpg:"image/jpeg", webp:"image/webp", json:"application/json", webmanifest:"application/manifest+json" };
const inventory = JSON.parse(await readFile("reports/structural-certification-2026-10-03/after/role-controls.json"));
const exemptInventory = JSON.parse(await readFile("reports/structural-certification-2026-10-03/after/exempt-controls.json"));
const sourceProof = JSON.parse(await readFile(`${out}/source-proof.json`));
const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", headless: true });
const sandbox = await startSandbox({ build:false, webRoot, port:4320 });
const errors = [], missingBaselineAssets = [], mobile = [], toggleCounts = [], tableGeometry = [], themes = [], screenshots = [];
const baselineIndexHash = createHash("sha256").update(await readFile(`${baselineRoot}/index.html`)).digest("hex");
const targetIndexHash = createHash("sha256").update(await readFile(`${webRoot}/index.html`)).digest("hex");
const safeError = (phase, role, message) => errors.push({ phase, role, message:String(message).slice(0,300) });
async function waitReady(page, name) { await waitForPage(page, name); }
async function captureControls(page) {
  return page.locator("button,a,input,select,textarea,[role=combobox],[contenteditable=true]").evaluateAll(elements => {
    const describe = el => ({tag:el.tagName,role:el.getAttribute("role"),type:el.getAttribute("type"),name:el.getAttribute("aria-label")||el.getAttribute("placeholder")||el.textContent?.trim().replace(/\s+/g," "),href:el.getAttribute("href"),disabled:el.hasAttribute("disabled")});
    const exempt = el => !!el.closest("[data-appearance-control],nav[aria-label='Record actions']");
    return {controls:elements.filter(el=>!exempt(el)).map(describe),exemptions:elements.filter(exempt).map(describe)};
  });
}
async function modeState(page) {
  return page.evaluate(() => {
    const toggles=[...document.querySelectorAll('button[data-testid="header-theme-toggle"],button[aria-label*="Switch to"][aria-label*="mode"]')];
    return {mode:document.documentElement.dataset.appearance, ariaLabels:toggles.map(b=>b.getAttribute("aria-label")), toggleCount:document.querySelectorAll('button[data-testid="header-theme-toggle"],button[aria-label*="Switch to"][aria-label*="mode"]').length,
      preference:Object.keys(localStorage).filter(k=>k.startsWith("mbs-web-appearance:")).map(k=>localStorage.getItem(k))};
  });
}
async function saveShot(page, name) {
  const filename=`screenshots/${name}.png`;
  await page.screenshot({path:`${out}/${filename}`});
  screenshots.push(filename);
}
try {
  await mkdir(`${out}/screenshots`, {recursive:true});
  for (const role of roles) {
    const context=await browser.newContext({viewport:{width:390,height:900},colorScheme:"light",reducedMotion:"reduce",serviceWorkers:"block"});
    const page=await context.newPage();
    page.on("pageerror", e=>safeError("render",role,e.message));
    await sandbox.login(page,role);
    await page.clock.setFixedTime(inventoryClock);
    for (const width of [390,768]) {
      await page.setViewportSize({width,height:900});
      for (const [name,path] of pages) {
        await page.goto(`${sandbox.url}${path}`,{waitUntil:"networkidle"});
        await waitReady(page,name);
        mobile.push({phase:"target",key:`${name}-${width}-${role}`,...await captureControls(page)});
      }
    }
    for (const width of [390,768,1023]) {
      await page.setViewportSize({width,height:900});
      await page.goto(`${sandbox.url}/dashboard`,{waitUntil:"networkidle"});
      await waitReady(page,"dashboard");
      const found=await page.locator('button[data-testid="header-theme-toggle"],button[aria-label*="Switch to"][aria-label*="mode"]').evaluateAll(els=>els.map(e=>({testid:e.getAttribute("data-testid"),label:e.getAttribute("aria-label"),hidden:!e.getClientRects().length})));
      toggleCounts.push({role,width,count:found.length,buttons:found});
    }
    await context.close();
  }
  // Retained baseline uses its own bytes for documents, HTML polling, and static assets; API remains fixture-backed.
  for (const role of roles) {
    const context=await browser.newContext({viewport:{width:390,height:900},colorScheme:"light",reducedMotion:"reduce",serviceWorkers:"block"});
    await context.route("**/*",async route=>{
      const req=route.request(), url=new URL(req.url());
      if(url.origin!==sandbox.url||url.pathname.startsWith("/api/")) return route.continue();
      const isHtml=req.resourceType()==="document"||req.headers().accept?.includes("text/html");
      const path=isHtml?"index.html":decodeURIComponent(url.pathname).replace(/^\/+/,"");
      if(!isHtml&&!/\.(?:js|css|woff2?|png|svg|webp|ico|jpg|json|webmanifest)$/.test(url.pathname)) return route.continue();
      if(path.split("/").includes("..")) throw new Error("Unsafe baseline path");
      try {
        const bytes=await readFile(`${baselineRoot}/${path}`), ext=path.split(".").pop();
        await route.fulfill({status:200,contentType:types[ext]||"application/octet-stream",body:bytes});
      } catch(e) {
        if(e.code!=="ENOENT") throw e;
        missingBaselineAssets.push(path);
        await route.fulfill({status:404,contentType:"text/plain",body:`Missing retained baseline asset: ${path}`});
      }
    });
    const page=await context.newPage();
    page.on("pageerror",e=>safeError("baseline-render",role,e.message));
    await sandbox.login(page,role);
    await page.clock.setFixedTime(inventoryClock);
    for(const width of [390,768]) {
      await page.setViewportSize({width,height:900});
      for(const [name,path] of pages) {
        await page.goto(`${sandbox.url}${path}`,{waitUntil:"networkidle"});
        await waitReady(page,name);
        mobile.push({phase:"baseline",key:`${name}-${width}-${role}`,...await captureControls(page)});
      }
    }
    await context.close();
  }
  const targetMap=Object.fromEntries(mobile.filter(x=>x.phase==="target").map(x=>[x.key,x]));
  const baselineMap=Object.fromEntries(mobile.filter(x=>x.phase==="baseline").map(x=>[x.key,x]));
  const comparisons=Object.keys(inventory).map(key=>{
    const t=targetMap[key],b=baselineMap[key];
    const same=(a,c)=>JSON.stringify(a)===JSON.stringify(c);
    const diff=(actual,expected)=>(actual||[]).flatMap((value,index)=>same(value,expected?.[index])?[]:[{index,actual:value,expected:expected?.[index]}]);
    return {key,controlsEqual:!!b&&same(t.controls,b.controls),exemptionsEqual:!!b&&same(t.exemptions,b.exemptions),certifiedInventoryEqual:!!t&&same(t.controls,inventory[key]),certifiedExemptionsEqual:!!t&&same(t.exemptions,exemptInventory[key]),differences:{baselineControls:!b||!same(t.controls,b.controls),baselineExemptions:!b||!same(t.exemptions,b.exemptions),certifiedControls:!t||!same(t.controls,inventory[key]),certifiedExemptions:!t||!same(t.exemptions,exemptInventory[key])},differenceDetails:{freshBaselineControls:diff(t?.controls,b?.controls),freshBaselineExemptions:diff(t?.exemptions,b?.exemptions),certifiedControls:diff(t?.controls,inventory[key]),certifiedExemptions:diff(t?.exemptions,exemptInventory[key])}};
  });
  // Desktop table geometry: eight target screenshots, with both rail and pinned-sidebar states.
  const admin=await browser.newContext({viewport:{width:1280,height:900},colorScheme:"light",reducedMotion:"reduce",serviceWorkers:"block"});
  const desk=await admin.newPage(); desk.on("pageerror",e=>safeError("desktop-render","admin",e.message)); await sandbox.login(desk,"admin");
  for(const width of [1280,1366]) for(const state of ["collapsed","pinned"]) for(const [pageName,path] of [["leads","/leads"],["deals","/deals"]]) {
    await desk.setViewportSize({width,height:900}); await desk.goto(`${sandbox.url}${path}`,{waitUntil:"networkidle"}); await waitReady(desk,pageName==="deals"?"pipeline":"leads");
    const toggle=desk.getByRole("button",{name:state==="pinned"?"Pin sidebar open":"Unpin sidebar"});
    if(await toggle.count()) await toggle.click();
    const geometry=await desk.evaluate(()=>{
      const table=document.querySelector("table");
      const ancestors=[]; for(let e=table?.parentElement;e;e=e.parentElement){const s=getComputedStyle(e);ancestors.push({tag:e.tagName,className:String(e.className).slice(0,120),scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,overflowX:s.overflowX});}
      const tableRowCount=table?.querySelectorAll("tbody tr").length||0;
      const tableText=table?.innerText||"";
      const doc={scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,overflowX:getComputedStyle(document.documentElement).overflowX};
      return {document:doc,table:{scrollWidth:table?.scrollWidth||0,clientWidth:table?.clientWidth||0,rowCount:tableRowCount,containsSynthetic:/(Fixture|Synthetic|Sample|Applicant|Contact)/i.test(tableText)},ancestors};
    });
    const docOverflow=geometry.document.scrollWidth>geometry.document.clientWidth;
    const scroller=geometry.ancestors.find(a=>a.scrollWidth>a.clientWidth&&/(auto|scroll)/.test(a.overflowX));
    tableGeometry.push({page:pageName,width,sidebar:state,...geometry,horizontalScrolling:!!(docOverflow||scroller),scrollContainedToTable:!!scroller&&!docOverflow,scrollWholePage:docOverflow});
    await saveShot(desk,`${pageName}-${width}-${state}`);
  }
  await admin.close();
  // Fresh authenticated synthetic account/browser context, OS dark, no saved preference.
  const themeContext=await browser.newContext({viewport:{width:1280,height:900},colorScheme:"dark",reducedMotion:"reduce",serviceWorkers:"block"});
  const themePage=await themeContext.newPage(); themePage.on("pageerror",e=>safeError("theme-render","admin",e.message)); await sandbox.login(themePage,"admin");
  await themePage.goto(`${sandbox.url}/dashboard`,{waitUntil:"networkidle"}); await waitReady(themePage,"dashboard");
  let state=await modeState(themePage);
  themes.push({step:"new-user-os-dark-default",...state,expected:"light",pass:state.mode==="light"&&state.preference.length===0});
  const header=themePage.getByTestId("header-theme-toggle");
  await header.focus(); await themePage.keyboard.press("Enter"); await themePage.waitForFunction(()=>document.documentElement.dataset.appearance==="dark");
  state=await modeState(themePage); themes.push({step:"header-Enter-to-dark",...state,expected:"dark",pass:state.mode==="dark"&&state.ariaLabels.includes("Switch to light mode")&&state.preference.includes("dark")});
  await header.focus(); await themePage.keyboard.press("Space"); await themePage.waitForFunction(()=>document.documentElement.dataset.appearance==="light");
  state=await modeState(themePage); themes.push({step:"header-Space-to-light",...state,expected:"light",pass:state.mode==="light"&&state.ariaLabels.includes("Switch to dark mode")&&state.preference.includes("light")});
  await themePage.setViewportSize({width:768,height:900}); await themePage.goto(`${sandbox.url}/settings`,{waitUntil:"networkidle"}); await waitReady(themePage,"settings");
  const appearance=themePage.getByLabel("Appearance theme");
  state=await modeState(themePage); const mobilePreference=await appearance.inputValue();
  themes.push({step:"mobile-settings-reflects-light",...state,settingsPreference:mobilePreference,expected:"light",pass:state.mode==="light"&&mobilePreference==="light"});
  await appearance.selectOption("dark"); await themePage.waitForFunction(()=>document.documentElement.dataset.appearance==="dark");
  state=await modeState(themePage); themes.push({step:"settings-select-dark",...state,settingsPreference:await appearance.inputValue(),expected:"dark",pass:state.mode==="dark"&&state.preference.includes("dark")});
  await themePage.setViewportSize({width:1280,height:900}); await themePage.goto(`${sandbox.url}/settings`,{waitUntil:"networkidle"}); await waitReady(themePage,"settings");
  const desktopHasSelector=await themePage.getByLabel("Appearance theme").count();
  state=await modeState(themePage); themes.push({step:"desktop-settings-absent-header-dark",...state,settingsSelectorCount:desktopHasSelector,expected:"dark; selector absent",pass:state.mode==="dark"&&desktopHasSelector===0});
  await themePage.reload({waitUntil:"networkidle"}); await waitReady(themePage,"settings"); state=await modeState(themePage);
  themes.push({step:"reload-dark-persists",...state,expected:"dark",pass:state.mode==="dark"&&state.preference.includes("dark")});
  await themePage.setViewportSize({width:768,height:900}); await themePage.goto(`${sandbox.url}/settings`,{waitUntil:"networkidle"}); await waitReady(themePage,"settings");
  await themePage.getByLabel("Appearance theme").selectOption("light"); await themePage.waitForFunction(()=>document.documentElement.dataset.appearance==="light");
  state=await modeState(themePage); themes.push({step:"settings-select-light",...state,settingsPreference:await themePage.getByLabel("Appearance theme").inputValue(),expected:"light",pass:state.mode==="light"&&state.preference.includes("light")});
  await themePage.setViewportSize({width:1280,height:900}); await themePage.goto(`${sandbox.url}/dashboard`,{waitUntil:"networkidle"}); await waitReady(themePage,"dashboard"); state=await modeState(themePage);
  themes.push({step:"header-reflects-light",...state,expected:"light",pass:state.mode==="light"&&state.ariaLabels.includes("Switch to dark mode")});
  await themePage.reload({waitUntil:"networkidle"}); await waitReady(themePage,"dashboard"); state=await modeState(themePage);
  themes.push({step:"reload-light-persists",...state,expected:"light",pass:state.mode==="light"&&state.preference.includes("light")});
  await saveShot(themePage,"theme-light-after-reload"); await themeContext.close();

  const structuralPass=comparisons.length===36&&comparisons.every(x=>x.controlsEqual&&x.exemptionsEqual&&x.certifiedInventoryEqual&&x.certifiedExemptionsEqual);
  const togglesPass=toggleCounts.every(x=>x.count===0);
  const themesPass=themes.every(x=>x.pass);
  const renderPass=errors.length===0;
  await writeFile(`${out}/mobile-comparisons.json`,JSON.stringify({sourceProofCommit:sourceProof.certifiedCommit,baselineRevision:"2af927ca2830926bf325cef2eecfffc24ab5c110",baselineIndexSha256:baselineIndexHash,targetIndexSha256:targetIndexHash,comparisons,toggleCounts,mobileInventories:mobile,missingBaselineAssets,structuralPass,togglesPass},null,2));
  await writeFile(`${out}/table-geometry.json`,JSON.stringify({fixtureData:"Two existing synthetic lead and deal rows",screenshots:screenshots.slice(0,8),geometry:tableGeometry},null,2));
  await writeFile(`${out}/theme-assertions.json`,JSON.stringify({osColorScheme:"dark",preferenceStorage:"browser-local per authenticated synthetic account; no server/cross-device sync asserted",assertions:themes,pass:themesPass},null,2));
  await writeFile(`${out}/browser-log.json`,JSON.stringify({errors:errors.slice(0,100),missingBaselineAssets:missingBaselineAssets.slice(0,100),expectedFixtureNotes:["serviceWorkers:block","external delivery credentials stripped by fixture","any delivery-provider 503 is not classified as an app render error"],captureLimit:"Bounded sanitized pageerror messages only; no URLs, traces, HAR, cookies, auth tickets or credentials"},null,2));
  const verdict=[`# GitHub main 6f7c861 browser certification`,``,`Commit proof: ${sourceProof.certifiedCommit}; ${sourceProof.matchedCommittedSourceFiles} committed files matched; published: ${sourceProof.published}.`,`Target frontend: ${webRoot}; baseline: ${baselineRoot}.`,``,`- Mobile structural inventory: ${structuralPass?"PASS":"FAIL"} (${comparisons.filter(x=>x.controlsEqual&&x.exemptionsEqual&&x.certifiedInventoryEqual&&x.certifiedExemptionsEqual).length}/36 exact); differences are preserved in mobile-comparisons.json.`,`- Below-1024 theme-toggle DOM count: ${togglesPass?"PASS":"FAIL"} (${toggleCounts.map(x=>`${x.width}px:${x.count}`).join(", ")} per role); hidden matches included.`,`- Baseline asset availability: ${missingBaselineAssets.length===0?"PASS":"FAIL"} (${missingBaselineAssets.length} missing).`,`- Desktop table geometry/screenshots: ${tableGeometry.map(x=>`${x.page} ${x.width}px ${x.sidebar}: scrolling=${x.horizontalScrolling?"yes":"no"}, contained=${x.scrollContainedToTable?"table":"no"}, whole-page=${x.scrollWholePage?"yes":"no"}`).join("; ")}.`,`- Theme assertions: ${themesPass?"PASS":"FAIL"} (${themes.filter(x=>x.pass).length}/${themes.length}); desktop Settings selector absence checked; no cross-device/server sync claimed.`,`- App render errors: ${renderPass?"none":"FAIL"} (${errors.length}).`,`- Screenshots (${screenshots.length}): ${screenshots.join(", ")}`,``,`Details: mobile-comparisons.json, table-geometry.json, theme-assertions.json, browser-log.json.`,`No production data, external delivery, real-user images, auth materials, traces, HAR, or query-token URLs were captured.`].join("\n");
  await writeFile(`${out}/browser-verdict.md`,verdict);
  console.log(verdict);
  assert.equal(missingBaselineAssets.length,0,"Missing retained baseline assets");
  assert.equal(errors.length,0,"App page render errors");
  assert.equal(structuralPass,true,"Strict 36/36 mobile inventory comparison failed");
  assert.equal(togglesPass,true,"Theme-toggle buttons exist below 1024px");
  assert.equal(themesPass,true,"Theme synchronization or persistence assertions failed");
} finally {
  await browser.close();
  await sandbox.close();
}