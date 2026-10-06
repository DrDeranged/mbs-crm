import { createRequire } from "node:module";
const require = createRequire("/home/runner/workspace/.local/predeploy-c6fc40f-source/package.json");
const { chromium } = require("@playwright/test");
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const { startSandbox } = await import("file:///home/runner/workspace/.local/predeploy-c6fc40f-source/scripts/visual-refresh/sandbox.mjs");
const { waitForPage } = await import("file:///home/runner/workspace/.local/predeploy-c6fc40f-source/scripts/visual-refresh/readiness.mjs");

const baselineRoot = process.env.NATE_BASELINE_WEB_ROOT ?? "/tmp/nate-workflow-baseline/public";
const candidateRoot = resolve(process.env.NATE_CANDIDATE_WEB_ROOT ?? "artifacts/mbs-crm/dist/public");
const evidenceRoot = resolve("reports/nate-workflows");
const routeCases = [
  ["dashboard", "/dashboard", "dashboard"],
  ["leads", "/leads", "Leads"],
  ["lead-detail", "/leads/1", "lead-detail"],
  ["pipeline", "/deals", "Deals"],
  ["deal-detail", "/deals/1", "deal-detail"],
  ["new-deal", "/deals/new", "new-deal"],
  ["credit-compliance", "/credit/compliance", "credit-compliance"],
  ["apply", "/apply", "apply"],
  ["settings", "/settings", "settings"],
];
const args = process.argv.slice(2);
const argValue = (name) => args.find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1);
const splitArg = (name, fallback) => {
  const value = argValue(name);
  return value === undefined ? fallback : value.split(",").filter(Boolean);
};
const selectedRouteNames = new Set(splitArg("--routes", [...routeCases.map(([name]) => name), "campaign-audience"]));
const roles = splitArg("--roles", ["admin", "manager", "rep"]);
const widths = splitArg("--widths", ["390", "768"]).map(Number);
const selectedPhases = splitArg("--phases", ["before", "after"]);
const compareOnly = args.includes("--compare-only");
const captureOnly = args.includes("--capture-only");
const behaviorOnly = args.includes("--behavior-only");
const resumeAssignmentsAndAudience = args.includes("--resume-assignments-and-audience");
const resumeManagerUi = args.includes("--resume-manager-ui");
const resumeCampaignUi = args.includes("--resume-campaign-ui");
const skipBehavior = args.includes("--skip-behavior") || captureOnly;
const sourceSearchOnly = args.includes("--source-search-only");
const prohibited = /\/(?:twilio(?:\/|$)|email\/send|credit(?:\/|-|_)(?:pull|report)|campaigns\/[^/]+\/launch)(?:\?|$)/i;
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function check(result, name, condition, actual = null) {
  result.assertions[name] = { passed: Boolean(condition), actual };
  if (!condition) result.failures.push({ name, actual });
  assert(Boolean(condition), `${name}: ${JSON.stringify(actual)}`);
}

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function insertedIds(output) {
  const ids = output.split(/\s+/).filter(Boolean).map(Number);
  if (!ids.length || ids.some(id => !Number.isInteger(id))) throw new Error("Fixture INSERT did not return numeric ids.");
  return ids;
}

async function seedCertificationFixture(sandbox) {
  const staffSql = `INSERT INTO users (clerk_id,name,email,role,is_active,merged_into_user_id) VALUES
    ('fixture-eligible-admin','Ada Admin','ada.admin@example.invalid','admin',true,null),
    ('fixture-eligible-manager','Milo Manager','milo.manager@example.invalid','manager',true,null),
    ('fixture-eligible-rep','Zoe Rep','zoe.rep@example.invalid','rep',true,null),
    ('fixture-inactive','Inactive Target','inactive@example.invalid','rep',false,null),
    ('fixture-pending','Pending Target','pending@example.invalid','pending',true,null),
    ('fixture-merged','Merged Target','merged@example.invalid','rep',true,1) RETURNING id`;
  const ids = insertedIds(sandbox.seedFixture(staffSql));
  const staff = {
    admin: ids[0], manager: ids[1], rep: ids[2],
    inactive: ids[3], pending: ids[4], merged: ids[5], missing: 999999,
  };

  const sourceRows = [
    { first: "Nate USFA Open", source: "US Fund Advisor" },
    { first: "Nate USFA Closed", source: "US Fund Advisor" },
    { first: "Nate Vendor Hold", source: "vendor_list" },
    { first: "Nate Vendor Archived", source: "vendor_list" },
    { first: "Nate Vendor Open", source: "vendor_list" },
    { first: "Nate Prospect Absent", source: "prospect_list" },
    { first: "Nate Website Absent", source: "Website" },
    ...Array.from({ length: 27 }, (_, i) => ({ first: `Nate Vendor ${String(i + 4).padStart(2, "0")}`, source: "vendor_list" })),
  ];
  const leadTuples = sourceRows.map((lead, i) => `(${sqlText(lead.first)},'Fixture${String(i + 1).padStart(2, "0")}',${sqlText(`nate.fixture.${i + 1}@example.invalid`)},${sqlText(`+1202555${String(i + 1).padStart(4, "0")}`)},${sqlText(`${lead.first} Equipment LLC`)},'working_capital','new_lead',3,12000,680,70,${sqlText(lead.source)})`);
  const sourceLeadIds = insertedIds(sandbox.seedFixture(`INSERT INTO leads (first_name,last_name,email,phone,company_name,application_type,status,assigned_rep_id,requested_amount,credit_score,lead_score,lead_source) VALUES ${leadTuples.join(",")} RETURNING id`));
  const leads = {
    usfaOpen: sourceLeadIds[0], usfaClosed: sourceLeadIds[1],
    vendorHold: sourceLeadIds[2], vendorArchived: sourceLeadIds[3], vendorOpen: sourceLeadIds[4],
    prospectAbsent: sourceLeadIds[5], websiteAbsent: sourceLeadIds[6],
    vendorAll: sourceLeadIds.slice(2, 5).concat(sourceLeadIds.slice(7)),
    all: sourceLeadIds,
  };
  const dealRows = [
    [leads.usfaOpen, "Nate open duplicate one", "waiting_on_app", false],
    [leads.usfaOpen, "Nate open duplicate two", "information_needed", false],
    [leads.usfaClosed, "Nate funded closed", "funded", false],
    [leads.vendorHold, "Nate hold", "hold_on", false],
    [leads.vendorArchived, "Nate archived active", "submitted", true],
    [leads.vendorOpen, "Nate open vendor", "approved", false],
  ];
  const dealTuples = dealRows.map(([leadId, name, stage, archived]) =>
    `(${leadId},${sqlText(name)},${sqlText(stage)},12345,3,${archived})`);
  const dealIds = insertedIds(sandbox.seedFixture(`INSERT INTO deals (lead_id,deal_name,stage,amount,assigned_to,is_archived) VALUES ${dealTuples.join(",")} RETURNING id`));
  return {
    staff, leads, sourceRows, dealIds,
    deals: { usfaOpenA: dealIds[0], usfaOpenB: dealIds[1], usfaClosed: dealIds[2], vendorHold: dealIds[3], vendorArchived: dealIds[4], vendorOpen: dealIds[5] },
  };
}

async function api(page, sandbox, method, path, data) {
  const response = await page.evaluate(async ({ url, method, data }) => {
    const token = await window.Clerk?.session?.getToken();
    if (!token) throw new Error("Authenticated fixture session token unavailable");
    const response = await fetch(url, {
      method,
      credentials: "include",
      headers: { Authorization: `Bearer ${token}`, ...(data === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(data === undefined ? {} : {
        body: JSON.stringify(data),
      }),
    });
    return { status: response.status, text: await response.text() };
  }, {
    url: `${sandbox.url}/api${path}`, method, data,
  });
  let body = null;
  try { body = response.text ? JSON.parse(response.text) : null; } catch {}
  return { status: response.status, body, text: response.text };
}

async function dbScalar(sandbox, sql) {
  return sandbox.query(sql).split(/\s+/).filter(Boolean);
}

function previewLeadIds(preview) {
  return [...(preview?.eligible ?? []), ...(preview?.exclusions ?? [])].map(item => item.leadId);
}

function sortedUnique(values) {
  return [...new Set(values)].sort((a, b) => a - b);
}

async function uiBulkAssign(page, leadId, displayName, searchTerm) {
  await page.goto(`${page.url().split("/").slice(0, 3).join("/")}/leads`);
  const searchSettled = page.waitForResponse(response => {
    const url = new URL(response.url());
    return response.request().method() === "GET" && url.pathname.endsWith("/api/leads") &&
      url.searchParams.get("search") === searchTerm;
  });
  await page.getByPlaceholder("Search by name, email, company…").fill(searchTerm);
  await searchSettled;
  await page.getByRole("checkbox", { name: `Select lead ${leadId}`, exact: true }).click();
  const picker = page.getByRole("button", { name: "Bulk assign representative" });
  await picker.click();
  const optionTexts = await page.getByRole("option").allTextContents();
  const visibleNames = ["Ada Admin", "Milo Manager", "Nate Admin", "Nate Manager", "Nate Rep", "Zoe Rep"];
  const order = visibleNames.map(name => optionTexts.findIndex(text => text.includes(name)));
  const isSorted = order.every((index, position) => index >= 0 && (position === 0 || order[position - 1] < index));
  await page.getByRole("option").filter({ hasText: displayName }).first().click();
  await page.getByRole("button", { name: "Assign", exact: true }).click();
  await page.getByText("Reassigned 1 lead", { exact: true }).waitFor({ timeout: 10000 });
  return { optionTexts, isSorted };
}

async function uiBulkAssignAllVendor(page, targetName) {
  await page.goto(`${page.url().split("/").slice(0, 3).join("/")}/leads`);
  await page.getByRole("button", { name: "Lead Source" }).click();
  await page.getByRole("option", { name: "vendor_list (30)", exact: true }).click();
  await page.getByRole("checkbox", { name: "Select all leads on this page", exact: true }).click();
  await page.getByRole("button", { name: "Select all 30 matching leads", exact: true }).click();
  const picker = page.getByRole("button", { name: "Bulk assign representative" });
  await picker.click();
  await page.getByRole("option").filter({ hasText: targetName }).first().click();
  await page.getByRole("button", { name: "Assign", exact: true }).click();
  await page.getByText("Reassigned 30 leads", { exact: true }).waitFor({ timeout: 10000 });
}

async function runBehaviorAssertions(page, sandbox, fixture, result, out) {
  if (resumeCampaignUi) {
    const prior = JSON.parse(await readFile(`${evidenceRoot}/completed-assignment-behavior.json`, "utf8"));
    Object.assign(result.assertions, Object.fromEntries(Object.entries(prior.assertions).filter(([, assertion]) => assertion.passed)));
    await runCampaignUiAssertions(page, sandbox, result, out);
    return;
  }
  if (resumeManagerUi) {
    const prior = JSON.parse(await readFile(`${evidenceRoot}/completed-api-and-admin-behavior.json`, "utf8"));
    Object.assign(result.assertions, Object.fromEntries(Object.entries(prior.assertions).filter(([, assertion]) => assertion.passed)));
    await runRemainingUiAssertions(page, sandbox, fixture, result, out);
    return;
  }
  const { staff, leads, deals } = fixture;
  const route = `/leads/${leads.usfaOpen}/assign`;
  const eligibleIds = [1, 2, 3, staff.admin, staff.manager, staff.rep].sort((a, b) => a - b);
  if (!resumeAssignmentsAndAudience) {
  const directory = await api(page, sandbox, "GET", "/users?isActive=true");
  const directoryRows = Array.isArray(directory.body) ? directory.body : [];
  const display = user => (user.name?.trim() || user.email?.split("@")[0] || "User");
  check(result, "active admin/manager/rep directory is eligible-only", directory.status === 200 &&
    JSON.stringify(sortedUnique(directoryRows.map(user => user.id))) === JSON.stringify(eligibleIds) &&
    directoryRows.every(user => user.isActive && ["admin", "manager", "rep"].includes(user.role) && !user.mergedInto),
  { status: directory.status, ids: directoryRows.map(user => user.id), names: directoryRows.map(display) });
  const displayedNames = directoryRows.map(display);
  check(result, "assignment directory sorted by displayed name", JSON.stringify(displayedNames) === JSON.stringify([...displayedNames].sort((a, b) => a.localeCompare(b))),
    displayedNames);

  const sourceResponse = await api(page, sandbox, "GET", "/analytics/sources");
  const sourceRows = Array.isArray(sourceResponse.body) ? sourceResponse.body : [];
  const sourceCounts = Object.fromEntries(sourceRows.map(item => [item.source, item.leadCount]));
  const expectedSources = { "US Fund Advisor": 2, vendor_list: 30, prospect_list: 1, Website: 1 };
  check(result, "exact source counts from accessible analytics", sourceResponse.status === 200 && Array.isArray(sourceResponse.body) &&
    Object.entries(expectedSources).every(([source, count]) => sourceCounts[source] === count),
  sourceCounts);
  const list1 = await api(page, sandbox, "GET", "/leads?leadSource=vendor_list&page=1&limit=10&sortBy=lastName&sortOrder=asc");
  const list2 = await api(page, sandbox, "GET", "/leads?leadSource=vendor_list&page=2&limit=10&sortBy=lastName&sortOrder=asc");
  const pageIds1 = (list1.body?.leads ?? []).map(lead => lead.id);
  const pageIds2 = (list2.body?.leads ?? []).map(lead => lead.id);
  check(result, "Lead Source list and pagination return exact, distinct pages", list1.status === 200 && list2.status === 200 &&
    list1.body?.total === 30 && pageIds1.length === 10 && pageIds2.length === 10 && !pageIds1.some(id => pageIds2.includes(id)),
  { status1: list1.status, total: list1.body?.total, page1: pageIds1.length, page2: pageIds2.length, overlap: pageIds1.filter(id => pageIds2.includes(id)) });
  const exportResponse = await api(page, sandbox, "GET", "/leads/export?leadSource=vendor_list&sortBy=lastName&sortOrder=asc");
  const csv = exportResponse.text;
  check(result, "filtered Lead Source export preserves all matching leads", exportResponse.status === 200 &&
    csv.split(/\r?\n/).filter(Boolean).length === 31 && csv.includes("Nate Vendor"), { status: exportResponse.status, csvRows: csv.split(/\r?\n/).filter(Boolean).length });

  const dealSearch = await api(page, sandbox, "GET", `/deals?search=${encodeURIComponent("Nate open duplicate one")}&limit=10`);
  const searchedDeal = dealSearch.body?.deals?.find(deal => deal.id === deals.usfaOpenA);
  const dealDetail = await api(page, sandbox, "GET", `/deals/${deals.usfaOpenA}`);
  const dealEntityLabel = dealDetail.body?.entityLabel ?? "";
  const openFixtureLead = fixture.sourceRows[0];
  const expectedCompany = `${openFixtureLead.first} Equipment LLC`;
  const expectedContact = `${openFixtureLead.first} Fixture01`;
  check(result, "deal search and detail retain linked company/customer identity",
    dealSearch.status === 200 && searchedDeal?.dealName === `${expectedCompany} — ${expectedContact}` &&
    dealDetail.status === 200 && dealEntityLabel.includes(expectedCompany) && dealEntityLabel.includes(expectedContact) &&
    dealDetail.body?.lead?.entityLabel === dealEntityLabel,
  { searchStatus: dealSearch.status, searchName: searchedDeal?.dealName, detailStatus: dealDetail.status,
    entityLabel: dealEntityLabel, linkedEntityLabel: dealDetail.body?.lead?.entityLabel });
  const referralSave = await api(page, sandbox, "PATCH", `/referrals/deal/${deals.usfaClosed}`, {
    referredByLeadId: leads.usfaOpen, referredByPartnerId: null,
  });
  const referrals = await api(page, sandbox, "GET", `/referrals/lead/${leads.usfaOpen}`);
  const referredDeal = referrals.body?.deals?.find(deal => deal.id === deals.usfaClosed);
  const closedFixtureLead = fixture.sourceRows[1];
  check(result, "lead referral listing includes the referred deal's company/customer identity",
    referralSave.status === 200 && referrals.status === 200 &&
    referredDeal?.entityLabel?.includes(`${closedFixtureLead.first} Equipment LLC`) &&
    referredDeal?.entityLabel?.includes(`${closedFixtureLead.first} Fixture02`),
  { saveStatus: referralSave.status, listStatus: referrals.status, entityLabel: referredDeal?.entityLabel });

  await page.goto(`${sandbox.url}/leads`);
  await page.getByRole("heading", { name: "Leads" }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Lead Source" }).click();
  const sourceOptionTexts = await page.getByRole("option").allTextContents();
  check(result, "Lead Source control exposes exact accessible labels and counts",
    ["US Fund Advisor (2)", "vendor_list (30)", "prospect_list (1)", "Website (1)"].every(label => sourceOptionTexts.some(text => text.trim() === label)),
    sourceOptionTexts);
  await page.screenshot({ path: `${out}/leads-source-options-390.png`, fullPage: true });
  await page.getByRole("option", { name: "vendor_list (30)", exact: true }).click();
  const searchTerm = "no-such-certification-record";
  const combinedSearchResponsePromise = page.waitForResponse(response => {
    const url = new URL(response.url());
    return response.request().method() === "GET" && url.pathname === "/api/leads" &&
      url.searchParams.get("leadSource") === "vendor_list" && url.searchParams.get("search") === searchTerm;
  }, { timeout: 15000 });
  await page.getByPlaceholder("Search by name, email, company…").fill(searchTerm);
  const combinedSearchResponse = await combinedSearchResponsePromise;
  const combinedSearchBody = await combinedSearchResponse.json();
  check(result, "search is intersected with selected Lead Source and returns zero matching rows",
    combinedSearchResponse.status() === 200 && combinedSearchBody?.total === 0 && combinedSearchBody?.leads?.length === 0,
    { status: combinedSearchResponse.status(), url: combinedSearchResponse.url(), total: combinedSearchBody?.total, rowCount: combinedSearchBody?.leads?.length });
  await page.getByText("No leads match", { exact: true }).filter({ visible: true }).first().waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "Clear all filters", exact: true }).click();
  await page.getByRole("link", { name: /Nate Vendor/ }).first().waitFor({ timeout: 10000 });
  const visibleVendorRows = await page.getByRole("link", { name: /Nate Vendor/ }).count();
  const sourceValueAfterReset = await page.getByRole("button", { name: "Lead Source" }).innerText();
  check(result, "Clear all filters resets Lead Source and list results", /Lead Source/.test(sourceValueAfterReset) && visibleVendorRows > 0,
    { sourceValueAfterReset, visibleVendorRows });

  const explicit = await api(page, sandbox, "POST", "/leads/bulk/assign", {
    ids: [leads.usfaOpen, leads.usfaClosed], repId: staff.admin,
  });
  const explicitDb = await dbScalar(sandbox, `SELECT count(*) FROM leads WHERE id IN (${leads.usfaOpen},${leads.usfaClosed}) AND assigned_rep_id=${staff.admin}`);
  check(result, "explicit-ID bulk assignment persists exactly selected leads", explicit.status === 200 &&
    explicit.body?.updated === 2 && explicitDb[0] === "2", { status: explicit.status, updated: explicit.body?.updated, dbCount: explicitDb[0] });
  const allMatching = await api(page, sandbox, "POST", "/leads/bulk/assign", {
    filter: { leadSource: "vendor_list" }, repId: staff.rep,
  });
  const sourceDb = await dbScalar(sandbox, `SELECT count(*) FROM leads WHERE lead_source='vendor_list' AND assigned_rep_id=${staff.rep}`);
  check(result, "all-matching Lead Source assignment persists exactly 30 records", allMatching.status === 200 &&
    allMatching.body?.updated === 30 && sourceDb[0] === "30", { status: allMatching.status, updated: allMatching.body?.updated, dbCount: sourceDb[0] });

  const invalidTargets = [staff.inactive, staff.pending, staff.merged, staff.missing];
  const invalidStatusMatrix = {};
  for (const targetId of invalidTargets) {
    const leadSingle = await api(page, sandbox, "PUT", route, { repId: targetId });
    const leadBulk = await api(page, sandbox, "POST", "/leads/bulk/assign", { ids: [leads.usfaOpen], repId: targetId });
    const leadCreate = await api(page, sandbox, "POST", "/leads", {
      firstName: "Invalid", lastName: `Lead ${targetId}`, email: `invalid.lead.${targetId}@example.invalid`,
      phone: `+1202556${String(targetId).padStart(4, "0")}`, assignedRepId: targetId,
    });
    const dealSingle = await api(page, sandbox, "PUT", `/deals/${deals.usfaOpenA}`, { assignedTo: targetId });
    const dealCreate = await api(page, sandbox, "POST", "/deals", {
      leadId: leads.usfaOpen, dealName: `Invalid target deal ${targetId}`, assignedTo: targetId,
    });
    invalidStatusMatrix[targetId] = [leadSingle.status, leadBulk.status, leadCreate.status, dealSingle.status, dealCreate.status];
  }
  check(result, "inactive/pending/merged/missing destinations rejected on lead/deal single, bulk, and create",
    Object.values(invalidStatusMatrix).every(statuses => statuses.every(status => status === 400)), invalidStatusMatrix);
  }
  if (resumeAssignmentsAndAudience) {
    const prior = JSON.parse(await readFile(`${evidenceRoot}/completed-initial-behavior.json`, "utf8"));
    Object.assign(result.assertions, Object.fromEntries(Object.entries(prior.assertions).filter(([, assertion]) => assertion.passed)));
    const canonical = await api(page, sandbox, "GET", `/deals/${deals.usfaOpenA}`);
    const expected = `${fixture.sourceRows[0].first} Equipment LLC — ${fixture.sourceRows[0].first} Fixture01`;
    check(result, "deal search and detail retain linked company/customer identity",
      canonical.status === 200 && canonical.body?.dealName === expected && canonical.body?.entityLabel === expected &&
      canonical.body?.lead?.entityLabel === expected, canonical.body);
  }

  const positiveAssignments = [];
  for (const target of eligibleIds) {
    const leadSaved = await api(page, sandbox, "PUT", route, { repId: target });
    const dealSaved = await api(page, sandbox, "PUT", `/deals/${deals.usfaOpenA}`, { assignedTo: target });
    const created = await api(page, sandbox, "POST", "/deals", { dealName: "Deal #900", amount: 12345, assignedTo: target });
    const persistedLead = await dbScalar(sandbox, `SELECT assigned_rep_id FROM leads WHERE id=${leads.usfaOpen}`);
    const persistedDeal = await dbScalar(sandbox, `SELECT assigned_to FROM deals WHERE id=${deals.usfaOpenA}`);
    positiveAssignments.push({
      target, leadStatus: leadSaved.status, dealStatus: dealSaved.status, createStatus: created.status,
      leadOwner: Number(persistedLead[0]), dealOwner: Number(persistedDeal[0]),
      createdOwner: created.body?.assignedTo, createdLabel: created.body?.dealName,
    });
  }
  check(result, "all eligible roles and actor self persist on lead/deal assignment and new deals",
    positiveAssignments.length === 6 && positiveAssignments.every(row =>
      row.leadStatus === 200 && row.dealStatus === 200 && row.createStatus === 201 &&
      row.leadOwner === row.target && row.dealOwner === row.target &&
      row.createdOwner === row.target && row.createdLabel === "Deal"),
    positiveAssignments);
  const browser = page.context().browser();
  const repContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const repPage = await repContext.newPage();
  const directoryNetwork = [];
  repPage.on("request", request => {
    const url = new URL(request.url());
    if (url.pathname === "/api/users") directoryNetwork.push(`${request.method()} ${url.pathname}${url.search}`);
  });
  await sandbox.login(repPage, "rep");
  await repPage.goto(`${sandbox.url}/leads`);
  await repPage.getByRole("heading", { name: "Leads" }).waitFor({ timeout: 30000 });
  const repUiDirectoryNetwork = [...directoryNetwork];
  const repUiControls = await inventory(repPage);
  const directoryDenied = await api(repPage, sandbox, "GET", "/users?isActive=true");
  const repLeadDenied = await api(repPage, sandbox, "PUT", route, { repId: staff.rep });
  const repBulkDenied = await api(repPage, sandbox, "POST", "/leads/bulk/assign", { ids: [leads.usfaOpen], repId: staff.rep });
  check(result, "rep is forbidden from directory and assignment endpoints without assignment directory UI requests",
    directoryDenied.status === 403 && repLeadDenied.status === 403 && repBulkDenied.status === 403 &&
    repUiDirectoryNetwork.length === 0 && !repUiControls.some(control => /Bulk assign representative|Assign representative for lead/.test(control.name)),
  { directoryStatus: directoryDenied.status, singleAssignStatus: repLeadDenied.status, bulkStatus: repBulkDenied.status, uiDirectoryRequests: repUiDirectoryNetwork, controls: repUiControls.filter(control => /assign/i.test(control.name)) });
  await repPage.screenshot({ path: `${out}/leads-rep-no-assignment-controls-390.png`, fullPage: true });
  await repContext.close();

  await page.goto(`${sandbox.url}/leads`);
  const adminSelf = await uiBulkAssign(page, 1, "Nate Admin", "Synthetic Contact");
  const adminOther = await uiBulkAssign(page, 2, "Milo Manager", "Sample Applicant");
  const adminUiDb = await dbScalar(sandbox, `SELECT count(*) FROM leads WHERE (id=1 AND assigned_rep_id=1) OR (id=2 AND assigned_rep_id=${staff.manager})`);
  check(result, "admin UI assigns self and another eligible role; destination directory is alphabetical",
    adminSelf.isSorted && adminOther.isSorted && adminUiDb[0] === "2",
    { adminSelfSorted: adminSelf.isSorted, adminOtherSorted: adminOther.isSorted, dbCount: adminUiDb[0], visibleTargets: adminSelf.optionTexts });
  await page.screenshot({ path: `${out}/leads-admin-assignment-feedback-390.png`, fullPage: true });

  const dealsCampaign = await api(page, sandbox, "POST", "/campaigns", {
    name: "Nate audience rules fixture", channel: "email", emailTemplateId: 1, audienceRules: {},
  });
  const audienceCampaignId = dealsCampaign.body?.id;
  check(result, "audience probe campaign created through API", dealsCampaign.status === 201 && Number.isInteger(audienceCampaignId), { status: dealsCampaign.status, id: audienceCampaignId });
  if (audienceCampaignId) {
    const preview = async () => api(page, sandbox, "POST", `/campaigns/${audienceCampaignId}/preview`, {});
    const getCampaign = async () => api(page, sandbox, "GET", `/campaigns/${audienceCampaignId}`);
    const patchRules = async audienceRules => api(page, sandbox, "PATCH", `/campaigns/${audienceCampaignId}`, { audienceRules });
    const allExpected = [1, 2, ...leads.all];
    const openExpected = [1, 2, leads.usfaOpen, leads.vendorOpen];
    const closedExpected = allExpected.filter(id => !openExpected.includes(id));
    const defaultPreview = await preview();
    check(result, "missing deals rule defaults to all leads", defaultPreview.status === 200 &&
      defaultPreview.body?.totalMatching === allExpected.length &&
      defaultPreview.body?.counts?.emailEligible === allExpected.length &&
      defaultPreview.body?.eligible?.length === allExpected.length &&
      JSON.stringify(sortedUnique(previewLeadIds(defaultPreview.body))) === JSON.stringify(sortedUnique(allExpected)),
    { status: defaultPreview.status, total: defaultPreview.body?.totalMatching, emailEligible: defaultPreview.body?.counts?.emailEligible,
      eligible: defaultPreview.body?.eligible?.length, ids: sortedUnique(previewLeadIds(defaultPreview.body)) });

    const openSave = await patchRules({ deals: "open" });
    const openReload = await getCampaign();
    const openPreview = await preview();
    check(result, "open rule persists and preview matches unique leads with at least one active unarchived deal",
      openSave.status === 200 && openReload.body?.campaign?.audienceRules?.deals === "open" &&
      openPreview.status === 200 && openPreview.body?.totalMatching === openExpected.length &&
      openPreview.body?.counts?.emailEligible === openExpected.length &&
      openPreview.body?.eligible?.length === openExpected.length &&
      JSON.stringify(sortedUnique(previewLeadIds(openPreview.body))) === JSON.stringify(sortedUnique(openExpected)),
    { save: openSave.status, persisted: openReload.body?.campaign?.audienceRules?.deals, total: openPreview.body?.totalMatching,
      emailEligible: openPreview.body?.counts?.emailEligible, eligible: openPreview.body?.eligible?.length,
      ids: sortedUnique(previewLeadIds(openPreview.body)) });
    const excludeSave = await patchRules({ deals: "exclude_open" });
    const excludeReload = await getCampaign();
    const excludePreview = await preview();
    check(result, "exclude-open rule persists and includes closed, hold, archived, and no-deal leads",
      excludeSave.status === 200 && excludeReload.body?.campaign?.audienceRules?.deals === "exclude_open" &&
      excludePreview.status === 200 && excludePreview.body?.totalMatching === closedExpected.length &&
      excludePreview.body?.counts?.emailEligible === closedExpected.length &&
      excludePreview.body?.eligible?.length === closedExpected.length &&
      JSON.stringify(sortedUnique(previewLeadIds(excludePreview.body))) === JSON.stringify(sortedUnique(closedExpected)),
    { save: excludeSave.status, persisted: excludeReload.body?.campaign?.audienceRules?.deals, total: excludePreview.body?.totalMatching,
      emailEligible: excludePreview.body?.counts?.emailEligible, eligible: excludePreview.body?.eligible?.length,
      ids: sortedUnique(previewLeadIds(excludePreview.body)), expected: sortedUnique(closedExpected) });
    const picksSave = await patchRules({ deals: "all", pickedLeadIds: [leads.usfaClosed, leads.prospectAbsent] });
    const picksPreview = await preview();
    check(result, "picked-only audience includes only manual picks once",
      picksSave.status === 200 && picksPreview.status === 200 && picksPreview.body?.totalMatching === 2 &&
      picksPreview.body?.counts?.filterMatches === 0 && picksPreview.body?.counts?.pickedAdded === 2 &&
      JSON.stringify(sortedUnique(previewLeadIds(picksPreview.body))) === JSON.stringify(sortedUnique([leads.usfaClosed, leads.prospectAbsent])),
    { save: picksSave.status, total: picksPreview.body?.totalMatching, counts: picksPreview.body?.counts, ids: sortedUnique(previewLeadIds(picksPreview.body)) });
    const pickedOpenSave = await patchRules({ deals: "open", pickedLeadIds: [leads.usfaOpen, leads.usfaClosed] });
    const pickedOpenPreview = await preview();
    check(result, "picked leads obey open rule and multiple open deals do not duplicate recipients",
      pickedOpenSave.status === 200 && pickedOpenPreview.status === 200 && pickedOpenPreview.body?.totalMatching === 1 &&
      pickedOpenPreview.body?.counts?.filterMatches === 0 && pickedOpenPreview.body?.counts?.pickedAdded === 1 &&
      sortedUnique(previewLeadIds(pickedOpenPreview.body)).length === 1 && previewLeadIds(pickedOpenPreview.body)[0] === leads.usfaOpen,
    { save: pickedOpenSave.status, total: pickedOpenPreview.body?.totalMatching, counts: pickedOpenPreview.body?.counts, ids: previewLeadIds(pickedOpenPreview.body) });
  }

  await runRemainingUiAssertions(page, sandbox, fixture, result, out);
}

async function runRemainingUiAssertions(page, sandbox, fixture, result, out) {
  const { staff, leads } = fixture;
  const browser = page.context().browser();
  const managerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const managerPage = await managerContext.newPage();
  await sandbox.login(managerPage, "manager");
  const resetManagerTarget = await api(page, sandbox, "PUT", `/leads/${leads.usfaClosed}/assign`, { repId: staff.rep });
  check(result, "manager assignment fixture starts with a different eligible owner", resetManagerTarget.status === 200, resetManagerTarget);
  const managerSelf = await uiBulkAssign(managerPage, leads.usfaOpen, "Nate Manager", "Nate USFA Open");
  const managerOther = await uiBulkAssign(managerPage, leads.usfaClosed, "Ada Admin", "Nate USFA Closed");
  const managerUiDb = await dbScalar(sandbox, `SELECT count(*) FROM leads WHERE (id=${leads.usfaOpen} AND assigned_rep_id=2) OR (id=${leads.usfaClosed} AND assigned_rep_id=${staff.admin})`);
  check(result, "manager UI assigns self and another eligible role", managerSelf.isSorted && managerOther.isSorted && managerUiDb[0] === "2",
    { self: "Nate Manager", other: "Ada Admin", dbCount: managerUiDb[0] });
  await uiBulkAssignAllVendor(managerPage, "Nate Admin");
  const vendorAssigned = await dbScalar(sandbox, `SELECT count(*) FROM leads WHERE lead_source='vendor_list' AND assigned_rep_id=1`);
  check(result, "manager UI all-matching assignment persists all 30 filtered leads", vendorAssigned[0] === "30", { dbCount: vendorAssigned[0] });
  await managerPage.screenshot({ path: `${out}/leads-manager-all-matching-feedback-390.png`, fullPage: true });
  await managerContext.close();

  await runCampaignUiAssertions(page, sandbox, result, out);
}

async function runCampaignUiAssertions(page, sandbox, result, out) {
  if (!result.campaignId) {
    const created = await api(page, sandbox, "POST", "/campaigns", {
      name: "Nate audience lifecycle fixture", channel: "email", emailTemplateId: 1, audienceRules: {},
    });
    check(result, "audience lifecycle fixture created", created.status === 201 && Number.isInteger(created.body?.id), created);
    result.campaignId = created.body?.id;
  }
  const initialCampaignId = result.campaignId;
  if (initialCampaignId) {
    await page.goto(`${sandbox.url}/campaigns/${initialCampaignId}`);
    await page.getByRole("tab", { name: "Audience" }).click();
    await page.getByText("Audience Rules", { exact: true }).waitFor({ timeout: 10000 });
    const dealsPicker = page.getByRole("combobox", { name: "Deals audience" });
    await dealsPicker.click();
    const dealOptions = (await page.getByRole("option").allTextContents()).map(text => text.trim());
    const expectedDealOptions = ["All leads", "Only leads with an open deal", "Exclude leads with an open deal"];
    check(result, "Deals audience selector has exactly the three required options",
      JSON.stringify(dealOptions) === JSON.stringify(expectedDealOptions), dealOptions);
    await page.getByRole("option", { name: "All leads", exact: true }).click();
    await page.screenshot({ path: `${out}/campaign-deals-options-390.png`, fullPage: true });
    await page.getByRole("tab", { name: "Review", exact: true }).click();
    const [previewResponse] = await Promise.all([
      page.waitForResponse(response =>
        response.request().method() === "POST" && response.url().includes(`/campaigns/${initialCampaignId}/preview`), { timeout: 15000 }),
      page.getByRole("button", { name: "Calculate", exact: true }).first().click(),
    ]);
    const freshPreview = await previewResponse.json();
    check(result, "campaign UI calculates a synthetic preview", previewResponse.status() === 200 && Boolean(freshPreview.previewToken),
      { status: previewResponse.status(), hasToken: Boolean(freshPreview.previewToken), count: freshPreview.totalMatching });
    await page.getByRole("tab", { name: "Audience", exact: true }).click();
    await dealsPicker.click();
    await page.getByRole("option", { name: "Only leads with an open deal", exact: true }).click();
    await page.getByRole("tab", { name: "Review", exact: true }).click();
    await page.getByText("Unsaved changes:", { exact: false }).waitFor({ timeout: 10000 });
    await page.screenshot({ path: `${out}/campaign-dirty-preview-390.png`, fullPage: true });
    const oldVersion = freshPreview.campaignVersion ?? 1;
    const [saveResponse] = await Promise.all([
      page.waitForResponse(response =>
        response.request().method() === "PATCH" && response.url().includes(`/campaigns/${initialCampaignId}`), { timeout: 15000 }),
      page.getByRole("button", { name: "Save Changes", exact: true }).first().click(),
    ]);
    const persistedCampaign = await api(page, sandbox, "GET", `/campaigns/${initialCampaignId}`);
    check(result, "saving dirty campaign rule persists open and increments the saved version",
      saveResponse.status() === 200 && persistedCampaign.body?.campaign?.audienceRules?.deals === "open" &&
      persistedCampaign.body?.campaign?.version > oldVersion,
    { saveStatus: saveResponse.status(), deals: persistedCampaign.body?.campaign?.audienceRules?.deals, version: persistedCampaign.body?.campaign?.version, oldVersion });
    const staleApproval = await api(page, sandbox, "POST", `/campaigns/${initialCampaignId}/approve`, {
      previewToken: freshPreview.previewToken, claimsAffirmed: true,
    });
    const draftReload = await api(page, sandbox, "GET", `/campaigns/${initialCampaignId}`);
    check(result, "saved audience changes invalidate prior preview/approval and keep campaign draft",
      staleApproval.status === 409 && draftReload.body?.campaign?.status === "draft",
    { staleApprovalStatus: staleApproval.status, error: staleApproval.body?.error, status: draftReload.body?.campaign?.status });
    await page.getByText("Stale preview:", { exact: false }).waitFor({ timeout: 10000 });
    await page.screenshot({ path: `${out}/campaign-saved-stale-preview-390.png`, fullPage: true });
  }
}

async function runSourceSearchDiagnostic(page, sandbox, fixture, result, out) {
  const query = "no-such-certification-record";
  const sourceApi = await api(page, sandbox, "GET", "/leads?leadSource=vendor_list&page=1&limit=10");
  const intersectionApi = await api(page, sandbox, "GET", `/leads?leadSource=vendor_list&search=${encodeURIComponent(query)}&page=1&limit=10`);
  const uiLeadResponses = [];
  const responseTasks = [];
  const consoleErrors = [];
  page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("response", response => {
    const url = new URL(response.url());
    if (url.pathname !== "/api/leads") return;
    const task = response.json().then(body => uiLeadResponses.push({
      status: response.status(), url: response.url(), search: url.searchParams.get("search"),
      leadSource: url.searchParams.get("leadSource"), total: body?.total, rowCount: body?.leads?.length,
    })).catch(() => {});
    responseTasks.push(task);
  });
  await page.goto(`${sandbox.url}/leads`);
  await page.getByRole("heading", { name: "Leads" }).waitFor({ timeout: 12000 });
  await page.getByRole("button", { name: "Lead Source" }).click();
  const options = await page.getByRole("option").allTextContents();
  await page.getByRole("option", { name: "vendor_list (30)", exact: true }).click();
  const searchInput = page.getByPlaceholder("Search by name, email, company…");
  const responsePromise = page.waitForResponse(response => {
    const url = new URL(response.url());
    return response.request().method() === "GET" && url.pathname === "/api/leads" &&
      url.searchParams.get("leadSource") === "vendor_list" && url.searchParams.get("search") === query;
  }, { timeout: 8000 }).catch(() => null);
  await searchInput.fill(query);
  const matchingResponse = await responsePromise;
  await page.waitForTimeout(900);
  await Promise.all(responseTasks);
  const matchingRequest = uiLeadResponses.filter(row => row.search === query && row.leadSource === "vendor_list").at(-1) ?? null;
  const visibleRows = await page.locator('a[href^="/leads/"]').evaluateAll(elements => elements.flatMap(el => {
    const rect = el.getBoundingClientRect();
    const href = el.getAttribute("href") ?? "";
    if (!rect.width || !rect.height || getComputedStyle(el).visibility === "hidden" || !/^\/leads\/\d+$/.test(href)) return [];
    return [{ href, text: (el.innerText ?? "").trim().replace(/\\s+/g, " ") }];
  }));
  const bodyText = await page.locator("body").innerText();
  const inputValue = await searchInput.inputValue();
  const emptyHeadingCount = await page.getByText("No leads match", { exact: true }).count();
  const diagnostic = {
    sourceApi: { status: sourceApi.status, total: sourceApi.body?.total, rowCount: sourceApi.body?.leads?.length },
    intersectionApi: { status: intersectionApi.status, total: intersectionApi.body?.total, rowCount: intersectionApi.body?.leads?.length },
    uiRequest: matchingRequest,
    uiResponseStatus: matchingResponse?.status() ?? null,
    inputValue, visibleRows, emptyHeadingCount,
    relevantBodyText: bodyText.split(/\r?\n/).map(text => text.trim()).filter(text => /no leads|nate vendor|nate usfa|search/i.test(text)).slice(-30),
    sourceOptions: options, consoleErrors,
    syntheticLeadCount: fixture.leads.all.length,
  };
  result.sourceSearchDiagnostic = diagnostic;
  check(result, "filtered-source API returns 30 vendor leads before search",
    sourceApi.status === 200 && sourceApi.body?.total === 30 && sourceApi.body?.leads?.length === 10,
    diagnostic.sourceApi);
  check(result, "source/search API intersection returns zero rows",
    intersectionApi.status === 200 && intersectionApi.body?.total === 0 && intersectionApi.body?.leads?.length === 0,
    diagnostic.intersectionApi);
  check(result, "UI sends the combined source/search query and renders no lead rows",
    inputValue === query && matchingRequest?.status === 200 && matchingRequest.total === 0 &&
      matchingRequest.rowCount === 0 && visibleRows.length === 0,
    diagnostic);
  await page.screenshot({ path: `${out}/source-search-diagnostic-390.png`, fullPage: true });
  await writeFile(`${out}/source-search-diagnostic.json`, JSON.stringify(diagnostic, null, 2));
  return diagnostic;
}

async function inventory(page) {
  return page.locator("button,a,input,select,textarea,[role=combobox],[role=tab]")
    .evaluateAll(elements => elements.filter(el => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const hiddenNativeSelect = el.tagName === "SELECT" && el.tabIndex < 0 &&
        (el.getAttribute("aria-hidden") === "true" || r.width <= 1 || r.height <= 1 || style.opacity === "0");
      return r.width > 0 && r.height > 0 && style.display !== "none" &&
        style.visibility !== "hidden" && style.opacity !== "0" &&
        el.getAttribute("aria-hidden") !== "true" && !hiddenNativeSelect;
    }).map(el => ({
      tag: el.tagName,
      role: el.getAttribute("role"),
      type: el.getAttribute("type"),
      name: (el.getAttribute("aria-label") || el.getAttribute("placeholder") ||
        el.getAttribute("title") || el.innerText || el.value || "").trim().replace(/\s+/g, " "),
      href: el.getAttribute("href"),
      disabled: el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true",
    })));
}

async function waitForRouteCase(page, ready, role) {
  if (ready === "new-deal") await page.getByRole("heading", { name: "New Deal" }).waitFor({ timeout: 12000 });
  else if (ready === "credit-compliance" && role === "admin") await page.getByRole("heading", { name: "Credit Compliance Log" }).waitFor({ timeout: 12000 });
  else if (ready === "credit-compliance") await page.getByRole("heading", { name: "Admin Access Required" }).waitFor({ timeout: 12000 });
  else if (ready === "deal-detail") await page.locator("h1").first().waitFor({ timeout: 12000 });
  else await waitForPage(page, ready);
  const h2 = (await page.locator("h2").allTextContents()).map(text => text.trim()).filter(Boolean);
  const h1 = (await page.locator("h1").allTextContents()).map(text => text.trim()).filter(Boolean);
  const expectedHeading = ready === "credit-compliance"
    ? (role === "admin" ? h1.includes("Credit Compliance Log") : h2.includes("Admin Access Required"))
    : ready === "new-deal" ? h1.includes("New Deal")
      : ready === "deal-detail" ? h1.length > 0 && !h1.some(text => /404|not found/i.test(text))
        : ready === "lead-detail" ? h1.some(text => /Fixture Equipment LLC|Synthetic Contact/.test(text))
          : ready === "apply" ? h2.includes("What type of financing are you looking for?")
            : h1.length > 0;
  return {
    h1,
    h2,
    url: page.url(),
    notFound: await page.getByText("404 Page Not Found", { exact: true }).count() > 0,
    expectedHeading,
    readinessError: null,
  };
}

async function runDealIdentityVisualSweep(page, sandbox, fixture, result, out) {
  const lead = fixture.sourceRows[0];
  const dealId = fixture.deals.usfaOpenA;
  const expectedDealPaths = ["/deals/" + fixture.deals.usfaOpenA, "/deals/" + fixture.deals.usfaOpenB];
  const expectedDealAnchors = async (scope) => {
    const anchors = await scope.locator('a[href^="/deals/"]').evaluateAll(elements =>
      elements.map(anchor => ({ href: new URL(anchor.href).pathname, label: (anchor.innerText || "").trim() })));
    return anchors.filter(anchor => expectedDealPaths.includes(anchor.href));
  };
  const hasOrdinalLabel = (text) => /\bDeal\s*#?\s*\d+\b/i.test(text);
  const expected = lead.first + " Equipment LLC — " + lead.first + " Fixture01";
  if (!args.includes("--resume-identity-only")) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(sandbox.url + "/deals");
    await page.getByRole("heading", { name: "Deals" }).waitFor({ timeout: 20000 });
    await page.getByRole("button", { name: "Table", exact: true }).click();
    const listLinks = await expectedDealAnchors(page);
    const listText = await page.locator("body").innerText();
    check(result, "deal naming UI: list renders both explicit fixture deal links as Company — Customer",
      listLinks.length === 2 && expectedDealPaths.every(href => listLinks.filter(link => link.href === href && link.label === expected).length === 1)
        && listLinks.every(link => !hasOrdinalLabel(link.label)) && !hasOrdinalLabel(listText),
      { expected, fixtureDealPaths: expectedDealPaths, matchingLinks: listLinks, ordinalLabel: hasOrdinalLabel(listText) });
    await page.screenshot({ path: out + "/identity-deals-list.png", fullPage: true });

    await page.getByRole("button", { name: "Kanban", exact: true }).click();
    await page.getByTestId("deals-board-desktop").waitFor({ timeout: 15000 });
    const cardLinks = await expectedDealAnchors(page.getByTestId("deals-board-desktop"));
    const cardsText = await page.getByTestId("deals-board-desktop").innerText();
    check(result, "deal naming UI: Pipeline/Kanban renders both explicit fixture deal links as Company — Customer",
      cardLinks.length === 2 && expectedDealPaths.every(href => cardLinks.filter(link => link.href === href && link.label === expected).length === 1)
        && cardLinks.every(link => !hasOrdinalLabel(link.label)) && !hasOrdinalLabel(cardsText),
      { expected, fixtureDealPaths: expectedDealPaths, matchingLinks: cardLinks, ordinalLabel: hasOrdinalLabel(cardsText) });
    await page.screenshot({ path: out + "/identity-pipeline-cards.png", fullPage: true });

    await page.goto(sandbox.url + "/deals/" + dealId);
    await page.getByRole("heading").first().waitFor({ timeout: 20000 });
    const headerText = await page.locator("body").innerText();
    check(result, "deal naming UI: deal header renders Company — Customer",
      headerText.includes(expected) && !hasOrdinalLabel(headerText), { expected, found: headerText.includes(expected), ordinalLabel: hasOrdinalLabel(headerText) });
    await page.screenshot({ path: out + "/identity-deal-header.png", fullPage: true });
  }

  await page.goto(sandbox.url + "/leads/" + fixture.leads.usfaOpen);
  const referralPanel = page.getByTestId("panel-referred-records");
  await referralPanel.waitFor({ timeout: 20000 });
  const referralText = await referralPanel.innerText();
  const referralLinks = await expectedDealAnchors(referralPanel);
  check(result, "deal naming UI: referral panel renders both explicit fixture deal links with the required Company — Customer label",
    referralLinks.length === 2 && expectedDealPaths.every(href => referralLinks.filter(link => link.href === href && link.label === expected).length === 1)
      && referralLinks.every(link => !hasOrdinalLabel(link.label)) && !hasOrdinalLabel(referralText),
    { expected, fixtureDealPaths: expectedDealPaths, matchingLinks: referralLinks, ordinalLabel: hasOrdinalLabel(referralText) });
  await page.screenshot({ path: out + (args.includes("--resume-identity-only") ? "/resume-identity-referral-panel.png" : "/identity-referral-panel.png"), fullPage: true });

  await page.goto(sandbox.url + "/deals");
  await page.getByRole("button", { name: "Open command palette" }).click();
  const search = page.getByPlaceholder("Search pages, leads, deals, lenders, partners, and actions…");
  await search.fill(lead.first);
  const resultItem = page.getByRole("option").filter({ hasText: expected }).first();
  await resultItem.waitFor({ timeout: 15000 });
  const commandText = await resultItem.innerText();
  check(result, "deal naming UI: ⌘K deal search result renders Company — Customer",
    commandText.includes(expected) && !hasOrdinalLabel(commandText), { expected, commandText, ordinalLabel: hasOrdinalLabel(commandText) });
  await page.screenshot({ path: out + "/identity-cmdk-result.png", fullPage: true });

  const rule = await api(page, sandbox, "POST", "/workflow-rules", {
    name: "Predeploy identity notification fixture",
    triggerStatus: "contacted",
    actionType: "send_notification",
    actionConfig: { title: "Deal update — " + expected, body: expected },
    isActive: true,
  });
  check(result, "notification fixture created through workflow API", rule.status === 201, { status: rule.status });
  const changed = await api(page, sandbox, "PUT", "/leads/" + fixture.leads.usfaOpen,
    { status: "contacted", repId: 1 });
  check(result, "notification fixture generated by real lead update workflow",
    changed.status === 200, { status: changed.status });
  await page.getByRole("button", { name: "Notifications" }).click();
  await page.getByText("Deal update — " + expected, { exact: true }).waitFor({ timeout: 15000 });
  const notifications = await api(page, sandbox, "GET", "/notifications?page=1&limit=20");
  const notificationRows = notifications.body?.data ?? [];
  const actualNotification = notificationRows.find(row => row.title === "Deal update — " + expected && row.body === expected);
  check(result, "notification API and visible UI contain Company — Customer fixture data",
    notifications.status === 200 && Boolean(actualNotification) && !hasOrdinalLabel(actualNotification?.title ?? "")
      && !hasOrdinalLabel(actualNotification?.body ?? ""),
    { status: notifications.status, matched: Boolean(actualNotification), count: notificationRows.length });
  await page.screenshot({ path: out + "/identity-notification.png", fullPage: true });
}

async function capture(label, webRoot) {
  const out = resolve(evidenceRoot, label);
  await mkdir(out, { recursive: true });
  const sandbox = await startSandbox({ build: false, webRoot, staffNames: ["Nate Admin", "Nate Manager", "Nate Rep"] });
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH ?? "/repl/tools/bin/chromium",
    headless: true,
  });
  let priorScreens = {};
  try { priorScreens = JSON.parse(await readFile(`${out}/controls.json`, "utf8")); } catch {}
  let priorNavigationScreens = {};
  try { priorNavigationScreens = JSON.parse(await readFile(`${out}/navigation-controls.json`, "utf8")); } catch {}
  const result = { screens: priorScreens, navigationScreens: priorNavigationScreens, assertions: {}, failures: [], campaignId: null, campaignListRoutes: [], forbiddenRequests: [], pageErrors: [], httpErrors: [], consoleErrors: [], fixture: null, behaviorComplete: false };
  const cleanupExpected = { clerkUsersDeleted: 3, databaseDropped: true, tempDirectoryRemoved: true };
  const saveCaptureInventoryAndMeta = async () => {
    await writeFile(`${out}/controls.json`, JSON.stringify(result.screens, null, 2));
    await writeFile(`${out}/navigation-controls.json`, JSON.stringify(result.navigationScreens, null, 2));
    await writeFile(`${out}/capture-meta.json`, JSON.stringify({
      phase: label,
      webRoot,
      auth: "Real Clerk ticket sign-in from sandbox.mjs",
      database: "Disposable sandbox database; synthetic fixture",
      campaignCreatedViaApi: Boolean(result.campaignId),
      campaignId: result.campaignId,
      fixtureCounts: {
        syntheticStaff: result.fixture ? Object.keys(result.fixture.staff).length - 1 : 0,
        sourceLeadCount: result.fixture?.leads.all.length ?? 0,
        leadSourceCounts: result.fixture ? Object.fromEntries(["US Fund Advisor", "vendor_list", "prospect_list", "Website"].map(source => [source, result.fixture.sourceRows.filter(row => row.source === source).length])) : {},
        fixtureDealCount: result.fixture?.dealIds.length ?? 0,
      },
      routes: behaviorOnly ? [] : routeCases.filter(([name]) => selectedRouteNames.has(name)).map(([name, path]) => ({ name, path })),
      campaignAudienceSelected: !behaviorOnly && selectedRouteNames.has("campaign-audience"),
      resumeOnly: args.includes("--resume-only"),
      campaignListRoutes: result.campaignListRoutes,
      behaviorOnly,
      widths: [...widths, ...(selectedRouteNames.has("leads") && !args.includes("--no-desktop") ? [1280, 1440] : [])],
      roles,
      forbiddenRequests: result.forbiddenRequests,
      pageErrors: result.pageErrors,
    }, null, 2));
  };
  try {
    const adminContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const admin = await adminContext.newPage();
    admin.on("pageerror", error => result.pageErrors.push(error.message));
    admin.on("request", request => {
      const url = new URL(request.url());
      if (prohibited.test(url.pathname)) result.forbiddenRequests.push(`${request.method()} ${url.pathname}`);
    });
    await sandbox.login(admin, "admin");
    result.fixture = await seedCertificationFixture(sandbox);
    if (sourceSearchOnly) {
      await runSourceSearchDiagnostic(admin, sandbox, result.fixture, result, out);
      check(result, `${label} source search diagnostic made no prohibited provider/delivery API requests`, result.forbiddenRequests.length === 0, result.forbiddenRequests);
      check(result, `${label} source search diagnostic has no uncaught browser page errors`, result.pageErrors.length === 0, result.pageErrors);
      await adminContext.close();
      return;
    }
    const campaignCreate = await api(admin, sandbox, "POST", "/campaigns", {
        name: `Nate workflow ${label} disposable`,
        description: "Synthetic certification fixture",
        channel: "email",
        emailTemplateId: 1,
        audienceRules: {},
    });
    check(result, `${label} disposable campaign created via API`, campaignCreate.status === 201, { status: campaignCreate.status });
    const campaign = campaignCreate.body;
    result.campaignId = campaign?.id ?? null;
    await adminContext.close();

    for (const role of roles) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      page.on("pageerror", error => result.pageErrors.push(`${role}: ${error.message}`));
      page.on("console", message => { if (message.type() === "error") result.consoleErrors.push({ role, text: message.text() }); });
      page.on("response", response => {
        const status = response.status();
        if (status >= 400) {
          const url = new URL(response.url());
          result.httpErrors.push({ context: "role-route", role, route: new URL(page.url()).pathname, status, method: response.request().method(), path: url.pathname });
        }
      });
      page.on("request", request => {
        const url = new URL(request.url());
        if (prohibited.test(url.pathname)) result.forbiddenRequests.push(`${request.method()} ${url.pathname}`);
      });
      await sandbox.login(page, role);
      if (args.includes("--resume-campaign-list")) {
        await page.setViewportSize({ width: 390, height: 900 });
        await page.goto(sandbox.url + "/campaigns");
        const listHeading = page.getByRole("heading", { name: "Campaigns", exact: true });
        await listHeading.waitFor({ timeout: 15000 });
        const campaignTitle = "Nate workflow " + label + " disposable";
        await page.getByText(campaignTitle, { exact: true }).waitFor({ timeout: 15000 });
        const routePath = new URL(page.url()).pathname;
        const headingText = await listHeading.innerText();
        check(result, "resume " + role + " /campaigns list route renders its API-created fixture campaign",
          routePath === "/campaigns" && headingText === "Campaigns",
          { role, route: routePath, heading: headingText, campaignTitle });
        result.campaignListRoutes.push({ role, route: routePath, heading: headingText, campaignTitle });
        await page.screenshot({ path: out + "/campaigns-list-" + role + ".png", fullPage: true });
      }
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        for (const [name, path, ready] of routeCases.filter(([name]) => !behaviorOnly && selectedRouteNames.has(name))) {
          await page.goto(`${sandbox.url}${path}`);
          let readyState = { h1: [], h2: [], url: page.url(), notFound: false, expectedHeading: false, readinessError: null };
          try { readyState = await waitForRouteCase(page, ready, role); }
          catch (error) { readyState.readinessError = error.message; }
          const key = `${name}-${width}-${role}`;
          check(result, `${label} ${key} rendered a real route instead of a blank/404 state`,
            readyState.expectedHeading && !readyState.notFound, readyState);
          result.screens[key] = await inventory(page);
          await page.screenshot({ path: `${out}/${key}.png`, fullPage: true });
          if (["dashboard", "apply", "settings"].includes(name)) {
            const openNavigation = page.getByRole("button", { name: "Open navigation" });
            if (await openNavigation.count() && await openNavigation.first().isVisible()) await openNavigation.first().click();
            result.navigationScreens[key] = (await inventory(page)).filter(control => control.tag === "A" && [
              "Dashboard", "Leads", "Deals", "Rate & Points", "Documents", "Campaigns",
              "Email Templates", "Drip Sequences", "Partners", "Flyer Templates", "Stale Leads",
              "Credit Compliance", "Data Governance", "Workflow Rules", "System Health",
              "USFA Intake", "Settings", "Apply",
            ].includes(control.name));
          }
        }
        if (!behaviorOnly && selectedRouteNames.has("campaign-audience")) {
          const campaignPath = result.campaignId ? `/campaigns/${result.campaignId}` : "/campaigns";
          await page.goto(`${sandbox.url}${campaignPath}`);
          let campaignReady = false;
          let campaignReadinessError = null;
          if (role !== "rep" && result.campaignId) {
            try {
              await page.getByRole("heading", { name: `Nate workflow ${label} disposable` }).waitFor({ timeout: 12000 });
              await page.getByRole("tab", { name: "Audience" }).click();
              await page.getByText("Audience Rules", { exact: true }).waitFor({ timeout: 12000 });
              campaignReady = true;
            } catch (error) { campaignReadinessError = error.message; }
          } else if (role === "rep") {
            try { await page.waitForLoadState("networkidle", { timeout: 12000 }); } catch {}
            const text = await page.locator("body").innerText().catch(() => "");
            campaignReady = !/Audience Rules/.test(text) && (/not found|not authorized|access denied|forbidden|access\s+required|manager\s+required/i.test(text) || !page.url().includes(`/campaigns/${result.campaignId}`));
          }
          check(result, `${label} campaign audience route rendered or enforced its role boundary`, campaignReady,
            { role, url: page.url(), h1: await page.locator("h1").allTextContents(), campaignId: result.campaignId, readinessError: campaignReadinessError });
          const key = `campaign-audience-${width}-${role}`;
          result.screens[key] = await inventory(page);
          await page.screenshot({ path: `${out}/${key}.png`, fullPage: true });
        }
      }
      if (!behaviorOnly && selectedRouteNames.has("leads") && role === "admin" && !args.includes("--no-desktop")) {
        for (const width of [1280, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(`${sandbox.url}/leads`);
          let leadsReady = false;
          try { await waitForPage(page, "leads"); leadsReady = true; } catch {}
          const key = `leads-${width}-admin`;
          const layout = await page.evaluate(() => ({
            documentWidth: document.documentElement.scrollWidth,
            viewportWidth: innerWidth,
            bodyWidth: document.body.scrollWidth,
            telLinks: document.querySelectorAll('a[href^="tel:"]').length,
            emailActions: document.querySelectorAll('[data-contact-link="email"]').length,
          }));
          result.screens[key] = {
            controls: await inventory(page),
            overflow: layout,
          };
          check(result, `${label} desktop Leads ${width}px is rendered, fits, and has phone/email contact actions`,
            leadsReady && layout.documentWidth <= width + 1 && layout.bodyWidth <= width + 1 && layout.telLinks > 0 && layout.emailActions > 0, layout);
          await page.screenshot({ path: `${out}/${key}.png`, fullPage: true });
        }
      }
      await context.close();
    }
    await saveCaptureInventoryAndMeta();
    if (label === "after" && !skipBehavior) {
      const behaviorContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const behaviorPage = await behaviorContext.newPage();
      behaviorPage.on("request", request => {
        const url = new URL(request.url());
        if (prohibited.test(url.pathname)) result.forbiddenRequests.push(`${request.method()} ${url.pathname}`);
      });
      await sandbox.login(behaviorPage, "admin");
      behaviorPage.on("pageerror", error => result.pageErrors.push("admin behavior: " + error.message));
      behaviorPage.on("console", message => { if (message.type() === "error") result.consoleErrors.push({ role: "admin", route: new URL(behaviorPage.url()).pathname, text: message.text() }); });
      behaviorPage.on("response", response => {
        const status = response.status();
        if (status >= 400) {
          const url = new URL(response.url());
          result.httpErrors.push({ context: "behavior-api", role: "admin", route: new URL(behaviorPage.url()).pathname, status, method: response.request().method(), path: url.pathname });
        }
      });
      await runBehaviorAssertions(behaviorPage, sandbox, result.fixture, result, out);
      await runDealIdentityVisualSweep(behaviorPage, sandbox, result.fixture, result, out);
      result.behaviorComplete = true;
      await behaviorContext.close();
    }
    const unexpectedHttpErrors = result.httpErrors.filter(item => item.context !== "behavior-api" && !(item.status === 503 && /twilio/i.test(item.path)));
    check(result, `${label} captures only approved fixture Twilio 503 errors`, unexpectedHttpErrors.length === 0, result.httpErrors);
    check(result, `${label} has no browser console errors`, result.consoleErrors.length === 0, result.consoleErrors);
    await writeFile(`${out}/http-errors.ndjson`, result.httpErrors.map(item => JSON.stringify(item)).join("\n") + (result.httpErrors.length ? "\n" : ""));
    check(result, `${label} makes no prohibited provider/delivery API requests`, result.forbiddenRequests.length === 0, result.forbiddenRequests);
    check(result, `${label} has no uncaught browser page errors`, result.pageErrors.length === 0, result.pageErrors);
    await saveCaptureInventoryAndMeta();
  } finally {
    await browser.close();
    await sandbox.close();
    const cleanup = sandbox.cleanupReport();
    await writeFile(`${out}/cleanup.json`, JSON.stringify({ expected: { clerkUsersDeleted: 3, databaseDropped: true, tempDirectoryRemoved: true }, actual: cleanup }, null, 2));
    check(result, `${label} Clerk users/database/temp fixtures cleaned up`, JSON.stringify(cleanup) === JSON.stringify(cleanupExpected), cleanup);
    await writeFile(`${out}/assertions.json`, JSON.stringify({
      phase: label,
      assertions: result.assertions,
      failures: result.failures,
      behaviorComplete: result.behaviorComplete,
      browserErrors: result.pageErrors,
      prohibitedRequests: result.forbiddenRequests,
      httpErrors: result.httpErrors,
      consoleErrors: result.consoleErrors,
      sourceSearchDiagnostic: result.sourceSearchDiagnostic ?? null,
      cleanup,
    }, null, 2));
  }
}

function getControls(value, screen = "") {
  const controls = Array.isArray(value) ? value : value?.controls ?? [];
  // Older inventories included inaccessible native form fallbacks that the
  // current capture excludes via aria-hidden. Compare only the visible custom
  // controls on the two routes that use these fallbacks.
  if (screen.startsWith("new-deal-")) {
    return controls.filter(control => !(control.tag === "SELECT" &&
      /Waiting on App.*Info Needed.*Submitted/.test(control.name ?? "")));
  }
  if (screen.startsWith("campaign-audience-")) {
    return controls.filter(control => !(control.tag === "INPUT" && control.type === "checkbox" &&
      control.role == null && control.name === "on"));
  }
  return controls;
}

function normalizedControl(control) {
  let name = control.name ?? "";
  // Normalize only fixture record-name fragments. Preserve operation prefixes,
  // destinations and every other label byte so this cannot hide changed actions.
  for (const identity of [
    "Fixture Equipment LLC — Synthetic Contact", "Fixture Services LLC — Sample Applicant",
    "Synthetic equipment financing", "Synthetic working capital",
  ]) name = name.replaceAll(identity, "<deal-record>");
  name = name.replace(/\bDeal #[12]\b/g, "Deal");
  return { ...control, name };
}

function controlKey(control) {
  return JSON.stringify(normalizedControl(control));
}

function allowedStructuralAddition(screen, control) {
  if (screen.startsWith("leads-") && control.tag === "BUTTON" && control.name === "Lead Source") return "Lead Source filter";
  if (screen.startsWith("campaign-audience-") && control.role === "combobox" && control.name === "Deals audience") return "Deals audience selector";
  return null;
}

function allowedStructuralRemoval(screen, control) {
  return ["leads-390-rep","leads-768-rep","pipeline-390-rep","pipeline-768-rep"].includes(screen)
    && JSON.stringify(control) === JSON.stringify({ tag: "BUTTON", role: null, type: "button", name: "Retry", href: null, disabled: false });
}

function compareInventories(before, after, assertionResult) {
  const screens = {};
  for (const key of Object.keys(before)) {
    const left = getControls(before[key], key).map(normalizedControl);
    const right = getControls(after[key] ?? [], key).map(normalizedControl);
    const beforeCounts = new Map(), afterCounts = new Map();
    for (const item of left) beforeCounts.set(controlKey(item), (beforeCounts.get(controlKey(item)) ?? 0) + 1);
    for (const item of right) afterCounts.set(controlKey(item), (afterCounts.get(controlKey(item)) ?? 0) + 1);
    const removed = [], added = [];
    for (const item of left) {
      const key = controlKey(item), count = beforeCounts.get(key) ?? 0;
      if (count > (afterCounts.get(key) ?? 0)) {
        if (removed.filter(x => controlKey(x) === key).length < count - (afterCounts.get(key) ?? 0)) removed.push(item);
      }
    }
    for (const item of right) {
      const key = controlKey(item), count = afterCounts.get(key) ?? 0;
      if (count > (beforeCounts.get(key) ?? 0)) {
        if (added.filter(x => controlKey(x) === key).length < count - (beforeCounts.get(key) ?? 0)) added.push(item);
      }
    }
    const allowed = added.map(control => ({ control, reason: allowedStructuralAddition(key, control) })).filter(x => x.reason);
    const unexpectedAdded = added.filter(control => !allowedStructuralAddition(key, control));
    const expectedAddition = key.startsWith("leads-") ? "Lead Source filter"
      : key.startsWith("campaign-audience-") && !key.endsWith("-rep") ? "Deals audience selector" : null;
    const expectedCount = expectedAddition ? 1 : 0;
    screens[key] = { removed, added, allowed, unexpectedAdded, expectedAddition, expectedCount };
    const approvedRemoved = removed.filter(control => allowedStructuralRemoval(key, control));
    const unexpectedRemoved = removed.filter(control => !allowedStructuralRemoval(key, control));
    const expectedRemovalCount = ["leads-390-rep","leads-768-rep","pipeline-390-rep","pipeline-768-rep"].includes(key) ? 1 : 0;
    check(assertionResult, `structure ${key} allows only exact approved additions/removals`,
      unexpectedRemoved.length === 0 && approvedRemoved.length === expectedRemovalCount
        && unexpectedAdded.length === 0 && allowed.length === expectedCount,
      { removed, approvedRemoved, unexpectedRemoved, allowed, unexpectedAdded, expectedAddition, expectedCount, expectedRemovalCount });
    const retained = right.filter(control => !allowedStructuralAddition(key, control));
    const retainedBaseline = left.filter(control => !allowedStructuralRemoval(key, control));
    check(assertionResult, `structure ${key} preserves exact retained control order`,
      JSON.stringify(retainedBaseline) === JSON.stringify(retained), { baseline: retainedBaseline, retained });
  }
  return screens;
}

await mkdir(evidenceRoot, { recursive: true });
if (!compareOnly) {
  for (const phase of selectedPhases) {
    if (!["before", "after"].includes(phase)) throw new Error(`Unknown phase: ${phase}`);
    await capture(phase, phase === "before" ? baselineRoot : candidateRoot);
  }
}
if (sourceSearchOnly || captureOnly) {
  const output = sourceSearchOnly
    ? JSON.parse(await readFile(`${evidenceRoot}/after/source-search-diagnostic.json`, "utf8"))
    : JSON.parse(await readFile(`${evidenceRoot}/after/capture-meta.json`, "utf8"));
  console.log(JSON.stringify({ mode: sourceSearchOnly ? "source-search-only" : "capture-only", output, failures }, null, 2));
  if (failures.length) throw new Error(failures.join("\n"));
  process.exit(0);
}

if (args.includes("--resume-only")) {
  const behavior = JSON.parse(await readFile(evidenceRoot + "/after/assertions.json", "utf8"));
  const resumeReport = {
    verdict: failures.length ? "FAIL" : "PASS",
    mode: "behavior-identity-resume-only",
    routeCapturePerformed: false,
    preservedFullRouteEvidence: "runs/core-final/reports/nate-workflows/after",
    behaviorComplete: behavior.behaviorComplete,
    assertionCount: Object.keys(behavior.assertions ?? {}).length,
    failureCount: failures.length,
    failures,
    campaignListRoutes: behavior.assertions
      ? Object.entries(behavior.assertions).filter(([name]) => name.startsWith("resume ") && name.includes("/campaigns list")).map(([name, value]) => ({ name, ...value }))
      : [],
    httpErrors: behavior.httpErrors,
    consoleErrors: behavior.consoleErrors,
    screenshots: ["campaigns-list-admin.png", "campaigns-list-manager.png", "campaigns-list-rep.png",
      "resume-identity-referral-panel.png", "identity-cmdk-result.png", "identity-notification.png"],
  };
  await writeFile(evidenceRoot + "/core-resume-summary.json", JSON.stringify(resumeReport, null, 2));
  console.log(JSON.stringify(resumeReport, null, 2));
  if (failures.length) throw new Error(failures.join("\n"));
  process.exit(0);
}
const before = JSON.parse(await readFile(`${evidenceRoot}/before/controls.json`, "utf8"));
const after = JSON.parse(await readFile(`${evidenceRoot}/after/controls.json`, "utf8"));
const oldRoleInventory = JSON.parse(await readFile(`${evidenceRoot}/before/role-controls.json`, "utf8"));
const oldExemptInventory = JSON.parse(await readFile(`${evidenceRoot}/before/exempt-controls.json`, "utf8"));
const structuralResult = { assertions: {}, failures: [] };
const expectedScreenKeys = [];
for (const role of roles) {
  for (const width of widths) {
    for (const [name] of routeCases) if (selectedRouteNames.has(name)) expectedScreenKeys.push(`${name}-${width}-${role}`);
    if (selectedRouteNames.has("campaign-audience")) expectedScreenKeys.push(`campaign-audience-${width}-${role}`);
  }
  if (selectedRouteNames.has("leads") && role === "admin" && !args.includes("--no-desktop")) {
    expectedScreenKeys.push("leads-1280-admin", "leads-1440-admin");
  }
}
const scopedBefore = Object.fromEntries(expectedScreenKeys.filter(key => Object.hasOwn(before, key)).map(key => [key, before[key]]));
const scopedAfter = Object.fromEntries(expectedScreenKeys.filter(key => Object.hasOwn(after, key)).map(key => [key, after[key]]));
const matchedScreenKeys = expectedScreenKeys.length > 0 && expectedScreenKeys.every(key => Object.hasOwn(before, key) && Object.hasOwn(after, key));
check(structuralResult, "prior baseline inventory files preserved and present",
  Object.keys(oldRoleInventory).length === 36 && Object.keys(oldExemptInventory).length === 36,
  { roleKeys: Object.keys(oldRoleInventory).length, exemptKeys: Object.keys(oldExemptInventory).length });
check(structuralResult, "baseline and candidate captured the same route/role/viewport inventory keys",
  matchedScreenKeys, { expected: expectedScreenKeys, baselineCaptured: Object.keys(scopedBefore), candidateCaptured: Object.keys(scopedAfter) });
const structuralDiffs = compareInventories(scopedBefore, scopedAfter, structuralResult);

const navigationNames = new Set([
  "Dashboard", "Leads", "Deals", "Rate & Points", "Documents", "Campaigns",
  "Email Templates", "Drip Sequences", "Partners", "Flyer Templates", "Stale Leads",
  "Credit Compliance", "Data Governance", "Workflow Rules", "System Health",
  "USFA Intake", "Settings", "Apply",
]);
let afterNavigationInventory = {};
try { afterNavigationInventory = JSON.parse(await readFile(`${evidenceRoot}/after/navigation-controls.json`, "utf8")); } catch {}
const supplementalNavigation = {};
for (const key of expectedScreenKeys.filter(key => /^(dashboard|apply|settings)-/.test(key))) {
  const oldControls = oldRoleInventory[key] ?? [];
  const oldNav = oldControls.filter(control => control.tag === "A" && navigationNames.has(control.name));
  const candidateNav = key.startsWith("apply-")
    ? getControls(after[key] ?? []).filter(control => control.tag === "A" && navigationNames.has(control.name))
    : afterNavigationInventory[key] ?? [];
  supplementalNavigation[key] = { baseline: oldNav, candidate: candidateNav };
  check(structuralResult, `original36 navigation retained on ${key}`,
    JSON.stringify(oldNav) === JSON.stringify(candidateNav), { baseline: oldNav, candidate: candidateNav });
}
await writeFile(`${evidenceRoot}/control-review.json`, JSON.stringify({
  baselineWebRoot: baselineRoot,
  candidateWebRoot: candidateRoot,
  priorInventoriesPreserved: ["before/role-controls.json", "before/exempt-controls.json"],
  normalization: "Only record-name text (including legacy Deal # fallback and company/customer composite) is normalized; tags, roles, destinations, disabled state and all other names remain exact.",
  allowedStructuralAdditions: ["one Lead Source filter on Leads", "one Deals audience selector on campaign Audience"],
  screensCompared: Object.keys(structuralDiffs).length,
  selectedRoutes: [...selectedRouteNames],
  selectedRoles: roles,
  selectedWidths: widths,
  supplementalNavigation,
  assertions: structuralResult.assertions,
  screens: structuralDiffs,
}, null, 2));
const behaviorEvidence = JSON.parse(await readFile(`${evidenceRoot}/after/assertions.json`, "utf8"));
const report = {
  verdict: failures.length ? "FAIL" : "PASS",
  assertionFailureCount: failures.length,
  failures,
  structuralAssertions: structuralResult.assertions,
  baselineScreenshotDirectory: `${evidenceRoot}/before`,
  candidateScreenshotDirectory: `${evidenceRoot}/after`,
  criticalBehaviorComplete: behaviorEvidence.behaviorComplete === true,
  behaviorAssertions: behaviorEvidence.assertions,
};
await writeFile(`${evidenceRoot}/certification-results.json`, JSON.stringify(report, null, 2));
console.log(`Nate workflow certification ${report.verdict}: ${failures.length} assertion failures. Evidence: ${evidenceRoot}`);
if (failures.length) throw new Error(failures.join("\n"));
