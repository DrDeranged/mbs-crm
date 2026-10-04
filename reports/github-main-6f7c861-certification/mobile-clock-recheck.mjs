import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { startSandbox } from "../../scripts/visual-refresh/sandbox.mjs";
import { waitForPage } from "../../scripts/visual-refresh/readiness.mjs";

const out="reports/github-main-6f7c861-certification";
const baselineRoot=resolve(".local/certification-2af927c/baselines/target-2af927c");
const clock=new Date("2026-10-03T18:00:00Z"),roles=["admin","manager","rep"];
const captured=[],errors=[],missing=[];
const browser=await chromium.launch({executablePath:"/repl/tools/bin/chromium",headless:true});
const sandbox=await startSandbox({build:false,webRoot:resolve(".local/certification-6f7c861/target"),port:4320});
const contentTypes={html:"text/html",js:"application/javascript",css:"text/css",svg:"image/svg+xml",png:"image/png",ico:"image/x-icon",woff2:"font/woff2",woff:"font/woff",jpg:"image/jpeg",webp:"image/webp",json:"application/json",webmanifest:"application/manifest+json"};
async function snapshot(page){return page.locator("button,a,input,select,textarea,[role=combobox],[contenteditable=true]").evaluateAll(els=>{const d=e=>({tag:e.tagName,role:e.getAttribute("role"),type:e.getAttribute("type"),name:e.getAttribute("aria-label")||e.getAttribute("placeholder")||e.textContent?.trim().replace(/\s+/g," "),href:e.getAttribute("href"),disabled:e.hasAttribute("disabled")});const x=e=>!!e.closest("[data-appearance-control],nav[aria-label='Record actions']");return{controls:els.filter(e=>!x(e)).map(d),exemptions:els.filter(x).map(d)}})}
try{
  for(const phase of ["target","baseline"])for(const role of roles){
    const context=await browser.newContext({viewport:{width:390,height:900},colorScheme:"light",reducedMotion:"reduce",serviceWorkers:"block"});
    if(phase==="baseline")await context.route("**/*",async route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==sandbox.url||url.pathname.startsWith("/api/"))return route.continue();const html=req.resourceType()==="document"||req.headers().accept?.includes("text/html");if(!html&&!/\.(?:js|css|woff2?|png|svg|webp|ico|jpg|json|webmanifest)$/.test(url.pathname))return route.continue();const p=html?"index.html":decodeURIComponent(url.pathname).replace(/^\/+/,"");try{await route.fulfill({status:200,contentType:contentTypes[p.split(".").pop()]||"application/octet-stream",body:await readFile(`${baselineRoot}/${p}`)})}catch(e){if(e.code!=="ENOENT")throw e;missing.push(p);await route.fulfill({status:404,body:`Missing retained baseline asset: ${p}`})}});
    const page=await context.newPage();page.on("pageerror",e=>errors.push({phase,role,message:e.message.slice(0,240)}));
    await sandbox.login(page,role);await page.clock.setFixedTime(clock);
    const actualClock=await page.evaluate(()=>new Date().toISOString());
    for(const width of [390,768]){await page.setViewportSize({width,height:900});await page.goto(`${sandbox.url}/leads`,{waitUntil:"networkidle"});await waitForPage(page,"leads");captured.push({phase,key:`leads-${width}-${role}`,clock:actualClock,...await snapshot(page)})}
    await context.close();
  }
  await writeFile(`${out}/mobile-clock-recheck.json`,JSON.stringify({fixedTime:clock.toISOString(),clockSetAfterSyntheticLogin:true,captured,missingBaselineAssets:missing,renderErrors:errors},null,2));
  console.log(JSON.stringify({fixedTime:clock.toISOString(),captureCount:captured.length,keys:captured.map(x=>`${x.phase}:${x.key}`),missingBaselineAssets:missing,renderErrors:errors},null,2));
}finally{await browser.close();await sandbox.close()}