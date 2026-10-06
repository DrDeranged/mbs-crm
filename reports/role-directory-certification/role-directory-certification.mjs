import { chromium } from "@playwright/test";
import { appendFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { join, resolve, relative, sep } from "node:path";
import { startSandbox } from "../../scripts/visual-refresh/sandbox.mjs";
import { waitForPage } from "../../scripts/visual-refresh/readiness.mjs";

const root = resolve(import.meta.dirname, "../..");
const reportRoot = join(root, "reports/role-directory-certification");
const output = join(reportRoot, "run");
const authFile = join(reportRoot, "launch-authorization.json");
const policyFile = join(reportRoot, "policy.json");
const baselineRoot = join(root, ".local/certification-2af927c/baselines/target-2af927c");
const baselineRevision = "2af927ca2830926bf325cef2eecfffc24ab5c110";
const apiDistRoot = join(root, "artifacts/api-server/dist");
const webSourceRoot = join(root, "artifacts/mbs-crm/src");
const apiSourceRoot = join(root, "artifacts/api-server/src");
const sandboxHelper = join(root, "scripts/visual-refresh/sandbox.mjs");
const readinessHelper = join(root, "scripts/visual-refresh/readiness.mjs");
const historicalCampaignFixture = join(root, ".local/certification-853f4e4/historical-campaign.json");
const roles = ["admin", "manager", "rep"];
const widths = [390, 768], height = 900;
const structuralPages = [
  ["dashboard", "/dashboard"], ["leads", "/leads"], ["lead-detail", "/leads/1"],
  ["pipeline", "/deals"], ["apply", "/apply"], ["settings", "/settings"],
];
const repPolicyRoutes = [
  ["leads-filter", "/leads", "leads"], ["lead-detail-header", "/leads/1", "lead-detail"],
  ["dashboard-assignment", "/dashboard", "dashboard"], ["deal-pipeline", "/deals", "pipeline"],
  ["new-deal-assignment", "/deals/new", "new-deal"], ["deal-detail-assignment", "/deals/1", "deal-detail"],
  ["campaign-audience", "/campaigns/5", "campaign-detail"], ["settings-directory", "/settings", "settings"],
  ["documents-directory", "/documents", "documents"], ["credit-compliance-filter", "/credit/compliance", "credit-compliance"],
  ["governance-role-policy", "/governance", "governance"],
];
const badStatuses = new Set([403, 404, 503]);
const require = createRequire(join(root, "artifacts/api-server/package.json"));
const { clerkClient } = require("@clerk/express");
const createdUsers = new Set();
const originalCreateUser = clerkClient.users.createUser.bind(clerkClient.users);
const originalDeleteUser = clerkClient.users.deleteUser.bind(clerkClient.users);
clerkClient.users.createUser = async (...args) => { const user = await originalCreateUser(...args); createdUsers.add(user.id); return user; };
clerkClient.users.deleteUser = async id => {
  try { return await originalDeleteUser(id); }
  catch (error) { if (error?.status === 404 || /not found|already deleted/i.test(String(error?.message))) return; throw error; }
};

function check(condition, message) { if (!condition) throw new Error(message); }
async function shaFile(file) { return createHash("sha256").update(await readFile(file)).digest("hex"); }
async function shaTree(directory) {
  const hash = createHash("sha256");
  async function visit(folder, rel = "") {
    for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a,b)=>a.name.localeCompare(b.name))) {
      const path = join(rel, entry.name);
      if (entry.isDirectory()) await visit(join(folder, entry.name), path);
      else if (entry.isFile()) { hash.update(path); hash.update("\0"); hash.update(await readFile(join(folder, entry.name))); hash.update("\0"); }
    }
  }
  await visit(directory); return hash.digest("hex");
}
async function readyGate() {
  let lock;
  try { lock = JSON.parse(await readFile(authFile, "utf8")); }
  catch { throw new Error("Launch blocked: Main must create launch-authorization.json after final source, 11-gate preflight, and immutable-pin freeze."); }
  check(lock.sourceFinalized === true && lock.elevenGatePreflightExit === 0 && lock.immutablePinsFrozen === true && lock.launchAuthorized === true,
    "Launch blocked: readiness fields do not confirm source-final, 11-gate exit 0, frozen pins, and explicit authorization.");
  for (const [name,value,re] of [
    ["targetRevision",lock.targetRevision,/^[0-9a-f]{40}$/], ["localSnapshot",lock.localSnapshot,/^[0-9a-f]{40}$/],
    ["candidateWebSourceTreeSha256",lock.candidateWebSourceTreeSha256,/^[0-9a-f]{64}$/],
    ["candidateApiSourceTreeSha256",lock.candidateApiSourceTreeSha256,/^[0-9a-f]{64}$/],
    ["candidateIndexSha256",lock.candidateIndexSha256,/^[0-9a-f]{64}$/], ["candidateWebTreeSha256",lock.candidateWebTreeSha256,/^[0-9a-f]{64}$/],
    ["candidateApiDistSha256",lock.candidateApiDistSha256,/^[0-9a-f]{64}$/], ["baselineWebTreeSha256",lock.baselineWebTreeSha256,/^[0-9a-f]{64}$/],
    ["approvalPolicySha256",lock.approvalPolicySha256,/^[0-9a-f]{64}$/],
    ["runnerSha256",lock.runnerSha256,/^[0-9a-f]{64}$/], ["sandboxHelperSha256",lock.sandboxHelperSha256,/^[0-9a-f]{64}$/],
    ["readinessHelperSha256",lock.readinessHelperSha256,/^[0-9a-f]{64}$/],
    ["historicalCampaignFixtureSha256",lock.historicalCampaignFixtureSha256,/^[0-9a-f]{64}$/],
  ]) check(re.test(String(value ?? "")), `Launch blocked: authorization has no valid immutable ${name}.`);
  check(lock.baselineRevision === baselineRevision, "Launch blocked: baseline must remain the approved 2af9 revision.");
  check(typeof lock.frozenAt === "string" && Number.isFinite(Date.parse(lock.frozenAt)), "Authorization must record when immutable pins were frozen.");
  check(typeof lock.candidateWebRoot === "string" && resolve(root, lock.candidateWebRoot).startsWith(root + sep), "Candidate web root must stay inside the pinned workspace.");
  check(Number.isInteger(lock.port) && lock.port >= 4300 && lock.port <= 4499, "Authorization must assign an unused isolated-fixture port in 4300–4499.");
  check(lock.preflightEvidence && typeof lock.preflightEvidence.path === "string" && lock.preflightEvidence.exitCode === 0
    && /^[0-9a-f]{64}$/.test(lock.preflightEvidence.sha256), "Authorization must pin the successful 11-gate preflight evidence.");
  const preflightPath = resolve(root, lock.preflightEvidence.path);
  check(preflightPath.startsWith(root + sep) && await shaFile(preflightPath) === lock.preflightEvidence.sha256, "Pinned 11-gate preflight evidence is missing or changed.");
  const candidateIndex = join(resolve(root, lock.candidateWebRoot), "index.html");
  check(await shaFile(candidateIndex) === lock.candidateIndexSha256, "Candidate index hash differs from frozen authorization.");
  check(await shaTree(resolve(root, lock.candidateWebRoot)) === lock.candidateWebTreeSha256, "Candidate web tree differs from frozen authorization.");
  check(await shaTree(webSourceRoot) === lock.candidateWebSourceTreeSha256, "Candidate web source tree differs from frozen authorization.");
  check(await shaTree(apiSourceRoot) === lock.candidateApiSourceTreeSha256, "Candidate API source tree differs from frozen authorization.");
  check(await shaTree(apiDistRoot) === lock.candidateApiDistSha256, "Candidate API dist tree differs from frozen authorization.");
  check(await shaTree(baselineRoot) === lock.baselineWebTreeSha256, "Approved baseline 2af9 tree differs from frozen authorization.");
  check(await shaFile(policyFile) === lock.approvalPolicySha256, "Role-directory approval policy changed after pin freeze.");
  check(await shaFile(join(reportRoot,"role-directory-certification.mjs"))===lock.runnerSha256,"Certification runner differs from frozen authorization.");
  check(await shaFile(sandboxHelper)===lock.sandboxHelperSha256,"Fixture sandbox helper differs from frozen authorization.");
  check(await shaFile(readinessHelper)===lock.readinessHelperSha256,"Page readiness helper differs from frozen authorization.");
  check(await shaFile(historicalCampaignFixture)===lock.historicalCampaignFixtureSha256,"Historical campaign fixture differs from frozen authorization.");
  const policy = JSON.parse(await readFile(policyFile, "utf8"));
  check(policy.approvedStructuralExceptionCategories.length === 3, "Only the three approved structural exception categories may be in the structural policy.");
  check(policy.separateRolePolicyRequirement.isStructuralExceptionCategory === false, "Rep-directory hiding must remain a separate role-policy requirement.");
  return { lock, policy };
}

if (process.argv.includes("--check-ready-only")) {
  const ready = await readyGate();
  console.log(JSON.stringify({ status: "READY; no fixture, browser, login, or output directory created",
    targetRevision: ready.lock.targetRevision, baselineRevision, sourceFinalized: true,
    elevenGatePreflightExit: 0, immutablePinsFrozen: true, launchAuthorized: true }, null, 2));
} else {
  const { lock, policy } = await readyGate();
  const widthNames = widths.join("/");
  const outputInitialized = { value: false };
  const state = { status: "starting", phase: "authorized-preflight", targetRevision: lock.targetRevision,
    localSnapshot: lock.localSnapshot, requiredBaselineCaptures: 36, requiredCandidateCaptures: 36,
    completedCaptures: [], journeys: [], screenshots: [], startedAt: new Date().toISOString() };
  const rolesData = { baseline: {}, candidate: {} };
  const pwrRequests = [], pwrResponses = [], cdpRequests = [], cdpResponses = [], consoleErrors = [], pageErrors = [], requestFailures = [];
  const repUserRequests = [], journeys = [], screenshots = [], captureProgress = [];
  const pendingBodies = new Set();
  let fixture = null, fixtureDbName = null, browser = null, sourceProof = null, fatal = null, eventQueue = Promise.resolve();

  const safeText = value => String(value ?? "").replace(/[\r\n\t]+/g, " ").slice(0, 500);
  function safeUrl(raw) {
    try {
      const u = new URL(raw);
      u.search = ""; u.hash = "";
      u.pathname = u.pathname.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,"[REDACTED_EMAIL]")
        .replace(/(\/(?:users|leads|deals|contacts|recipients)\/)[^/]+/gi,"$1[REDACTED_ID]");
      return { origin: u.origin, path: u.pathname };
    } catch { return { origin: null, path: safeText(raw) }; }
  }
  async function atomicJson(name, value) {
    const file = join(output, name), temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(value, null, 2)); await rename(temp, file);
  }
  function durable(name, row) {
    eventQueue = eventQueue.then(()=>appendFile(join(output,name), `${JSON.stringify(row)}\n`));
    return eventQueue;
  }
  async function phase(name, details = {}) {
    state.phase = name; state.updatedAt = new Date().toISOString();
    await atomicJson("run-progress.json", { ...state, ...details });
    await durable("events.ndjson", { type: "phase", phase: name, at: state.updatedAt, ...details });
  }
  function recordJourney(step, status, details = {}) {
    const row = { step, status, at: new Date().toISOString(), ...details }; journeys.push(row);
    state.journeys = journeys; state.updatedAt = row.at; return durable("journey-events.ndjson", row);
  }
  function updateProgress(row) {
    captureProgress.push(row); state.completedCaptures = [...captureProgress]; state.updatedAt = new Date().toISOString();
    eventQueue = eventQueue.then(async()=>{
      await appendFile(join(output,"capture-progress.ndjson"),`${JSON.stringify(row)}\n`);
      await atomicJson("capture-progress.json",{completed:captureProgress.length,required:72,visits:captureProgress});
      await atomicJson("run-progress.json",state);
    });
    return eventQueue;
  }
  function inventoryFromDom(page) {
    return page.evaluate(() => {
      const describe = el => ({ tag: el.tagName, role: el.getAttribute("role"), type: el.getAttribute("type"),
        name: el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.textContent?.trim().replace(/\s+/g," "),
        href: el.getAttribute("href"), disabled: el.hasAttribute("disabled") });
      const exempt = el => !!el.closest("[data-appearance-control],nav[aria-label='Record actions']");
      const els = [...document.querySelectorAll("button,a,input,select,textarea,[role=combobox],[contenteditable=true]")];
      return { controls: els.filter(el=>!exempt(el)).map(describe), exemptions: els.filter(exempt).map(describe) };
    });
  }
  function directoryPickerInventory(page) {
    return page.evaluate(() => {
      const matcher = /^(filter by representative|assigned rep|assign rep|assignee|assigned to|search reps…?)$/i;
      const nodes = [...document.querySelectorAll("button,input,select,textarea,[role=combobox]")];
      const labelFor = el => {
        const labels = [...document.querySelectorAll("label")];
        const label = labels.find(node => node.contains(el) || (el.id && node.htmlFor === el.id));
        let group = el.parentElement;
        for (let i=0;i<4&&group;i++,group=group.parentElement) {
          const txt = (group.innerText || "").trim().replace(/\s+/g," ");
          if (txt.length < 180 && labels.some(l=>group.contains(l))) return `${label?.innerText || ""} ${txt}`.trim();
        }
        return label?.innerText || "";
      };
      return nodes.map(el => {
        const vals = [el.getAttribute("aria-label"),el.getAttribute("placeholder"),el.innerText,el.textContent,labelFor(el),el.getAttribute("data-testid")]
          .filter(Boolean).map(x=>String(x).trim().replace(/\s+/g," "));
        const name = vals.join(" | ");
        return { tag:el.tagName,role:el.getAttribute("role"),name,disabled:el.hasAttribute("disabled") };
      }).filter(row=>matcher.test(row.name.split(" | ").filter(Boolean).join(" ").trim()) ||
        /filter by representative|assigned rep|assign rep|assignee|assigned to|search reps…?/i.test(row.name));
    });
  }
  async function appReady(page) {
    await page.locator("#root").waitFor({ timeout: 15000 });
    await page.waitForFunction(()=>!!document.querySelector("#root")?.children.length, { timeout: 15000 });
  }
  function addTrace(page, role, phaseRef, phaseGroup, runId) {
    const requestIds = new WeakMap(); let requestSeq = 0;
    const sessionId = `${role}-${runId}`;
    const cdpMeta = new Map(); let cdpSeq = 0;
    page.on("request", request => {
      const requestId = `${sessionId}-pw-${++requestSeq}`;
      requestIds.set(request, requestId);
      const url = safeUrl(request.url()), pagePath = safeUrl(page.url()).path;
      const row = { type:"playwright-request",requestId,role,phase:phaseRef.value,phaseGroup,
        method:request.method(),url,pagePathAtInitiation:pagePath,resourceType:request.resourceType(),observedAt:new Date().toISOString() };
      pwrRequests.push(row); void durable("network-events.ndjson",row);
      if (role==="rep" && phaseGroup==="candidate" && request.method()==="GET" && url.path==="/api/users") {
        repUserRequests.push(row); void durable("rep-user-list-requests.ndjson",row);
      }
    });
    page.on("response", response => {
      const request = response.request(), requestId = requestIds.get(request) ?? `${sessionId}-pw-unpaired-${++requestSeq}`;
      const req = pwrRequests.findLast(row=>row.requestId===requestId);
      const row = { type:"playwright-response",requestId,role,phase:req?.phase ?? phaseRef.value,phaseGroup,
        method:request.method(),url:safeUrl(response.url()),pagePathAtInitiation:req?.pagePathAtInitiation ?? safeUrl(page.url()).path,
        status:response.status(),statusText:safeText(response.statusText()),observedAt:new Date().toISOString(),reason:null };
      pwrResponses.push(row);
      const task = (async()=>{
        if (badStatuses.has(row.status)) {
          try {
            const body = await response.json();
            if (body && typeof body==="object") row.reason = Object.fromEntries(["error","message","reason","code","detail","title","status"]
              .filter(k=>typeof body[k]==="string"||typeof body[k]==="number").map(k=>[k,safeText(body[k])]));
            else row.reason = {bodyOmitted:"non-object JSON"};
          } catch { row.reason={bodyOmitted:"unavailable"}; }
        }
        await durable("http-status-events.ndjson",row);
      })();
      pendingBodies.add(task); task.finally(()=>pendingBodies.delete(task));
    });
    page.on("requestfailed", request=>{
      const row={requestId:requestIds.get(request)??null,role,phase:phaseRef.value,method:request.method(),url:safeUrl(request.url()),
        pagePath:safeUrl(page.url()).path,failure:safeText(request.failure()?.errorText),observedAt:new Date().toISOString()};
      requestFailures.push(row); void durable("request-failures.ndjson",row);
    });
    page.on("console", message=>{
      if(message.type()!=="error")return;
      const loc=message.location(),row={eventId:`console-${sessionId}-${consoleErrors.length+1}`,role,phase:phaseRef.value,
        phaseGroup,pagePath:safeUrl(page.url()).path,message:safeText(message.text()),observedAt:new Date().toISOString(),
        location:{url:loc.url?safeUrl(loc.url):null,lineNumber:loc.lineNumber,columnNumber:loc.columnNumber}};
      consoleErrors.push(row); void durable("console-events.ndjson",row);
    });
    page.on("pageerror", error=>{
      const row={eventId:`pageerror-${sessionId}-${pageErrors.length+1}`,role,phase:phaseRef.value,
        phaseGroup,pagePath:safeUrl(page.url()).path,message:safeText(error.message),observedAt:new Date().toISOString()};
      pageErrors.push(row); void durable("page-errors.ndjson",row);
    });
    return page.context().newCDPSession(page).then(async cdp=>{
      await cdp.send("Network.enable");
      cdp.on("Network.requestWillBeSent",event=>{
        const u=safeUrl(event.request.url),id=`${sessionId}-cdp-${++cdpSeq}`;
        const row={type:"cdp-request",stableCdpRequestId:id,cdpRequestId:event.requestId,role,phase:phaseRef.value,phaseGroup,
          method:event.request.method,url:u,pagePathAtInitiation:event.type==="Document"?u.path:safeUrl(page.url()).path,
          observedAt:new Date().toISOString()};
        cdpMeta.set(event.requestId,row); cdpRequests.push(row); void durable("cdp-network-events.ndjson",row);
      });
      cdp.on("Network.responseReceived",event=>{
        const req=cdpMeta.get(event.requestId),row={type:"cdp-response",stableCdpRequestId:req?.stableCdpRequestId??`${sessionId}-cdp-orphan-${++cdpSeq}`,
          cdpRequestId:event.requestId,role,phase:req?.phase??phaseRef.value,phaseGroup,method:req?.method??null,url:safeUrl(event.response.url),
          pagePathAtInitiation:req?.pagePathAtInitiation??safeUrl(page.url()).path,status:event.response.status,
          statusText:safeText(event.response.statusText),observedAt:new Date().toISOString()};
        cdpResponses.push(row); void durable("cdp-network-events.ndjson",row);
      });
      return cdp;
    });
  }
  async function installBaselineStaticRoute(context) {
    await context.route("**/*",async route=>{
      const url=new URL(route.request().url());
      if(url.origin!==fixture.url||url.pathname.startsWith("/api/"))return route.continue();
      const isHtml=route.request().resourceType()==="document"||route.request().headers().accept?.includes("text/html");
      if(!isHtml&&!/\.(?:js|css|woff2?|png|svg|webp|ico|jpg|json|webmanifest)$/.test(url.pathname))return route.continue();
      const path=isHtml?"index.html":decodeURIComponent(url.pathname).replace(/^\//,"");
      if(path.split("/").includes(".."))throw new Error(`Unsafe baseline asset path: ${path}`);
      try{
        const bytes=await readFile(join(baselineRoot,path)),ext=path.split(".").pop();
        const types={html:"text/html",js:"application/javascript",css:"text/css",svg:"image/svg+xml",png:"image/png",ico:"image/x-icon",woff2:"font/woff2",jpg:"image/jpeg",webp:"image/webp",json:"application/json",webmanifest:"application/manifest+json"};
        await route.fulfill({status:200,contentType:types[ext]||"application/octet-stream",body:bytes});
      }catch(error){throw new Error(`Missing immutable baseline asset ${path}: ${error.message}`);}
    });
  }
  async function capturePhase(phaseName) {
    const outputMap={}, exemptions={};
    const outcomes=await Promise.allSettled(roles.map(async role=>{
      const context=await browser.newContext({viewport:{width:1440,height},colorScheme:"light",reducedMotion:"reduce",serviceWorkers:"block"});
      try{
        if(phaseName==="baseline")await installBaselineStaticRoute(context);
        const page=await context.newPage();page.setDefaultTimeout(15000);
        const phaseRef={value:`${phaseName}:login`};const traceId=randomUUID();
        const cdp=await addTrace(page,role,phaseRef,phaseName,traceId);
        await fixture.login(page,role);
        for(const width of widths){
          await page.setViewportSize({width,height});
          for(const [name,path] of structuralPages){
            phaseRef.value=`${phaseName}:${name}:${width}`;
            await page.goto(fixture.url+path);
            await waitForPage(page,name);
            const inv=await inventoryFromDom(page),key=`${name}-${width}-${role}`;
            outputMap[key]=inv.controls;exemptions[key]=inv.exemptions;
            await updateProgress({phase:phaseName,role,page:name,width,status:"completed",controls:inv.controls.length,exemptions:inv.exemptions.length});
          }
        }
        await cdp.detach().catch(()=>{});
      }finally{await context.close();}
    }));
    const failure=outcomes.find(x=>x.status==="rejected");if(failure)throw failure.reason;
    rolesData[phaseName]={controls:outputMap,exemptions};
  }
  function countExact(list,spec){return list.filter(item=>JSON.stringify(item)===JSON.stringify(spec)).length;}
  function compareStructure(){
    const cases=Object.keys(rolesData.baseline.controls);
    check(cases.length===36,"Baseline inventory must contain exactly 36 control captures.");
    check(Object.keys(rolesData.candidate.controls).length===36,"Candidate inventory must contain exactly 36 control captures.");
    const additions=policy.approvedStructuralExceptionCategories.slice(0,2),retry=policy.approvedStructuralExceptionCategories[2];
    const additionCaseSets=additions.map(x=>new Set(x.cases)),retryCases=new Set(retry.cases);
    const rows=[],additionAudit=[],retryAudit=[];
    for(const key of cases){
      const baseline=[...rolesData.baseline.controls[key]],candidate=[...rolesData.candidate.controls[key]];
      for(let i=0;i<2;i++){
        const spec=additions[i].control,n=countExact(candidate,spec),expected=additionCaseSets[i].has(key)?1:0;
        additionAudit.push({case:key,category:additions[i].id,expected,actual:n,pass:n===expected});
        if(n===1&&expected===1)candidate.splice(candidate.findIndex(x=>JSON.stringify(x)===JSON.stringify(spec)),1);
      }
      if(retryCases.has(key)){
        const b=countExact(baseline,retry.control),c=countExact(candidate,retry.control);
        retryAudit.push({case:key,baselineExpected:1,baselineActual:b,candidateExpected:0,candidateActual:c,pass:b===1&&c===0});
        if(b===1)baseline.splice(baseline.findIndex(x=>JSON.stringify(x)===JSON.stringify(retry.control)),1);
      }else{
        check(countExact(rolesData.candidate.controls[key],retry.control)===countExact(rolesData.baseline.controls[key],retry.control),
          `Retry control changed outside exact approved removal cases: ${key}`);
      }
      rows.push({case:key,controlsEqual:JSON.stringify(baseline)===JSON.stringify(candidate),
        exemptionsEqual:JSON.stringify(rolesData.baseline.exemptions[key])===JSON.stringify(rolesData.candidate.exemptions[key]),
        normalizedBaselineCount:baseline.length,normalizedCandidateCount:candidate.length});
    }
    check(additionAudit.length===72&&additionAudit.every(x=>x.pass),"Search-referrer/share-referral approved additions differ outside the exact 12 occurrences.");
    check(retryAudit.length===4&&retryAudit.every(x=>x.pass),"Rep Retry removal differs outside the exact four baseline occurrences.");
    check(rows.every(x=>x.controlsEqual&&x.exemptionsEqual),"Unapproved control/inventory difference; see structural-comparison.json.");
    return {caseCount:rows.length,pass:true,approvedStructuralExceptionCategories:3,additions:additionAudit,retryRemoval:retryAudit,rows};
  }
  async function waitRoute(page,name){
    const known=["dashboard","leads","lead-detail","pipeline","apply","settings","documents","campaigns"];
    if(known.includes(name))await waitForPage(page,name);
    else {
      await appReady(page);
      if(name==="campaign-detail")return;
      const headings={"new-deal":/New Deal/,"credit-compliance":/Credit|Compliance/i,"governance":/Governance/i,
        "deal-detail":/Deal/i};
      if(headings[name])await page.locator("h1").filter({hasText:headings[name]}).first().waitFor({timeout:8000}).catch(()=>{});
    }
  }
  async function captureRepPolicy(){
    const context=await browser.newContext({viewport:{width:1440,height},colorScheme:"light",reducedMotion:"reduce",serviceWorkers:"block"});
    try{
      const page=await context.newPage();page.setDefaultTimeout(15000);
      const phaseRef={value:"candidate:rep-policy:login"},cdp=await addTrace(page,"rep",phaseRef,"candidate",randomUUID());
      await fixture.login(page,"rep");
      const audit=[];
      let repCampaignManagerGate=null;
      for(const [name,path,readyName] of repPolicyRoutes){
        phaseRef.value=`candidate:rep-policy:${name}`;
        await page.goto(fixture.url+path);await waitRoute(page,readyName);
        if(name==="campaign-audience"){
          const expected=policy.historicalCampaign.repRouteExpectation;
          check(path===expected.path,"Rep campaign denial route differs from frozen policy.");
          const denied=page.getByRole("heading",{name:expected.heading,exact:true});
          await denied.waitFor({timeout:12000});
          const supportPrefixes=expected.supportingApiPathPrefixes;
          const supportRequests=pwrRequests.filter(r=>r.role==="rep"&&r.phase==="candidate:rep-policy:campaign-audience"
            &&supportPrefixes.some(prefix=>r.url.path.startsWith(prefix)));
          check(supportRequests.length===expected.campaignSupportRequests,`Denied rep campaign route issued child/support API requests: ${JSON.stringify(supportRequests)}`);
          repCampaignManagerGate={renderedDeniedUi:true,heading:await denied.innerText(),supportingRequestCount:supportRequests.length,
            supportPrefixesChecked:supportPrefixes};
        }
        const controls=await directoryPickerInventory(page);
        const pagePath=safeUrl(page.url()).path;
        const row={route:name,requestedPath:path,renderedPath:pagePath,controls,
          ...(name==="campaign-audience"?{repCampaignManagerGate}: {})};
        audit.push(row);await durable("role-policy-events.ndjson",{...row,at:new Date().toISOString()});
        check(controls.length===0,`Rep directory filter/assignee control visible on ${name} (${pagePath}): ${JSON.stringify(controls)}`);
      }
      await cdp.detach().catch(()=>{});
      return {routes:audit,repCampaignManagerGate,repGetUsersRequests:repUserRequests.filter(r=>r.phaseGroup==="candidate")};
    }finally{await context.close();}
  }
  async function managerAdminRetention(role){
    const context=await browser.newContext({viewport:{width:1440,height},colorScheme:"light",reducedMotion:"reduce",serviceWorkers:"block"});
    try{
      const page=await context.newPage();page.setDefaultTimeout(15000);
      const phaseRef={value:`candidate:${role}-retention:login`},cdp=await addTrace(page,role,phaseRef,"candidate",randomUUID());
      await fixture.login(page,role);
      phaseRef.value=`candidate:${role}-retention:leads`;await page.goto(fixture.url+"/leads");await waitForPage(page,"leads");
      const filter=page.getByRole("button",{name:"Filter by representative",exact:true});
      await filter.waitFor();check(await filter.isEnabled(),`${role} representative filter is disabled`);
      await filter.click();
       await page.getByRole("option").filter({hasText:"Visual Fixture"}).first().waitFor();
      const opts=await page.getByRole("option").allTextContents();
      check(opts.some(x=>x.includes("Visual Fixture")),`${role} directory filter has no fixture representative option: ${JSON.stringify(opts)}`);
      await page.getByRole("option").filter({hasText:"Visual Fixture"}).first().click();
      await recordJourney(`${role}-representative-filter-retained`,"passed",{options:opts});
      phaseRef.value=`candidate:${role}-retention:new-deal`;await page.goto(fixture.url+"/deals/new");await waitRoute(page,"new-deal");
      const assigned=page.locator("label").filter({hasText:/^Assigned rep$/}).first();
      await assigned.waitFor();const picker=page.getByRole("button",{name:"Unassigned",exact:true});
      await picker.waitFor();check(await picker.isEnabled(),`${role} new-deal assignee picker is disabled`);
      await picker.click();
       await page.getByRole("option").filter({hasText:"Visual Fixture"}).first().waitFor();
      const pickerOptions=await page.getByRole("option").allTextContents();
      check(pickerOptions.some(x=>x.includes("Visual Fixture")),`${role} assignee picker has no fixture representative`);
      await page.getByRole("option",{name:"Unassigned",exact:true}).click();
      await recordJourney(`${role}-assignee-picker-retained`,"passed",{options:pickerOptions});
      phaseRef.value=`candidate:${role}-retention:deal-edit`;await page.goto(fixture.url+"/deals/1");await waitRoute(page,"deal-detail");
      const editButton=page.getByRole("button",{name:"Edit Details",exact:true});await editButton.waitFor();await editButton.click();
      const editAssigned=page.locator("label").filter({hasText:/^Assigned rep$/}).first();await editAssigned.waitFor();
      const editPicker=editAssigned.locator("xpath=..").getByRole("button").first();await editPicker.waitFor();
      check(await editPicker.isEnabled(),`${role} edit-deal assignee picker is disabled`);
      await editPicker.click();
       await page.getByRole("option").filter({hasText:"Visual Fixture"}).first().waitFor();
      const editOptions=await page.getByRole("option").allTextContents();
      check(editOptions.some(x=>x.includes("Visual Fixture")),`${role} edit-deal picker has no fixture representative`);
      await page.getByRole("option").filter({hasText:"Visual Fixture"}).first().click();
      await page.getByRole("button",{name:"Cancel",exact:true}).click();
      await recordJourney(`${role}-edit-deal-picker-retained`,"passed",{options:editOptions,noSave:true});
      phaseRef.value=`candidate:${role}-retention:credit-compliance`;await page.goto(fixture.url+"/credit/compliance");await waitRoute(page,"credit-compliance");
      let creditOptions=[];
      if(role==="admin"){
        const creditFilter=page.getByRole("button",{name:"Filter by representative",exact:true});
        await creditFilter.waitFor();check(await creditFilter.isEnabled(),`${role} credit-compliance filter is disabled`);
        await creditFilter.click();
        await page.getByRole("option").filter({hasText:"Visual Fixture"}).first().waitFor();
        creditOptions=await page.getByRole("option").allTextContents();
        check(creditOptions.some(x=>x.includes("Visual Fixture")),`${role} credit-compliance filter has no fixture representative option`);
        await page.getByRole("option",{name:"All Reps",exact:true}).click();
        await recordJourney(`${role}-credit-filter-retained`,"passed",{options:creditOptions});
      }else{
        await page.getByRole("heading",{name:"Admin Access Required",exact:true}).waitFor();
        check((await directoryPickerInventory(page)).length===0,"Manager must not see the admin-only credit-compliance directory filter.");
        await recordJourney(`${role}-credit-compliance-admin-gate`,"passed");
      }
      await cdp.detach().catch(()=>{});
      return {role,leadsFilterEnabled:true,leadsFixtureOption:opts.find(x=>x.includes("Visual Fixture")),
        newDealPickerEnabled:true,newDealFixtureOption:pickerOptions.find(x=>x.includes("Visual Fixture")),
        editDealPickerEnabled:true,editDealFixtureOption:editOptions.find(x=>x.includes("Visual Fixture")),
        creditFilterEnabled:role==="admin",creditFixtureOption:creditOptions.find(x=>x.includes("Visual Fixture")),
        creditAdminGate:role==="manager"};
    }finally{await context.close();}
  }
  async function leadsJourney() {
    const context=await browser.newContext({viewport:{width:1440,height},colorScheme:"light",reducedMotion:"reduce",serviceWorkers:"block"});
    try{
      const page=await context.newPage();page.setDefaultTimeout(15000);
      const phaseRef={value:"candidate:leads-journey:login"},cdp=await addTrace(page,"admin",phaseRef,"candidate",randomUUID());
      await fixture.login(page,"admin");
      phaseRef.value="candidate:leads-journey:search";
      await page.goto(fixture.url+"/leads");await waitForPage(page,"leads");
      const search=page.getByPlaceholder("Search by name, email, company…",{exact:true});
      await search.fill("Synthetic Contact");
      await page.waitForFunction(()=>{const r=[...document.querySelectorAll('[data-testid="table-leads-fit"] tbody tr')];return r.length===1&&r[0].textContent.includes("Synthetic Contact");});
      await recordJourney("lead-search-name","passed");
      await search.fill("Fixture Services LLC");
      await page.waitForFunction(()=>{const r=[...document.querySelectorAll('[data-testid="table-leads-fit"] tbody tr')];return r.length===1&&r[0].textContent.includes("Fixture Services LLC");});
      await recordJourney("lead-search-company","passed");
      await search.fill("");
      const rows=page.locator('[data-testid="table-leads-fit"] tbody tr');
      await page.waitForFunction(()=>document.querySelectorAll('[data-testid="table-leads-fit"] tbody tr').length===2);
      const combos=page.getByRole("combobox");
      await combos.nth(0).click();await page.getByRole("option",{name:"Contacted",exact:true}).click();
      await page.waitForFunction(()=>document.querySelectorAll('[data-testid="table-leads-fit"] tbody tr').length===1);
      await recordJourney("lead-status-filter","passed");
      await combos.nth(0).click();await page.getByRole("option",{name:"All Statuses",exact:true}).click();
      await combos.nth(1).click();await page.getByRole("option",{name:"Equipment",exact:true}).click();
      await page.waitForFunction(()=>document.querySelectorAll('[data-testid="table-leads-fit"] tbody tr').length===1);
      await recordJourney("lead-type-filter","passed");
      await combos.nth(1).click();await page.getByRole("option",{name:"All Types",exact:true}).click();
      await page.waitForFunction(()=>document.querySelectorAll('[data-testid="table-leads-fit"] tbody tr').length===2);
      const repFilter=page.getByRole("button",{name:"Filter by representative",exact:true});
      await repFilter.click();
      const repOptions=await page.getByRole("option").allTextContents();
      check(repOptions.some(x=>x.includes("Visual Fixture")),`Admin rep-filter option missing: ${JSON.stringify(repOptions)}`);
      await page.getByRole("option").filter({hasText:"Visual Fixture"}).first().click();
      await page.waitForFunction(()=>document.querySelectorAll('[data-testid="table-leads-fit"] tbody tr').length===2);
      await recordJourney("lead-representative-filter","passed",{options:repOptions});
      const oldestRequest=page.waitForRequest(request=>{
        try{return new URL(request.url()).searchParams.get("sortOrder")==="asc";}catch{return false;}
      });
      await combos.last().click();await page.getByRole("option",{name:"Oldest First",exact:true}).click();
      const sortRequest=await oldestRequest;
      check(new URL(sortRequest.url()).searchParams.get("sortOrder")==="asc","Oldest First did not request ascending order.");
      await recordJourney("lead-oldest-sort","passed",{request:safeUrl(sortRequest.url())});
      await page.goto(fixture.url+"/leads");await waitForPage(page,"leads");
      const row=rows.filter({hasText:"Synthetic Contact"});
      const blank=await row.evaluate(tr=>{for(const td of tr.cells){for(const [x,y] of [[td.getBoundingClientRect().left+3,td.getBoundingClientRect().top+3],[td.getBoundingClientRect().right-3,td.getBoundingClientRect().bottom-3]])if(document.elementFromPoint(x,y)===td)return{x,y};}return null;});
      check(blank,"Could not identify blank lead-row background");
      const before=page.url();await page.mouse.click(blank.x,blank.y);check(page.url()===before,"Blank row background unexpectedly navigated");
      await recordJourney("lead-blank-row-noop","passed");
      const phone=row.locator('a[href^="tel:"]');
      check(await phone.count()>0,"Lead table phone link missing.");
      const phoneHref=await phone.first().getAttribute("href");
      await page.evaluate(()=>{window.__telClicks=[];document.addEventListener("click",event=>{const link=event.target.closest?.('a[href^="tel:"]');if(link){event.preventDefault();window.__telClicks.push(link.href);}},true);});
      const beforePhone=page.url();await phone.first().click();
      check(page.url()===beforePhone&&(await page.evaluate(()=>window.__telClicks)).length===1,"Phone link did not remain in Leads and trigger the test interception.");
      await recordJourney("lead-phone-action","passed",{href:phoneHref});
      const email=row.locator('[data-contact-link="email"]');await email.click();await page.waitForURL(/\/leads\/1/);
      await page.getByRole("tab",{name:/^Comms/}).waitFor();await recordJourney("lead-email-opens-comms","passed");
      const detailPhone=page.locator('a[href^="tel:"]');
      check(await detailPhone.count()>0,"Lead detail phone action missing.");
      const beforeDetailPhone=page.url();await detailPhone.first().click();
      check(page.url()===beforeDetailPhone,"Lead-detail phone action navigated away.");
      await recordJourney("lead-detail-phone-action","passed");
      await page.goto(fixture.url+"/leads");await page.getByRole("link",{name:/Synthetic Contact/}).first().click();await page.waitForURL(/\/leads\/1/);
      await waitForPage(page,"lead-detail");await recordJourney("lead-name-link-opens-detail","passed");
      await page.goto(fixture.url+"/leads");await waitForPage(page,"leads");
      const companyRow=page.locator('[data-testid="table-leads-fit"] tbody tr').filter({hasText:"Synthetic Contact"});
      const companyLink=companyRow.getByRole("link").nth(1),companyHref=await companyLink.getAttribute("href");
      check(companyHref==="/leads/1",`Lead company link target changed: ${companyHref}`);
      await companyLink.click();await page.waitForURL(/\/leads\/1/);await waitForPage(page,"lead-detail");
      await recordJourney("lead-company-link-opens-detail","passed",{href:companyHref});
      phaseRef.value="candidate:leads-screenshots";
      for(const theme of ["light","dark"]){
        if(theme==="dark"){await page.goto(fixture.url+"/settings");await waitForPage(page,"settings");await page.getByLabel("Appearance theme").selectOption("dark");}
        for(const width of [390,768,1280,1440]){
          await page.setViewportSize({width,height});await page.goto(fixture.url+"/leads");await waitForPage(page,"leads");
          if(theme==="dark")check(await page.locator("html").getAttribute("data-appearance")==="dark","Dark Leads theme did not persist.");
          const geometry=await page.evaluate(()=>({viewportWidth:innerWidth,documentWidth:document.documentElement.scrollWidth,
            tableWidth:document.querySelector('[data-testid="table-leads-fit"] table')?.getBoundingClientRect().width??null}));
          const name=`leads-${width}-${theme}.png`;await page.screenshot({path:join(output,"screenshots",name)});
          screenshots.push(`screenshots/${name}`);await recordJourney(`leads-screenshot-${width}-${theme}`,"passed",{geometry});
        }
      }
      check(screenshots.length===8,"Expected exactly eight new Leads screenshots.");
      await cdp.detach().catch(()=>{});
    }finally{await context.close();}
  }
  const q = value => `'${String(value).replaceAll("'","''")}'`;
  const ts = value => value==null?"NULL":`${q(value.replace("T"," "))}::timestamp`;
  const tz = value => value==null?"NULL":`${q(value)}::timestamptz`;
  async function campaignSql({validateOnly=false}={}) {
    const sourcePath=historicalCampaignFixture;
    const sourceBytes=await readFile(sourcePath),historical=JSON.parse(sourceBytes);
    check(historical.campaign?.id===5&&historical.campaign?.status==="completed"&&historical.launches?.length===1
      &&historical.recipients?.length===13&&historical.sends?.length===13,"Historical campaign fixture row counts changed.");
    const dbName=fixture.query("SELECT current_database()");
    check(/^visual_refresh_fixture_\d+_\d+$/.test(dbName),"Campaign writes require a fresh guarded fixture DB.");
    const dbUrl=new URL(process.env.DATABASE_URL);dbUrl.pathname=`/${dbName}`;
    const leadsBySource=new Map([...new Set(historical.recipients.map(row=>row.lead_id))].map((id,index)=>[id,index+3]));
    const sql=[];
    for(const [sourceId,id] of leadsBySource){
      const n=id-2,ordinal=String(n).padStart(2,"0");
      sql.push(`INSERT INTO leads(id,first_name,last_name,email,phone,company_name,application_type,status,assigned_rep_id,lead_source,created_at,updated_at)
        VALUES (${id},'Historical','Fixture Recipient ${ordinal}',${q(`historical-recipient-${ordinal}@example.invalid`)},
        ${q(`+1202555${String(100+n).padStart(4,"0")}`)},${q(`Synthetic Campaign Recipient ${ordinal}`)},'equipment','contacted',3,'manual',now(),now());`);
    }
    const c=historical.campaign,launch=historical.launches[0];
    sql.push(`INSERT INTO campaigns(id,name,channel,status,email_template_id,audience_rules,scheduled_at,launched_at,completed_at,owner_id,created_by,version,created_at,updated_at,tracking_since,reply_to_email,flyer_delivery_mode)
      VALUES (5,${q(c.name)},${q(c.channel)},${q(c.status)},1,'{}'::jsonb,${tz(c.scheduled_at)},${tz(c.launched_at)},${tz(c.completed_at)},1,1,${c.version},${tz(c.created_at)},${tz(c.updated_at)},NULL,'fixture-replies@example.invalid',${q(c.flyer_delivery_mode)});`);
    sql.push(`INSERT INTO campaign_launches(id,campaign_id,idempotency_key,requested_by,mode,status,eligible_count,excluded_count,sent_count,failed_count,scheduled_at,started_at,completed_at,created_at)
      VALUES (5,5,'historical-fixture-launch-5',1,${q(launch.mode)},${q(launch.status)},${launch.eligible_count},${launch.excluded_count},${launch.sent_count},${launch.failed_count},${tz(launch.scheduled_at)},${tz(launch.started_at)},${tz(launch.completed_at)},${tz(launch.created_at)});`);
    for(const send of historical.sends){
      const id=leadsBySource.get(send.lead_id),ordinal=String(id-2).padStart(2,"0");
      sql.push(`INSERT INTO email_sends(id,lead_id,user_id,template_id,subject,to_email,from_email,status,sendgrid_message_id,sent_at,opened_at,clicked_at,created_at,updated_at,campaign_id,campaign_launch_id,delivery_kind)
        VALUES (${send.id},${id},1,1,${q("Vendors — Heavy Equipment (synthetic historical fixture)")},${q(`historical-recipient-${ordinal}@example.invalid`)},'fixture-sender@example.invalid',
        ${q(send.status)},NULL,${ts(send.sent_at)},${ts(send.opened_at)},${ts(send.clicked_at)},${ts(send.created_at)},${ts(send.updated_at)},5,5,${q(send.delivery_kind)});`);
    }
    for(const recipient of historical.recipients){
      sql.push(`INSERT INTO campaign_recipients(id,launch_id,campaign_id,lead_id,channel,status,exclusion_reason,available_at,email_send_id,sent_at,created_at)
        VALUES (${recipient.id},5,5,${leadsBySource.get(recipient.lead_id)},${q(recipient.channel)},${q(recipient.status)},${recipient.exclusion_reason==null?"NULL":q(recipient.exclusion_reason)},
        ${tz(recipient.available_at)},${recipient.email_send_id},NULL,${tz(recipient.created_at)});`);
    }
    for(const [table,value] of [["leads",15],["campaigns",5],["campaign_launches",5],["campaign_recipients",26],["email_sends",45]])
      sql.push(`SELECT setval(pg_get_serial_sequence('${table}','id'),${value},true);`);
    if(validateOnly){
      const checked=spawnSync("psql",[`--dbname=${dbUrl}`,"--no-psqlrc","--set=ON_ERROR_STOP=on","--command",`BEGIN;\n${sql.join("\n")}\nROLLBACK;`],{encoding:"utf8"});
      check(checked.status===0,`Campaign SQL transaction validation failed: ${safeText(checked.stderr?.slice(-1200))}`);
      await atomicJson("campaign-sql-preflight.json",{status:"PASS",fixtureDatabase:dbName,generatedStatements:sql.length,
        transaction:"BEGIN; complete generated SQL; ROLLBACK",beforeBrowser:true,sourceSha256:createHash("sha256").update(sourceBytes).digest("hex")});
      return {historical,dbName,sourceBytes,leadsBySource};
    }
    const inserted=spawnSync("psql",[`--dbname=${dbUrl}`,"--no-psqlrc","--set=ON_ERROR_STOP=on","--single-transaction","--command",sql.join("\n")],{encoding:"utf8"});
    check(inserted.status===0,`Campaign fixture insert failed: ${safeText(inserted.stderr?.slice(-1200))}`);
    const verify=JSON.parse(fixture.query("SELECT row_to_json(q) FROM (SELECT c.id,c.status,c.owner_id,c.created_by,l.requested_by,l.sent_count,(SELECT count(*) FROM campaign_recipients r WHERE r.campaign_id=c.id AND r.status='sent') AS recipient_sent,(SELECT count(*) FROM email_sends e WHERE e.campaign_id=c.id AND e.status IN ('delivered','opened','clicked')) AS email_sent,(SELECT count(*) FROM campaign_recipients r WHERE r.campaign_id=c.id AND r.sent_at IS NULL) AS recipient_sent_at_null,(SELECT count(*) FROM email_sends e WHERE e.campaign_id=c.id AND e.sent_at IS NOT NULL) AS email_sent_at_retained FROM campaigns c JOIN campaign_launches l ON l.campaign_id=c.id WHERE c.id=5) q"));
    check(verify.id===5&&verify.status==="completed"&&Number(verify.sent_count)===13&&Number(verify.recipient_sent)===13
      &&Number(verify.owner_id)===1&&Number(verify.created_by)===1&&Number(verify.requested_by)===1
      &&Number(verify.email_sent)===13&&Number(verify.recipient_sent_at_null)===13&&Number(verify.email_sent_at_retained)===13,
      `Campaign fixture row verification failed: ${JSON.stringify(verify)}`);
    await atomicJson("campaign-fixture-verification.json",{fixtureDatabase:dbName,campaignId:5,launches:1,recipients:13,sends:13,
      appropriateHistoricalOwnership:{ownerFixtureUserId:1,creatorFixtureUserId:1,launchRequesterFixtureUserId:1},verification:verify,
      sourceSha256:createHash("sha256").update(sourceBytes).digest("hex"),productionDataRehearsalCertified:false});
    return {historical,dbName,sourceBytes,leadsBySource};
  }
  function crossSourceAudit() {
    const candidatePwr=pwrResponses.filter(r=>r.phaseGroup==="candidate"),candidateCdp=cdpResponses.filter(r=>r.phaseGroup==="candidate");
    const join=(cdp,candidates)=>{
      const m=candidates.filter(p=>p.role===cdp.role&&p.phase===cdp.phase&&p.method===cdp.method&&p.status===cdp.status
        &&p.url?.origin===cdp.url?.origin&&p.url?.path===cdp.url?.path&&p.pagePathAtInitiation===cdp.pagePathAtInitiation
        &&Math.abs(Date.parse(p.observedAt)-Date.parse(cdp.observedAt))<=1200);
      return {cdpStableRequestId:cdp.stableCdpRequestId,matchedPlaywrightRequestIds:m.map(x=>x.requestId),
        matchConfidence:m.length===1?"unique tuple/time correlation":m.length>1?"ambiguous multiple canonical requests":"unmatched"};
    };
    return {candidateCanonicalPlaywrightResponses:candidatePwr.length,candidateUniqueRequestIds:new Set(candidatePwr.map(x=>x.requestId)).size,
      candidateCdpResponses:candidateCdp.length,candidateUniqueCdpRequestIds:new Set(candidateCdp.map(x=>x.stableCdpRequestId)).size,
      cdpToPlaywright:candidateCdp.map(row=>join(row,candidatePwr)),
      model:"Playwright Request objects receive stable per-session requestId values and are canonical for unique HTTP counts. CDP session/request IDs are stored independently and never appended as a second request. Exact tuple/time links are evidence-only."};
  }
  async function campaignJourney(page,phaseRef){
    phaseRef.value="candidate:campaign-results";
    const resultsPromise=page.waitForResponse(r=>r.url().includes("/api/campaigns/5/results"));
    const metricsPromise=page.waitForResponse(r=>r.url().includes("/api/campaigns/5/metrics"));
    await page.goto(fixture.url+"/campaigns/5");
    await page.getByText("Vendors — Heavy Equipment",{exact:true}).first().waitFor();
    await page.getByRole("tab",{name:"Results",exact:true}).click();
    const [resultsResponse,metricsResponse]=await Promise.all([resultsPromise,metricsPromise]);
    check(resultsResponse.status()===200&&metricsResponse.status()===200,`Campaign APIs must both be 200: ${resultsResponse.status()}/${metricsResponse.status()}`);
    const results=await resultsResponse.json(),metrics=await metricsResponse.json();
    check(results.counts.sent===13&&results.launches?.length===1,`Campaign Results counts differ: ${JSON.stringify(results.counts)}`);
    check(metrics.sent===13&&metrics.trackingSince==null,`Campaign Metrics differs: ${JSON.stringify(metrics)}`);
    const legacy=page.getByText("Sent",{exact:true}).first().locator(".."),kpi=page.getByTestId("kpi-sent");
    await page.getByText("Campaign Results",{exact:true}).waitFor();await kpi.waitFor();
    check((await legacy.innerText()).includes("13")&&(await kpi.innerText()).includes("13"),"Legacy and new Sent KPIs must both show 13.");
    const panel=page.getByTestId("panel-campaign-kpis");
    check((await panel.innerText()).includes("Historical tracking not available"),"Historical tracking disclosure missing.");
    check((await page.getByTestId("kpi-uniqueClicks").innerText()).includes("Not tracked")
      &&(await page.getByTestId("kpi-replies").innerText()).includes("Not tracked"),"Unknown historical metrics must say Not tracked.");
    const image="screenshots/campaign-5-results.png";await page.screenshot({path:join(output,image),fullPage:true});screenshots.push(image);
    await recordJourney("campaign-results-sent13","passed",{resultsStatus:resultsResponse.status(),metricsStatus:metricsResponse.status(),
      resultsCounts:results.counts,launches:results.launches.length,metricsSent:metrics.sent,legacySent:await legacy.innerText(),kpiSent:await kpi.innerText(),screenshot:image});
  }

  try {
    await readyGate();
    await mkdir(output,{recursive:false});outputInitialized.value=true;await mkdir(join(output,"screenshots"));
    await atomicJson("authorization-used.json",{...lock,authorizationFile:"launch-authorization.json",verifiedAt:new Date().toISOString()});
    await atomicJson("policy-used.json",policy);
    await atomicJson("run-progress.json",state);
    await phase("source-and-sandbox-proof");
    const sandboxSource=await readFile(join(root,"scripts/visual-refresh/sandbox.mjs"),"utf8");
    check(sandboxSource.includes("pg_dump")&&sandboxSource.includes("--schema-only")&&sandboxSource.includes("TWILIO_")
      &&sandboxSource.includes("SENDGRID_")&&sandboxSource.includes("DISABLE_BACKGROUND_JOBS"),
      "Fixture must remain schema-only, strip provider credentials, and disable background jobs.");
    sourceProof={sandboxSchemaOnly:true,providerCredentialStripping:true,backgroundJobsDisabled:true,
      files:["scripts/visual-refresh/sandbox.mjs","artifacts/mbs-crm/src","artifacts/api-server/src","artifacts/api-server/dist"],
      webSourceTreeSha256:lock.candidateWebSourceTreeSha256,apiSourceTreeSha256:lock.candidateApiSourceTreeSha256,
      sourceFinalizedRevision:lock.targetRevision};
    await atomicJson("fixture-source-proof.json",sourceProof);
    fixture=await startSandbox({build:false,webRoot:resolve(root,lock.candidateWebRoot),port:lock.port});
    fixtureDbName=fixture.query("SELECT current_database()");
    check(/^visual_refresh_fixture_\d+_\d+$/.test(fixtureDbName),"Unexpected fixture database name.");
    await phase("fixture-ready",{fixtureDatabase:fixtureDbName,fixtureUrl:fixture.url,providerCredentialsRemoved:true});
    await campaignSql({validateOnly:true});
    const campaignData=await campaignSql();
    await phase("campaign-fixture-seeded",{campaignId:campaignData.historical.campaign.id,launches:1,recipients:13,sends:13});
    browser=await chromium.launch({executablePath:"/repl/tools/bin/chromium",headless:true});
    await phase("capture-baseline-36");
    await capturePhase("baseline");
    await phase("capture-candidate-36");
    await capturePhase("candidate");
    const structure=compareStructure();
    await atomicJson("structure-comparison.json",structure);
    await phase("rep-role-policy-routes");
    const repPolicy=await captureRepPolicy();
    const retained=[];
    for(const role of ["manager","admin"])retained.push(await managerAdminRetention(role));
    await phase("leads-functional-checks-and-eight-screenshots");
    await leadsJourney();
    const journeyContext=await browser.newContext({viewport:{width:1440,height},colorScheme:"light",reducedMotion:"reduce",serviceWorkers:"block"});
    const page=await journeyContext.newPage();page.setDefaultTimeout(15000);const phaseRef={value:"candidate:campaign-login"};
    const cdp=await addTrace(page,"admin",phaseRef,"candidate",randomUUID());
    await fixture.login(page,"admin");await campaignJourney(page,phaseRef);await cdp.detach().catch(()=>{});await journeyContext.close();
    await Promise.allSettled([...pendingBodies]);await eventQueue;
    const candidateBadPwr=pwrResponses.filter(r=>r.phaseGroup==="candidate"&&badStatuses.has(r.status));
    const candidateBadCdp=cdpResponses.filter(r=>r.phaseGroup==="candidate"&&badStatuses.has(r.status));
    const candidateConsole=consoleErrors.filter(r=>r.phaseGroup==="candidate");
    const candidatePageErrors=pageErrors.filter(r=>r.phaseGroup==="candidate");
    const repReqs=repUserRequests.filter(r=>r.phaseGroup==="candidate");
    const audit=crossSourceAudit();
    const assertions={baseline36:rolesData.baseline&&Object.keys(rolesData.baseline.controls).length===36,
      candidate36:rolesData.candidate&&Object.keys(rolesData.candidate.controls).length===36,
      exactThreeStructuralExceptionCategories:structure.pass&&structure.approvedStructuralExceptionCategories===3,
      repDirectoryPolicyRoutesAllClear:repPolicy.routes.length===repPolicyRoutes.length&&repPolicy.routes.every(x=>x.controls.length===0),
      repCampaignHonestAccessGate:repPolicy.repCampaignManagerGate?.renderedDeniedUi===true
        &&repPolicy.repCampaignManagerGate.heading===policy.historicalCampaign.repRouteExpectation.heading
        &&repPolicy.repCampaignManagerGate.supportingRequestCount===policy.historicalCampaign.repRouteExpectation.campaignSupportRequests,
      candidateRepGetApiUsersZero:repReqs.length===0,
      managerAdminDirectoryControlsRetained:retained.length===2&&retained.every(row=>row?.leadsFilterEnabled&&row?.newDealPickerEnabled&&row?.editDealPickerEnabled)
        &&retained.find(row=>row.role==="admin")?.creditFilterEnabled&&retained.find(row=>row.role==="manager")?.creditAdminGate,
      candidateCanonicalBadHttpStatusesZero:candidateBadPwr.length===0&&audit.candidateCanonicalPlaywrightResponses===audit.candidateUniqueRequestIds,
      candidateRawCdpBadHttpStatusesZero:candidateBadCdp.length===0,
      candidateConsoleErrorsZero:candidateConsole.length===0,
      candidatePageExceptionsZero:candidatePageErrors.length===0,
      eightLeadsScreenshots:screenshots.filter(x=>x.startsWith("screenshots/leads-")).length===8,
      campaignResultsAndMetrics200Sent13:journeys.some(x=>x.step==="campaign-results-sent13"&&x.status==="passed")};
    const summary={status:Object.values(assertions).every(Boolean)?"PASS_SEPARATE_SCHEMA_ONLY_FIXTURE":"FAIL",
      targetRevision:lock.targetRevision,localSnapshot:lock.localSnapshot,baselineRevision,baselineTreeSha256:lock.baselineWebTreeSha256,
      candidateWebTreeSha256:lock.candidateWebTreeSha256,candidateApiDistSha256:lock.candidateApiDistSha256,
      assertions,structure,repDirectoryPolicy:repPolicy,managerAdminRetention:retained,
      runtime:{candidateCanonicalBadHttpStatuses:candidateBadPwr,candidateRawCdpBadHttpStatuses:candidateBadCdp,
        candidateConsoleErrors:candidateConsole,candidatePageErrors,candidateRepGetApiUsersRequests:repReqs,requestFailures,
        crossSourceAudit:audit,baselineBadHttpStatuses:pwrResponses.filter(r=>r.phaseGroup==="baseline"&&badStatuses.has(r.status)),
        baselineConsoleErrors:consoleErrors.filter(r=>r.phaseGroup==="baseline")},
      journeys,screenshots,sourceProof,fixtureDatabase:fixtureDbName,productionDataRehearsalCertified:false,
      singleRunClaim:"This runner's own stages only; prior 143/229 primitive console traces remain unattributed."};
    await atomicJson("role-directory-certification.json",summary);
    await atomicJson("structure-controls.json",rolesData);
    await atomicJson("journeys.json",journeys);
    await atomicJson("http-runtime-summary.json",audit);
    await phase("assertions-complete",{assertions});
    check(Object.values(assertions).every(Boolean),`Role-directory full certification assertions failed: ${JSON.stringify(assertions)}`);
    console.log(JSON.stringify(summary,null,2));
  } catch(error) {
    fatal=error;
    if(outputInitialized.value){
      await durable("events.ndjson",{type:"fatal",message:safeText(error?.stack??error),at:new Date().toISOString()}).catch(()=>{});
      await writeFile(join(output,"failure.txt"),`${error?.stack??String(error)}\n`).catch(()=>{});
    }
    console.error(safeText(error?.stack??error));process.exitCode=1;
  } finally {
    try{if(browser)await browser.close();}catch(error){fatal??=error;}
    try{if(fixture)await fixture.close();}catch(error){fatal??=error;}
    for(const userId of createdUsers){try{await clerkClient.users.deleteUser(userId);}catch(error){fatal??=error;}}
    if(fixtureDbName&&/^visual_refresh_fixture_\d+_\d+$/.test(fixtureDbName)){
      const drop=spawnSync("dropdb",["--if-exists","--force",`--maintenance-db=${process.env.DATABASE_URL}`,fixtureDbName],{encoding:"utf8"});
      if(drop.status!==0)fatal??=new Error(`Fixture drop failed: ${safeText(drop.stderr)}`);
    }
    if(outputInitialized.value){
      const cleanup={fixtureDatabase:fixtureDbName,fixtureDatabaseAbsent:false,createdSyntheticUsers:createdUsers.size,
        deletedAndAbsentUsers:0,verifiedAt:new Date().toISOString()};
      for(const id of createdUsers){try{await clerkClient.users.getUser(id);}catch(error){if(error?.status===404||/not found|already deleted/i.test(String(error?.message)))cleanup.deletedAndAbsentUsers++;}}
      if(fixtureDbName){
        const result=spawnSync("psql",[process.env.DATABASE_URL,"--no-psqlrc","--tuples-only","--no-align","--command",
          `SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname=${q(fixtureDbName)})`],{encoding:"utf8"});
        cleanup.fixtureDatabaseAbsent=result.status===0&&result.stdout.trim()==="f";
      }else cleanup.fixtureDatabaseAbsent=true;
      await atomicJson("cleanup-verification.json",cleanup);
      if(!cleanup.fixtureDatabaseAbsent||cleanup.deletedAndAbsentUsers!==cleanup.createdSyntheticUsers)fatal??=new Error("Fixture cleanup verification failed.");
      await Promise.allSettled([...pendingBodies]);await eventQueue.catch(()=>{});
      const summaryPath=join(output,"role-directory-certification.json");
      try{
        const report=JSON.parse(await readFile(summaryPath,"utf8"));report.cleanup=cleanup;
        if(fatal){report.status="FAIL";report.failure=safeText(fatal?.stack??fatal);}
        await atomicJson("role-directory-certification.json",report);
      }catch(error){if(error.code!=="ENOENT")fatal??=error;}
      state.status=fatal?"incomplete-or-failed":"finished";state.failure=fatal?safeText(fatal?.stack??fatal):null;state.updatedAt=new Date().toISOString();
      await atomicJson("run-progress.json",state).catch(()=>{});
      await writeFile(join(output,"task-exit-status.txt"),fatal?"1\n":"0\n").catch(()=>{});
    }
  }
  if(fatal)process.exitCode=1;
}
