import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { chromium } from "@playwright/test";
import { startSandbox } from "../visual-refresh/sandbox.mjs";

// Real signed-in app, isolated schema-only database and synthetic records.
// Delivery credentials and background jobs are disabled by startSandbox.
const root = resolve(import.meta.dirname, "../..");
const phase = process.argv[2] ?? "before";
const resumeAt = process.env.VIEWPORT_RESUME_AT;
const requestedCases=process.env.VIEWPORT_CASES?.split(",");
const contactsOnly=process.env.VIEWPORT_CONTACTS_ONLY==="1";
let resumeReached = !resumeAt;
const output = join(root, "reports/desktop-viewport", phase);
const webRoot = phase === "before"
  ? join(root, ".local/viewport-baseline/public")
  : join(root, "artifacts/mbs-crm/dist/public");
const port = phase === "before" ? 4380 : 4382;
await mkdir(output, { recursive: true });
const report = { phase, fixture: "isolated database, test Clerk, disabled deliveries", cases: [], failures: [] };
let fixture, browser;
function check(ok, message) { if (!ok) report.failures.push(message); }
async function geometry(page) {
  return page.evaluate(() => {
    const box = el => el?.getBoundingClientRect().toJSON();
    const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== "hidden";
    const table = [...document.querySelectorAll("table")].find(visible);
    const fitRegion = document.querySelector(".leads-fit-region");
    const rows = [...(table?.querySelectorAll("tbody tr") ?? [])];
    const content = document.querySelector("[data-desktop-content]") ?? document.querySelector("main > div:last-child");
    const next = [...document.querySelectorAll("button")].find(el => visible(el) && el.textContent.trim() === "Next");
    const footer = next?.parentElement?.parentElement;
    return {
      viewport: { width: innerWidth, height: innerHeight }, sidebarPinned: document.querySelector(".desktop-rail")?.getAttribute("data-pinned"),
      documentWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight,
      content: content && { width: content.clientWidth, scrollWidth: content.scrollWidth, height: content.clientHeight, scrollHeight: content.scrollHeight },
      table: table && { width: table.clientWidth, scrollWidth: table.scrollWidth, rect: box(table) },
      fitRegion: fitRegion && { clientHeight: fitRegion.clientHeight, scrollHeight: fitRegion.scrollHeight, clientWidth: fitRegion.clientWidth, scrollWidth: fitRegion.scrollWidth, rect: box(fitRegion) },
      footer: box(footer), rowCount: rows.length, rowHeights: rows.map(el => box(el).height),
      contactLinks: [...document.querySelectorAll('[data-contact-link], a[href^="tel:"]')].filter(visible).map(el => ({ kind: el.dataset.contactLink ?? "phone", href: el.getAttribute("href"), rect: box(el) })),
      controlInventory: [...document.querySelectorAll("main a[href], main button, main input, main [role=combobox]")].filter(visible)
        .map(el => ({ tag: el.tagName, role: el.getAttribute("role"), name: el.getAttribute("aria-label") || el.textContent.trim(), href: el.getAttribute("href"), placeholder: el.getAttribute("placeholder") })),
    };
  });
}
async function ready(page) {
  await page.getByRole("heading", { name: "Leads", exact: true }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll("main a")].some(el => el.textContent.includes("Precision")));
  await page.waitForTimeout(1200);
}
async function captureState(page, name) {
  if (!resumeReached) {
    if (name !== resumeAt) return;
    resumeReached = true;
  }
  const metrics=await geometry(page);
  await page.screenshot({path:join(output,name+".png")});
  report.cases.push({name,...metrics});
  check(metrics.content?.scrollHeight<=metrics.content?.height+1,`${name}: content vertical overflow`);
  check(metrics.content?.scrollWidth<=metrics.content?.width+1,`${name}: content horizontal overflow`);
  {
    check(!!metrics.fitRegion,`${name}: missing .leads-fit-region`);
    check(metrics.fitRegion?.scrollHeight<=metrics.fitRegion?.clientHeight+1,`${name}: table region vertical overflow`);
    check(metrics.fitRegion?.scrollWidth<=metrics.fitRegion?.clientWidth+1,`${name}: table region horizontal overflow`);
  }
  check(metrics.footer?.bottom<=metrics.viewport.height,`${name}: pagination outside viewport`);
}
try {
  fixture = await startSandbox({ build: false, webRoot, port });
  browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, serviceWorkers: "block" });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await fixture.login(page, "admin");
  await page.evaluate(async () => {
    for(let n=1;n<=48;n++) {
      const response=await fetch("/api/leads",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        firstName:"Synthetic",lastName:"Long-Contact-"+n,
        email:n%3===0?"l".repeat(62)+n+"@long-local.example":"contact.with.a.long.address."+n+"@precision.example",
        phone:"+12025550"+String(n).padStart(3,"0"),
        companyName:"Precision Fabrication and Industrial Equipment Services Corporation "+n,
        applicationType:n%2===0?"equipment":"working_capital",leadSource:"manual",
      })});
      if(!response.ok)throw new Error("Synthetic record insertion failed: "+response.status);
    }
  });
  const sizes = [[1024,768],[1366,768],[1440,900],[1920,1080]];
  for (const [width,height] of sizes) {
    await page.setViewportSize({ width, height });
    for (const pinned of [false,true]) for (const theme of ["light","dark"]) {
      const caseName=`${width}x${height}-${pinned?"pinned":"rail"}-${theme}`;
      if(requestedCases && !requestedCases.includes(caseName)) continue;
      await page.goto(fixture.url + "/leads");
      await ready(page);
      // Exercise the real shortcut; this hook deliberately has no storage listener.
      const actualPin=await page.locator(".desktop-rail").getAttribute("data-pinned");
      if((actualPin==="true")!==pinned) {
        await page.evaluate(()=>document.activeElement?.blur?.());
        await page.keyboard.press("Control+b");
      }
      const desiredToggle = page.getByRole("button",{name:`Switch to ${theme} mode`,exact:true});
      if(await desiredToggle.count()) await desiredToggle.click();
      await page.waitForTimeout(1300);
      await page.mouse.move(width-5,height-5);
      const name = `${width}x${height}-${pinned ? "pinned" : "rail"}-${theme}`;
        const metrics = await geometry(page);
      check(metrics.sidebarPinned===String(pinned),`${name}: sidebar state mismatch`);
      if (resumeReached) {
        await page.screenshot({path:join(output,name+".png")});
        report.cases.push({name, ...metrics});
      }
      if (phase === "after") {
        if (resumeReached) {
          check(metrics.documentWidth <= width + 1, `${name}: document horizontal overflow`);
          check(metrics.documentHeight <= height + 1, `${name}: document vertical overflow`);
          check(metrics.content?.scrollHeight <= metrics.content?.height + 1, `${name}: Leads content vertical overflow`);
          check(metrics.content?.scrollWidth <= metrics.content?.width + 1, `${name}: Leads content horizontal overflow`);
          check(!!metrics.fitRegion,`${name}: missing .leads-fit-region`);
          check(metrics.fitRegion?.scrollHeight<=metrics.fitRegion?.clientHeight+1,`${name}: table region vertical overflow`);
          check(metrics.fitRegion?.scrollWidth<=metrics.fitRegion?.clientWidth+1,`${name}: table region horizontal overflow`);
          check(!!metrics.footer && metrics.footer.bottom <= height && metrics.footer.top >= 56, `${name}: pagination not in viewport`);
          check(metrics.contactLinks.filter(el=>el.kind==="email").length > 0, `${name}: missing email actions`);
        }
        await page.getByRole("checkbox",{name:"Select all",exact:true}).click();
        await page.waitForTimeout(600);
        await captureState(page,name+"-bulk");
        await page.getByRole("button",{name:"Clear",exact:true}).click();
        await page.getByPlaceholder("Search by name, email, company…").fill("no-synthetic-record-matches-this");
        await page.getByTestId("table-leads-fit").getByText("No leads match",{exact:true}).waitFor();
        await page.waitForTimeout(300);
        await captureState(page,name+"-empty");
        await page.getByRole("button",{name:"Clear all filters",exact:true}).click();
        await ready(page);
        const delay = async route => { await new Promise(resolve=>setTimeout(resolve,1800)); await route.continue(); };
        await page.route("**/api/leads?*",delay);
        await page.reload();
        await page.locator('[data-testid="table-leads-fit"] tbody .skeleton-shimmer').first().waitFor();
        await captureState(page,name+"-loading");
        await ready(page);
        await page.unroute("**/api/leads?*",delay);
      }
    }
  }
  // Existing <1024px layout/control inventory is retained as a matched baseline.
  for (const width of [390, 900]) {
    await page.setViewportSize({width,height:844});
    await page.goto(fixture.url + "/leads");
    await ready(page);
    const metrics = await geometry(page);
    await page.screenshot({path:join(output,`${width}-mobile.png`)});
    report.cases.push({name:`${width}-mobile`, ...metrics});
  }
  // Adjacent routes deliberately keep legitimate long-content scrolling.
  for (const path of ["/dashboard","/deals","/leads/1"]) {
    await page.setViewportSize({width:1024,height:768});
    await page.goto(fixture.url + path);
    await page.waitForTimeout(2000);
    const metrics = await geometry(page);
    await page.screenshot({path:join(output,`audit-${path.replaceAll("/","-")}.png`)});
    report.cases.push({name:`audit-${path}`, ...metrics});
    if (phase==="after") {
      check(metrics.documentWidth<=1025,`${path}: document horizontal overflow`);
      check(metrics.documentHeight<=769,`${path}: document vertical overflow`);
    }
  }
  if (phase === "after") {
    await page.setViewportSize({width:1366,height:768});
    await page.goto(fixture.url+"/leads");
    await ready(page);
    if(!contactsOnly) {
    await page.getByRole("button",{name:"Next",exact:true}).click();
    await page.waitForTimeout(1500);
    await page.screenshot({path:join(output,"next-page.png")});
    const pagination = await geometry(page);
    check(pagination.footer?.bottom<=768,"Next page footer outside viewport");
    report.nextPage=pagination;
    await page.getByRole("checkbox",{name:"Select all",exact:true}).click();
    await page.waitForTimeout(1200);
    await page.screenshot({path:join(output,"bulk-selection.png")});
    report.bulk = await geometry(page);
    check(report.bulk.content?.scrollHeight<=report.bulk.content?.height+1,"Bulk-selection vertical overflow");
    check(report.bulk.fitRegion?.scrollHeight<=report.bulk.fitRegion?.clientHeight+1,"Bulk-selection table region vertical overflow");
    check(report.bulk.fitRegion?.scrollWidth<=report.bulk.fitRegion?.clientWidth+1,"Bulk-selection table region horizontal overflow");
    check(report.bulk.footer?.bottom<=768,"Bulk-selection hides pagination");
    await page.getByRole("button",{name:/Select all \d+ matching leads/}).click();
    check(await page.getByRole("button",{name:"Apply",exact:true}).isDisabled(),"All-matching status safety changed");
    check(await page.getByRole("button",{name:"Delete",exact:true}).count()===0,"All-matching delete safety changed");
    await page.getByRole("button",{name:"Clear",exact:true}).click();
    await page.getByRole("button",{name:/View details for/}).first().click();
    const summary=page.getByTestId("dialog-lead-summary");
    await summary.waitFor();
    check(await summary.locator('[data-contact-link="email"]').count()===1,"Summary email action missing");
    check(await summary.locator('a[href^="tel:"]').count()===1,"Summary phone action missing");
    await page.screenshot({path:join(output,"inline-details.png")});
    await page.keyboard.press("Escape");
    await page.getByRole("button",{name:"Sort by last activity",exact:true}).click();
    await page.waitForTimeout(800);
    await page.setViewportSize({width:1024,height:768});
    await page.waitForTimeout(800);
    await captureState(page,"resized-pagination");
    const downloadPromise=page.waitForEvent("download");
    await page.getByRole("button",{name:"Export CSV",exact:true}).click();
    const download=await downloadPromise;
    check(!await download.failure(),"Export failed");
    await page.getByRole("button",{name:"Import",exact:true}).click();
    check(await page.getByRole("dialog").isVisible(),"Import dialog failed to open");
    await page.keyboard.press("Escape");
    await page.getByRole("link",{name:"New Lead",exact:true}).click();
    await page.waitForURL("**/leads/new");
    }
    await page.goto(fixture.url+"/leads");
    await ready(page);
    if(contactsOnly) {
      await page.getByRole("button",{name:/View details for/}).first().click();
      const summary=page.getByTestId("dialog-lead-summary");
      check(await summary.locator('a[href^="tel:"]').count()===1,"Summary phone action missing");
      check(await summary.locator('[data-contact-link="email"]').count()===1,"Summary email action missing");
      await page.keyboard.press("Escape");
    }
    await page.locator('[data-testid="table-leads-fit"] [data-contact-link="email"]').first().click();
    await page.waitForTimeout(800);
    // The lead-detail page consumes/removes compose=email after opening the tab.
    await page.getByRole("tab",{name:/^Comms/}).waitFor();
    check(await page.getByRole("tab",{name:/^Comms/}).getAttribute("data-state")==="active","Email composer handoff did not run");
    report.functional=contactsOnly?["summary phone/email links","email composer handoff"]:["next page","bulk selection","all matching safety","full inline details and contact links","sorting","resize","CSV download","Import dialog","New Lead navigation","email composer handoff"];
    // Role-control smoke checks reuse this isolated fixture, without repeating the viewport matrix.
    for (const role of ["manager","rep"]) {
      const roleContext=await browser.newContext({viewport:{width:1024,height:768},serviceWorkers:"block"});
      const rolePage=await roleContext.newPage();
      rolePage.setDefaultTimeout(15000);
      await fixture.login(rolePage,role);
      for (const [width,height] of [[1024,768],[1920,1080]]) {
        await rolePage.setViewportSize({width,height});
        await rolePage.goto(fixture.url+"/leads");
        await rolePage.getByRole("heading",{name:"Leads",exact:true}).waitFor();
        await rolePage.waitForTimeout(1200);
        const roleName=`role-${role}-${width}x${height}`;
        const roleMetrics=await geometry(rolePage);
        await rolePage.screenshot({path:join(output,roleName+".png")});
        report.cases.push({name:roleName,...roleMetrics});
        const importCount=await rolePage.getByRole("button",{name:"Import",exact:true}).count();
        const selectionCount=await rolePage.getByRole("checkbox",{name:"Select all",exact:true}).count();
        const deleteCount=await rolePage.getByRole("button",{name:"Delete",exact:true}).count();
        const exportCount=await rolePage.getByRole("button",{name:"Export CSV",exact:true}).count();
        const contactCount=await rolePage.locator('[data-contact-link="email"]').count();
        if(role==="manager") {
          check(importCount>0,`${roleName}: manager Import control missing`);
          check(selectionCount>0,`${roleName}: manager selection control missing`);
          await rolePage.getByRole("checkbox",{name:"Select all",exact:true}).click();
          check(await rolePage.getByTestId("slot-leads-bulk").getByRole("combobox").count()>0,`${roleName}: manager bulk status control missing`);
          check(await rolePage.getByRole("button",{name:"Apply",exact:true}).count()>0,`${roleName}: manager bulk Apply control missing`);
          check(await rolePage.getByRole("button",{name:"Delete",exact:true}).count()===0,`${roleName}: manager unexpectedly has Delete`);
          await rolePage.getByRole("button",{name:"Clear",exact:true}).click();
        } else {
          check(importCount===0,`${roleName}: rep unexpectedly has Import`);
          check(selectionCount===0,`${roleName}: rep unexpectedly has selection controls`);
          check(await rolePage.getByRole("button",{name:"Delete",exact:true}).count()===0,`${roleName}: rep unexpectedly has Delete`);
          check(exportCount>0,`${roleName}: rep Export CSV control missing`);
          check(contactCount>0,`${roleName}: rep contact links missing`);
        }
        check(roleMetrics.documentWidth<=width+1,`${roleName}: document horizontal overflow`);
      }
      await roleContext.close();
    }
    const before=JSON.parse(await readFile(join(root,"reports/desktop-viewport/before/geometry.json"),"utf8"));
    for(const width of [390,900]) {
      const old=before.cases.find(c=>c.name===`${width}-mobile`);
      const current=report.cases.find(c=>c.name===`${width}-mobile`);
      const normalize=controls=>controls.map(control=>({...control,name:control.name.replace(/(?:less than a minute|about a minute|\d+ minutes?) ago/g,"<relative time> ago")}));
      check(JSON.stringify(normalize(old.controlInventory))===JSON.stringify(normalize(current.controlInventory)),`${width}: mobile control inventory changed`);
    }
  }
} catch(error) {
  report.failures.push(error.stack ?? String(error));
} finally {
  await browser?.close();
  await fixture?.close();
  await writeFile(join(output,"geometry.json"),JSON.stringify(report,null,2));
  console.log(JSON.stringify({phase,cases:report.cases.length,failures:report.failures},null,2));
}
if(report.failures.length) process.exitCode=1;
