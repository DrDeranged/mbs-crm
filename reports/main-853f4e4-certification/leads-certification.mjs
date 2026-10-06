import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { startSandbox } from "../../scripts/visual-refresh/sandbox.mjs";
import { waitForPage } from "../../scripts/visual-refresh/readiness.mjs";

const root = resolve(import.meta.dirname, "../..");
const require = createRequire(join(root, "artifacts/api-server/package.json"));
const { clerkClient } = require("@clerk/express");
const createdClerkUsers = new Set();
const originalCreateUser = clerkClient.users.createUser.bind(clerkClient.users);
const originalDeleteUser = clerkClient.users.deleteUser.bind(clerkClient.users);
clerkClient.users.createUser = async (...args) => {
  const user = await originalCreateUser(...args); createdClerkUsers.add(user.id); return user;
};
clerkClient.users.deleteUser = async id => {
  try { return await originalDeleteUser(id); }
  catch (error) {
    if (error?.status === 404 || /not found|already deleted/i.test(String(error?.message))) return;
    throw error;
  }
};
const output = join(root, "reports/main-853f4e4-certification");
const baselineRoot = resolve(root, ".local/certification-2af927c/baselines/target-2af927c");
const webRoot = resolve(root, ".local/certification-853f4e4/public");
const pages = [["dashboard", "/dashboard"], ["leads", "/leads"], ["lead-detail", "/leads/1"], ["pipeline", "/deals"], ["apply", "/apply"], ["settings", "/settings"]];
const widthSet = [390, 768], height = 900, roles = ["admin", "manager", "rep"];
const snapshots = {}, errors = [], journeys = [], screenshotPaths = [];
const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", headless: true });
let fixture, fixtureDbName;

function check(ok, message) { if (!ok) throw new Error(message); }
function listenErrors(page, phase, role) {
  page.on("pageerror", error => errors.push({ phase, role, kind: "pageerror", message: error.message }));
  page.on("console", message => { if (message.type() === "error") errors.push({ phase, role, kind: "console", message: message.text() }); });
}
async function inventory(page) {
  return page.evaluate(() => {
    const describe = el => ({ tag: el.tagName, role: el.getAttribute("role"), type: el.getAttribute("type"),
      name: el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.textContent?.trim().replace(/\s+/g, " "),
      href: el.getAttribute("href"), disabled: el.hasAttribute("disabled") });
    const exempt = el => !!el.closest("[data-appearance-control],nav[aria-label='Record actions']");
    const els = [...document.querySelectorAll("button,a,input,select,textarea,[role=combobox],[contenteditable=true]")];
    return { controls: els.filter(el => !exempt(el)).map(describe), exemptions: els.filter(exempt).map(describe) };
  });
}
async function capturePhase(phase) {
  const controls = {}, exemptions = {};
  for (const role of roles) {
    const context = await browser.newContext({ viewport: { width: 1440, height }, colorScheme: "light", reducedMotion: "reduce", serviceWorkers: "block" });
    if (phase === "baseline") {
      await context.route("**/*", async route => {
        const url = new URL(route.request().url());
        if (url.origin !== fixture.url || url.pathname.startsWith("/api/")) return route.continue();
        const isHtml = route.request().resourceType() === "document" || route.request().headers().accept?.includes("text/html");
        if (!isHtml && !/\.(?:js|css|woff2?|png|svg|webp|ico|jpg|json|webmanifest)$/.test(url.pathname)) return route.continue();
        const path = isHtml ? "index.html" : decodeURIComponent(url.pathname).replace(/^\//, "");
        if (path.split("/").includes("..")) throw new Error("Unsafe baseline path");
        try {
          const bytes = await readFile(join(baselineRoot, path));
          const ext = path.split(".").pop();
          const types = { html: "text/html", js: "application/javascript", css: "text/css", svg: "image/svg+xml", png: "image/png", ico: "image/x-icon", woff2: "font/woff2", jpg: "image/jpeg", webp: "image/webp", json: "application/json", webmanifest: "application/manifest+json" };
          await route.fulfill({ status: 200, contentType: types[ext] || "application/octet-stream", body: bytes });
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          await route.fulfill({ status: 404, contentType: "text/plain", body: `Missing retained baseline asset: ${path}` });
        }
      });
    }
    const page = await context.newPage(); page.setDefaultTimeout(15000); listenErrors(page, phase, role);
    await fixture.login(page, role);
    for (const width of widthSet) {
      await page.setViewportSize({ width, height });
      for (const [name, path] of pages) {
        await page.goto(fixture.url + path);
        await waitForPage(page, name);
        const result = await inventory(page), key = `${name}-${width}-${role}`;
        controls[key] = result.controls; exemptions[key] = result.exemptions;
      }
    }
    await context.close();
  }
  snapshots[phase] = { controls, exemptions };
}
async function selectOption(page, combo, option) {
  await combo.click();
  const seen = await page.getByRole("option").allTextContents();
  check(seen.some(text => text.trim() === option), `Accessible option "${option}" absent; saw ${JSON.stringify(seen)}`);
  await page.getByRole("option", { name: option, exact: true }).click();
}
async function leadsJourney(page) {
  const test = async (selector, outcome, extra = {}) => journeys.push({ selector, outcome, ...extra });
  await page.setViewportSize({ width: 1440, height });
  await page.goto(fixture.url + "/leads");
  await page.getByRole("heading", { name: "Leads", exact: true }).waitFor();
  await page.locator('[data-testid="table-leads-fit"] tbody tr').first().waitFor();
  const search = page.getByPlaceholder("Search by name, email, company…", { exact: true });
  await search.fill("Synthetic Contact");
  const leadRows = page.locator('[data-testid="table-leads-fit"] tbody tr');
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll('[data-testid="table-leads-fit"] tbody tr')];
    return rows.length === 1 && rows[0].textContent.includes("Synthetic Contact");
  });
  check(await leadRows.count() === 1, "Search Synthetic Contact did not narrow to one lead");
  await test('getByPlaceholder("Search by name, email, company…")', "Synthetic Contact -> 1 matching row");
  await search.fill("Fixture Services LLC");
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll('[data-testid="table-leads-fit"] tbody tr')];
    return rows.length === 1 && rows[0].textContent.includes("Fixture Services LLC");
  });
  check(await leadRows.count() === 1, "Company search did not narrow to one lead");
  await test('getByPlaceholder("Search by name, email, company…")', "Fixture Services LLC -> Sample Applicant only");
  await search.fill("");
  const combos = page.getByRole("combobox");
  await selectOption(page, combos.nth(0), "Contacted");
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="table-leads-fit"] tbody tr').length === 1);
  check(await page.locator('[data-testid="table-leads-fit"] tbody tr').count() === 1, "Contacted filter did not return one lead");
  await test('getByRole("combobox").nth(0)', "Status Contacted -> Synthetic Contact only");
  await selectOption(page, combos.nth(0), "All Statuses");
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="table-leads-fit"] tbody tr').length === 2);
  await selectOption(page, page.getByRole("combobox").nth(1), "Equipment");
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="table-leads-fit"] tbody tr').length === 1);
  check(await page.locator('[data-testid="table-leads-fit"] tbody tr').count() === 1, "Equipment type filter did not return one lead");
  await test('getByRole("combobox").nth(1)', "Type Equipment -> matching lead retained");
  await selectOption(page, page.getByRole("combobox").nth(1), "All Types");
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="table-leads-fit"] tbody tr').length === 2);
  const rep = page.getByRole("button", { name: "Filter by representative" });
  await rep.click();
  const repOptions = await page.getByRole("option").allTextContents();
  check(repOptions.some(text => text.includes("Visual Fixture")), `Fixture rep option absent: ${JSON.stringify(repOptions)}`);
  await page.getByRole("option", { name: /Visual Fixture/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="table-leads-fit"] tbody tr').length === 2);
  check(await page.locator('[data-testid="table-leads-fit"] tbody tr').count() === 2, "Rep filter did not return the two assigned synthetic leads");
  await test('getByRole("button", {name:"Filter by representative"})', "Visual Fixture -> two assigned synthetic leads");
  const sortRequests = [];
  page.on("request", request => { if (/\/api\/leads(?:\?|$)/.test(request.url())) sortRequests.push(request.url()); });
  const oldestRequestPromise = page.waitForRequest(request => {
    try { return new URL(request.url()).searchParams.get("sortOrder") === "asc"; } catch { return false; }
  });
  await selectOption(page, page.getByRole("combobox").last(), "Oldest First");
  const oldestRequest = await oldestRequestPromise;
  await page.getByRole("combobox").last().getByText("Oldest First").waitFor();
  const sortedRequest = oldestRequest.url();
  check(!!sortedRequest, `Oldest First did not request sortOrder=asc: ${JSON.stringify(sortRequests)}`);
  await test('getByRole("combobox").last()', "Oldest First selected; API request sortOrder=asc", { request: sortedRequest });
  await page.goto(fixture.url + "/leads");
  await page.getByRole("heading", { name: "Leads", exact: true }).waitFor();
  const table = page.locator('[data-testid="table-leads-fit"]');
  const row = table.locator("tbody tr").filter({ hasText: "Synthetic Contact" });
  const phone = row.locator('a[href^="tel:"]');
  const phoneHref = await phone.getAttribute("href");
  await page.evaluate(() => {
    window.__telClicks = [];
    document.addEventListener("click", event => {
      const link = event.target.closest?.('a[href^="tel:"]');
      if (link) { event.preventDefault(); window.__telClicks.push(link.href); }
    }, true);
  });
  const beforePhone = page.url();
  await phone.click();
  check(page.url() === beforePhone, "Phone action navigated away from Leads");
  check((await page.evaluate(() => window.__telClicks)).length === 1, "Phone click was not intercepted before dialing");
  await test('table row a[href^="tel:"]', "phone href captured; default prevented; URL stayed /leads", { href: phoneHref });
  const email = row.locator('[data-contact-link="email"]');
  const emailHref = await email.getAttribute("href");
  await email.click();
  await page.waitForURL(/\/leads\/1(?:\?.*)?$/);
  const comms = page.getByRole("tab", { name: /^Comms/ });
  await comms.waitFor();
  check(await comms.getAttribute("data-state") === "active", "Email link did not activate lead Comms");
  await test('table row [data-contact-link="email"]', "opened /leads/1 and activated Comms tab", { href: emailHref, url: page.url() });
  const phoneDetail = page.locator('a[href^="tel:"]');
  check(await phoneDetail.count() >= 1, "Lead detail phone action missing");
  const beforeDetailPhone = page.url();
  await phoneDetail.first().click();
  check(page.url() === beforeDetailPhone, "Lead detail phone action navigated away");
  await test('lead detail a[href^="tel:"]', "default prevented; remained on lead detail");
  await page.goto(fixture.url + "/leads");
  await page.getByRole("link", { name: /Synthetic Contact/ }).first().click();
  await page.waitForURL(/\/leads\/1(?:\?.*)?$/);
  await waitForPage(page, "lead-detail");
  const detailHeading = await page.locator("h1").first().innerText();
  check(new URL(page.url()).pathname === "/leads/1" && /Fixture Equipment LLC|Synthetic Contact/.test(detailHeading), "Lead row/name link did not navigate to expected detail");
  await test('getByRole("link", {name:/Synthetic Contact/})', "navigated to /leads/1 detail", { heading: detailHeading, url: page.url() });
  const screenshots = [];
  for (const theme of ["light", "dark"]) {
    if (theme === "dark") {
      await page.setViewportSize({ width: 390, height });
      await page.goto(fixture.url + "/settings");
      await waitForPage(page, "settings");
      await page.getByLabel("Appearance theme").selectOption("dark");
    }
    for (const width of [390, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height });
      await page.goto(fixture.url + "/leads");
      await page.getByRole("heading", { name: "Leads", exact: true }).waitFor();
      await waitForPage(page, "leads");
      if (theme === "dark") check(await page.locator("html").getAttribute("data-appearance") === "dark", "Dark theme did not persist");
      const geometry = await page.evaluate(() => {
        const r = el => el?.getBoundingClientRect().toJSON();
        const table = document.querySelector('[data-testid="table-leads-fit"] table');
        const region = document.querySelector(".leads-fit-region");
        return { viewport: { width: innerWidth, height: innerHeight }, document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
          table: table && { rect: r(table), clientWidth: table.clientWidth, scrollWidth: table.scrollWidth },
          fitRegion: region && { rect: r(region), clientWidth: region.clientWidth, scrollWidth: region.scrollWidth, clientHeight: region.clientHeight, scrollHeight: region.scrollHeight },
          rows: [...(table?.querySelectorAll("tbody tr") ?? [])].map(row => r(row)), contactLinks: [...document.querySelectorAll('[data-contact-link],a[href^="tel:"]')].map(el => ({ href: el.getAttribute("href"), rect: r(el) })) };
      });
      const name = `leads-${width}-${theme}.png`, file = join(output, name);
      await page.screenshot({ path: file });
      screenshots.push(name); screenshotPaths.push(file);
      journeys.push({ selector: "authenticated Leads initial view", outcome: `${width}x${height} ${theme}`, geometry });
    }
  }
  check(screenshots.length === 8, `Expected eight Leads screenshots; got ${screenshots.length}`);
}

async function restoreHistoricalCampaign(fixture) {
  const sourcePath = join(root, ".local/certification-853f4e4/historical-campaign.json");
  const sourceBytes = await readFile(sourcePath);
  const historical = JSON.parse(sourceBytes);
  check(historical.campaign?.id === 5 && historical.campaign?.status === "completed", "Unexpected historical campaign fixture");
  check(historical.launches?.length === 1 && historical.recipients?.length === 13 && historical.sends?.length === 13, "Historical fixture row counts changed");
  const dbName = fixture.query("SELECT current_database()");
  check(/^visual_refresh_fixture_\d+_\d+$/.test(dbName), `Refusing campaign fixture writes to unrecognized database ${dbName}`);
  const dbUrl = new URL(process.env.DATABASE_URL); dbUrl.pathname = `/${dbName}`;
  check(dbUrl.pathname.slice(1) === dbName && /^visual_refresh_fixture_/.test(dbName), "Fixture-only database guard failed");
  const q = value => `'${String(value).replaceAll("'", "''")}'`;
  const ts = value => value == null ? "NULL" : `${q(value.replace("T", " "))}::timestamp`;
  const tz = value => value == null ? "NULL" : `${q(value)}::timestamptz`;
  const leadsBySource = new Map();
  [...new Set(historical.recipients.map(row => row.lead_id))].forEach((sourceId, index) => leadsBySource.set(sourceId, index + 3));
  const sql = [];
  for (const [sourceLeadId, id] of leadsBySource) {
    const n = id - 2;
    sql.push(`INSERT INTO leads(id,first_name,last_name,email,phone,company_name,application_type,status,assigned_rep_id,lead_source,created_at,updated_at)
      VALUES (${id},'Historical','Fixture Recipient ${String(n).padStart(2,"0")}',${q(`historical-recipient-${String(n).padStart(2,"0")}@example.invalid`)},
      '+1202555${String(100+n).slice(-4)}',${q(`Synthetic Campaign Recipient ${String(n).padStart(2,"0")}`)},'equipment','contacted',3,'manual',now(),now());`);
  }
  const c = historical.campaign;
  sql.push(`INSERT INTO campaigns(id,name,channel,status,email_template_id,audience_rules,scheduled_at,launched_at,completed_at,owner_id,created_by,version,created_at,updated_at,tracking_since,reply_to_email,flyer_delivery_mode)
    VALUES (5,${q(c.name)},${q(c.channel)},${q(c.status)},1,'{}'::jsonb,${tz(c.scheduled_at)},${tz(c.launched_at)},${tz(c.completed_at)},1,1,${c.version},${tz(c.created_at)},${tz(c.updated_at)},NULL,'fixture-replies@example.invalid',${q(c.flyer_delivery_mode)});`);
  const launch = historical.launches[0];
  sql.push(`INSERT INTO campaign_launches(id,campaign_id,idempotency_key,requested_by,mode,status,eligible_count,excluded_count,sent_count,failed_count,scheduled_at,started_at,completed_at,created_at)
    VALUES (5,5,'historical-fixture-launch-5',1,${q(launch.mode)},${q(launch.status)},${launch.eligible_count},${launch.excluded_count},${launch.sent_count},${launch.failed_count},${tz(launch.scheduled_at)},${tz(launch.started_at)},${tz(launch.completed_at)},${tz(launch.created_at)});`);
  for (const send of historical.sends) {
    const n = leadsBySource.get(send.lead_id);
    const ordinal = String(n - 2).padStart(2, "0");
    sql.push(`INSERT INTO email_sends(id,lead_id,user_id,template_id,subject,to_email,from_email,status,sendgrid_message_id,sent_at,opened_at,clicked_at,created_at,updated_at,campaign_id,campaign_launch_id,delivery_kind)
      VALUES (${send.id},${n},1,1,${q("Vendors — Heavy Equipment (synthetic historical fixture)")},${q(`historical-recipient-${ordinal}@example.invalid`)},'fixture-sender@example.invalid',
      ${q(send.status)},NULL,${ts(send.sent_at)},${ts(send.opened_at)},${ts(send.clicked_at)},${ts(send.created_at)},${ts(send.updated_at)},5,5,${q(send.delivery_kind)});`);
  }
  for (const recipient of historical.recipients) {
    sql.push(`INSERT INTO campaign_recipients(id,launch_id,campaign_id,lead_id,channel,status,exclusion_reason,available_at,email_send_id,sent_at,created_at)
      VALUES (${recipient.id},5,5,${leadsBySource.get(recipient.lead_id)},${q(recipient.channel)},${q(recipient.status)},${recipient.exclusion_reason == null ? "NULL" : q(recipient.exclusion_reason)},
      ${tz(recipient.available_at)},${recipient.email_send_id},NULL,${tz(recipient.created_at)});`);
  }
  for (const [table, seqValue] of [["leads", 15], ["campaigns", 5], ["campaign_launches", 5], ["campaign_recipients", 26], ["email_sends", 45]]) {
    sql.push(`SELECT setval(pg_get_serial_sequence('${table}','id'),${seqValue},true);`);
  }
  // Explicit fixture-only URL guard above; never use fixture.query for writes, and never connect to a customer database.
  const inserted = spawnSync("psql", [`--dbname=${dbUrl}`, "--no-psqlrc", "--set=ON_ERROR_STOP=on", "--single-transaction", "--command", sql.join("\n")], { encoding: "utf8" });
  check(inserted.status === 0, `Historical rows failed to insert into isolated fixture: ${inserted.stderr?.slice(-1200)}`);
  const preserved = fixture.query("SELECT c.id, c.name, c.status, c.tracking_since IS NULL AS no_historical_tracking_provenance, l.id AS launch_id, l.sent_count, (SELECT count(*) FROM campaign_recipients r WHERE r.campaign_id=c.id AND r.status='sent') AS recipient_sent, (SELECT count(*) FROM email_sends e WHERE e.campaign_id=c.id AND e.status IN ('delivered','opened','clicked')) AS actual_email_sends, (SELECT count(*) FROM campaign_recipients r WHERE r.campaign_id=c.id AND r.sent_at IS NULL) AS recipient_sent_at_null, (SELECT count(*) FROM email_sends e WHERE e.campaign_id=c.id AND e.sent_at IS NOT NULL) AS email_sent_at_retained FROM campaigns c JOIN campaign_launches l ON l.campaign_id=c.id WHERE c.id=5");
  const leadMap = [...leadsBySource.values()].map((fixtureLeadId, index) => ({ sourceReference: `production-lead-${index + 1}`, fixtureLeadId, syntheticIdentity: `Historical Fixture Recipient ${String(index + 1).padStart(2,"0")}`, syntheticEmail: `historical-recipient-${String(index + 1).padStart(2,"0")}@example.invalid` }));
  const anonymized = { provenance: { source: ".local/certification-853f4e4/historical-campaign.json", sourceSha256: createHash("sha256").update(sourceBytes).digest("hex"), dataClass: "production READ-ONLY historical snapshot; no contact details supplied", campaignId: 5, copiedAt: new Date().toISOString() },
    campaign: { id: 5, name: c.name, status: c.status, channel: c.channel, version: c.version, tracking_since: null, launch_id: 5, owner_fixture_user_id: 1, created_by_fixture_user_id: 1, email_template_fixture_id: 1 },
    launch: { id: 5, mode: launch.mode, status: launch.status, eligible_count: launch.eligible_count, sent_count: launch.sent_count, failed_count: launch.failed_count, excluded_count: launch.excluded_count, requested_by_fixture_user_id: 1, created_at: launch.created_at, started_at: launch.started_at, completed_at: launch.completed_at },
    recipientRows: historical.recipients.map(row => ({ id: row.id, status: row.status, channel: row.channel, sourceReference: `production-lead-${[...leadsBySource.keys()].indexOf(row.lead_id)+1}`, fixtureLeadId: leadsBySource.get(row.lead_id), launch_id: row.launch_id, campaign_id: row.campaign_id, email_send_id: row.email_send_id, sent_at: null, created_at: row.created_at })),
    emailSends: historical.sends.map(row => ({ id: row.id, status: row.status, sourceReference: `production-lead-${[...leadsBySource.keys()].indexOf(row.lead_id)+1}`, fixtureLeadId: leadsBySource.get(row.lead_id), sent_at: row.sent_at, opened_at: row.opened_at, clicked_at: row.clicked_at, created_at: row.created_at, updated_at: row.updated_at, campaign_id: row.campaign_id, campaign_launch_id: row.campaign_launch_id, delivery_kind: row.delivery_kind, synthetic_to_email: `historical-recipient-${String(leadsBySource.get(row.lead_id)-2).padStart(2,"0")}@example.invalid`, synthetic_from_email: "fixture-sender@example.invalid", synthetic_subject: "Vendors — Heavy Equipment (synthetic historical fixture)" })),
    syntheticLeads: leadMap, fixtureVerification: preserved };
  await writeFile(join(output, "historical-campaign-anonymized.json"), JSON.stringify(anonymized, null, 2));
  await writeFile(join(output, "historical-campaign-source-provenance.json"), JSON.stringify({ sourceFile: anonymized.provenance.source, sourceSha256: anonymized.provenance.sourceSha256, productionDatabaseAccess: "READ-ONLY source snapshot only; inserts executed only against guarded visual_refresh_fixture_* disposable clone", pii: "source snapshot contains no customer contact details; fixture names/emails substituted", rowCounts: { sends: historical.sends.length, recipients: historical.recipients.length, launches: historical.launches.length }, fixtureCurrentDatabase: dbName, insertedCampaign: 5 }, null, 2));
  return { historical, anonymized, preserved };
}

async function campaignJourney(page, fixture) {
  const { historical, anonymized, preserved } = await restoreHistoricalCampaign(fixture);
  const errorStart = errors.length;
  const resultsPromise = page.waitForResponse(response => response.url().includes("/api/campaigns/5/results"));
  const metricsPromise = page.waitForResponse(response => response.url().includes("/api/campaigns/5/metrics"));
  await page.goto(fixture.url + "/campaigns/5");
  await page.getByText("Vendors — Heavy Equipment", { exact: true }).first().waitFor();
  const resultsTab = page.getByRole("tab", { name: "Results", exact: true });
  await resultsTab.click();
  const [resultsResponse, metricsResponse] = await Promise.all([resultsPromise, metricsPromise]);
  check(resultsResponse.status() === 200 && metricsResponse.status() === 200, `Campaign Results API status not 200: ${resultsResponse.status()}/${metricsResponse.status()}`);
  const results = await resultsResponse.json(), metrics = await metricsResponse.json();
  check(results.counts.sent === 13 && results.launches.length === 1, `Legacy API counts incorrect: ${JSON.stringify(results.counts)}`);
  check(metrics.sent === 13 && metrics.trackingSince == null, `KPI API historical sent/tracking mismatch: ${JSON.stringify({ sent: metrics.sent, trackingSince: metrics.trackingSince })}`);
  await page.getByText("Campaign Results", { exact: true }).waitFor();
  const legacySent = page.getByText("Sent", { exact: true }).first().locator("..");
  check((await legacySent.innerText()).includes("13"), `Legacy Results Sent KPI not 13: ${await legacySent.innerText()}`);
  const sentKpi = page.getByTestId("kpi-sent");
  await sentKpi.waitFor();
  check((await sentKpi.innerText()).includes("13"), `New KPI Sent not 13: ${await sentKpi.innerText()}`);
  check((await page.getByTestId("panel-campaign-kpis").innerText()).includes("Historical tracking not available"), "KPI panel did not disclose absent historical tracking");
  check((await page.getByTestId("kpi-uniqueClicks").innerText()).includes("Not tracked"), "Unknown unique click metric was not shown as Not tracked");
  check((await page.getByTestId("kpi-replies").innerText()).includes("Not tracked"), "Unknown replies metric was not shown as Not tracked");
  const campaignScreenshot = join(output, "campaign-5-results.png");
  await page.screenshot({ path: campaignScreenshot, fullPage: true });
  const campaignEvidence = { url: page.url(), title: "Vendors — Heavy Equipment", status: "completed",
    resultsApi: { status: resultsResponse.status(), counts: results.counts, launches: results.launches.length },
    metricsApi: { status: metricsResponse.status(), sent: metrics.sent, trackingSince: metrics.trackingSince, uniqueFlyerClicks: metrics.uniqueFlyerClicks, replies: metrics.replies, fundedDollars: metrics.fundedDollars },
    legacyResultsSent: await legacySent.innerText(), kpiSent: await sentKpi.innerText(),
    untrackedText: ["Historical tracking not available", "Not tracked"], screenshot: "reports/main-853f4e4-certification/campaign-5-results.png",
    fixtureVerification: preserved, historicalRows: { sends: historical.sends.length, recipients: historical.recipients.length, launches: historical.launches.length },
    runtimeErrors: errors.slice(errorStart), noLaunchAction: true, noDeliveryAction: true, disclaimer: "Candidate-code behavior rendered from anonymized historical production records in isolated fixture; not a newly published production page." };
  check(!campaignEvidence.runtimeErrors.some(error => error.kind === "pageerror"), `Campaign Results runtime exception: ${JSON.stringify(campaignEvidence.runtimeErrors)}`);
  journeys.push({ selector: 'page.goto("/campaigns/5") then getByRole("tab",{name:"Results"})', outcome: "campaign completed; legacy Results Sent 13; new KPI Sent 13; unknown historical metrics disclosed as Not tracked", campaign: campaignEvidence });
  await writeFile(join(output, "campaign-results-verification.json"), JSON.stringify(campaignEvidence, null, 2));
}

try {
  check(webRoot.startsWith(root) && await readFile(join(webRoot, "index.html")), "Immutable web build missing");
  fixture = await startSandbox({ build: false, webRoot, port: 4320 });
  const dbName = fixture.query("SELECT current_database()");
  fixtureDbName = dbName;
  const dbUrl = new URL(process.env.DATABASE_URL); dbUrl.pathname = `/${dbName}`;
  const aligned = spawnSync("psql", [`--dbname=${dbUrl}`, "--no-psqlrc", "--set=ON_ERROR_STOP=on", "--command",
    "UPDATE leads SET created_at = now() - interval '18.6 days', last_activity_at = now() - interval '18.6 days' WHERE id IN (1,2);"], { encoding: "utf8" });
  check(aligned.status === 0, "Could not align disposable fixture activity timestamps");
  const ageEvidence = fixture.query("SELECT id, to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') AS created_utc, to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') AS updated_utc, to_char(last_activity_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') AS activity_utc, floor(extract(epoch FROM (now()-created_at))/86400)::int AS idle_days FROM leads ORDER BY id");
  await writeFile(join(output, "fixture-age-alignment.txt"), `${ageEvidence}\n`);
  const baselineIndex = await readFile(join(baselineRoot, "index.html"));
  await capturePhase("baseline");
  await capturePhase("target");
  const certified = JSON.parse(await readFile(join(root, "reports/structural-certification-2026-10-03/after/role-controls.json")));
  const certifiedExempt = JSON.parse(await readFile(join(root, "reports/structural-certification-2026-10-03/after/exempt-controls.json")));
  const comparisons = Object.keys(snapshots.baseline.controls).map(key => ({
    key, controlsEqual: JSON.stringify(snapshots.baseline.controls[key]) === JSON.stringify(snapshots.target.controls[key]),
    exemptionsEqual: JSON.stringify(snapshots.baseline.exemptions[key]) === JSON.stringify(snapshots.target.exemptions[key]),
    certifiedInventoryEqual: JSON.stringify(certified[key]) === JSON.stringify(snapshots.target.controls[key]),
    certifiedExemptionsEqual: JSON.stringify(certifiedExempt[key]) === JSON.stringify(snapshots.target.exemptions[key]),
  }));
  const structureDifferences = comparisons.filter(row => !row.controlsEqual || !row.exemptionsEqual || !row.certifiedInventoryEqual || !row.certifiedExemptionsEqual).map(row => {
    const key = row.key, target = snapshots.target.controls[key] ?? [], archived = certified[key] ?? [];
    let first = 0;
    while (first < Math.max(target.length, archived.length) && JSON.stringify(target[first]) === JSON.stringify(archived[first])) first++;
    return { key, flags: row, firstCertifiedControlDifference: first, targetCount: target.length, certifiedCount: archived.length,
      targetAtDifference: target[first] ?? null, certifiedAtDifference: archived[first] ?? null, targetControls: target, certifiedControls: archived,
      targetExemptions: snapshots.target.exemptions[key] ?? [], certifiedExemptions: certifiedExempt[key] ?? [] };
  });
  await writeFile(join(output, "structure-differences.json"), JSON.stringify(structureDifferences, null, 2));
  const result = { target: "853f4e49378b10daf3d59d81769c81fe812ca0ea", localSnapshot: "4165874ad76bdfbba46a115d7c3b404ec1752b6d",
    baselineRevision: "2af927ca2830926bf325cef2eecfffc24ab5c110",
    baselineIndexSha256: createHash("sha256").update(baselineIndex).digest("hex"),
    baselineRoot: ".local/certification-2af927c/baselines/target-2af927c", strictRequired: 36, comparisons,
    structurePass: comparisons.length === 36 && comparisons.every(row => row.controlsEqual && row.exemptionsEqual && row.certifiedInventoryEqual && row.certifiedExemptionsEqual),
    widths: [390, 768, 1280, 1440], height, screenshots: screenshotPaths.map(file => file.slice(root.length + 1)),
    fixtureAgeEvidence: ageEvidence, journeys, errors, authentication: "real development Clerk tickets; fixture.login; admin/manager/rep fixture claims",
    database: "isolated schema-only clone; synthetic contacts; delivery credentials removed; background jobs disabled; no live delivery"};
  await writeFile(join(output, "leads-certification.json"), JSON.stringify(result, null, 2));
  await writeFile(join(output, "structure-controls.json"), JSON.stringify(snapshots, null, 2));
  check(comparisons.length === 36, `Strict mobile comparison count ${comparisons.length}, expected 36`);
  const journeyContext = await browser.newContext({ viewport: { width: 1440, height }, colorScheme: "light", reducedMotion: "reduce", serviceWorkers: "block" });
  const journeyPage = await journeyContext.newPage(); journeyPage.setDefaultTimeout(15000); listenErrors(journeyPage, "journey", "admin");
  await fixture.login(journeyPage, "admin");
  await leadsJourney(journeyPage);
  await campaignJourney(journeyPage, fixture);
  await journeyContext.close();
  result.journeys = journeys;
  result.errors = errors;
  result.screenshots = screenshotPaths.map(file => file.slice(root.length + 1));
  await writeFile(join(output, "leads-certification.json"), JSON.stringify(result, null, 2));
  await writeFile(join(output, "journeys.json"), JSON.stringify(journeys, null, 2));
  await writeFile(join(output, "console-errors.json"), JSON.stringify(errors, null, 2));
  check(result.structurePass, "STRICT STRUCTURE comparison mismatch; Leads and campaign exercises completed; see structure-differences.json");
  check(errors.length === 0, `Browser errors observed: ${JSON.stringify(errors)}`);
  console.log(JSON.stringify({ structure: "PASS 36/36", screenshots: screenshotPaths, journeys: journeys.length, errors }, null, 2));
} catch (error) {
  await writeFile(join(output, "corrected-run-failure.txt"), `${error?.stack ?? String(error)}\n`);
  await writeFile(join(output, "console-errors.json"), JSON.stringify(errors, null, 2));
  if (snapshots.baseline && snapshots.target) await writeFile(join(output, "structure-controls.json"), JSON.stringify(snapshots, null, 2));
  throw error;
} finally {
  await browser.close();
  try { await fixture?.close(); } catch (error) { await writeFile(join(output, "cleanup-warning.txt"), `${error?.stack ?? String(error)}\n`); }
  for (const userId of createdClerkUsers) {
    try { await clerkClient.users.deleteUser(userId); }
    catch (error) { await writeFile(join(output, "cleanup-warning.txt"), `${error?.stack ?? String(error)}\n`, { flag: "a" }); }
  }
  if (fixtureDbName && /^visual_refresh_fixture_\d+_\d+$/.test(fixtureDbName)) {
    const drop = spawnSync("dropdb", ["--if-exists", "--force", `--maintenance-db=${process.env.DATABASE_URL}`, fixtureDbName], { encoding: "utf8" });
    if (drop.status !== 0) await writeFile(join(output, "cleanup-warning.txt"), `${drop.stderr}\n`, { flag: "a" });
  }
}
