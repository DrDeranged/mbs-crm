import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const reportDir = resolve(process.env.VISUAL_JOURNEY_REPORT_DIR ?? "reports/web-visual-refresh/journeys");
let sandbox: any;
const unique = `${Date.now()}`;

const shot = async (page: Page, name: string) => {
  await page.screenshot({ path: `${reportDir}/${name}.png`, fullPage: true, animations: "disabled" });
};
const open = async (page: Page, route: string) => {
  await page.goto(`${sandbox.url}${route}`);
  await page.locator("h1,h2").first().waitFor({ timeout: 20_000 });
};
const db = (sql: string) => sandbox.query(sql);
const json = (sql: string) => {
  const value = db(sql);
  if (!value) throw new Error("The expected synthetic record was not persisted.");
  return JSON.parse(value);
};
const choose = async (page: Page, trigger: ReturnType<Page["getByRole"]>, option: string) => {
  await trigger.click();
  await page.getByRole("option", { name: option, exact: true }).click();
};
const fixtureFiles = async (root: string): Promise<string[]> => {
  const { readdir } = await import("node:fs/promises");
  let files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const fullPath = `${root}/${entry.name}`;
    files = files.concat(entry.isDirectory() ? await fixtureFiles(fullPath) : [fullPath]);
  }
  return files;
};

test.beforeAll(async () => {
  await mkdir(reportDir, { recursive: true });
  const nativeImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<any>;
  const { startSandbox } = await nativeImport("../scripts/visual-refresh/sandbox.mjs");
  sandbox = await startSandbox({ build: false, port: 4340 });
});
test.afterAll(async () => { await sandbox?.close(); });
test.beforeEach(async ({ page }) => { await sandbox.login(page, "admin"); });

test("journey: admin sign-in, per-account theme/system/reduced motion and sign-out isolation", async ({ page }) => {
  await open(page, "/dashboard");
  await expect(page.locator("h1")).toContainText("Dashboard");
  await shot(page, "journey-dashboard-authenticated");
  await open(page, "/settings");
  const theme = page.getByLabel("Appearance theme");
  await expect(theme).toHaveValue("light");
  await theme.selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "dark");
  await theme.selectOption("system");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "dark");
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "light");
  await open(page, "/dashboard");
  const reducedMotion = await page.evaluate(() => ({
    active: matchMedia("(prefers-reduced-motion: reduce)").matches,
    duration: getComputedStyle(document.querySelector(".skeleton-shimmer") ?? document.body).animationDuration,
  }));
  expect(reducedMotion.active).toBe(true);
  expect(reducedMotion.duration).toBe("0s");
  await shot(page, "journey-settings-system-reduced-motion");
  await open(page, "/settings");
  await theme.selectOption("dark");
  await page.getByRole("button", { name: "Sign Out", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Sign Out" })).toHaveCount(0);
  await sandbox.login(page, "rep");
  await open(page, "/settings");
  await expect(page.getByLabel("Appearance theme")).toHaveValue("light");
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "light");
  await page.getByLabel("Appearance theme").selectOption("light");
  await page.getByRole("button", { name: "Sign Out", exact: true }).first().click();
  await page.goto(`${sandbox.url}/apply`);
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "light");
  await sandbox.login(page, "admin");
  await open(page, "/settings");
  await expect(page.getByLabel("Appearance theme")).toHaveValue("dark");
});

test("journey: existing call-forwarding profile saves through UI and persists", async ({ page }) => {
  await open(page, "/settings");
  await page.getByRole("button", { name: "Add number" }).click();
  const phone = page.getByPlaceholder("+1 (555) 000-0000");
  await phone.fill("+12025550987");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("+12025550987")).toBeVisible();
  const row = json("SELECT to_jsonb(u)::text FROM users u WHERE email='fixture-admin@example.invalid'");
  expect(row.mobile_number).toBe("+12025550987");
});

test("journey: create lead in UI and Run Match with DB-backed results", async ({ page }) => {
  await open(page, "/leads/new");
  await page.getByLabel(/First name/).fill("Journey");
  await page.getByLabel(/Last name/).fill("Fixture");
  await page.getByLabel("Email address").fill(`journey-${unique}@example.invalid`);
  await page.getByLabel("Phone number").fill("+12025550801");
  await page.getByLabel("Company name").fill("Journey Test LLC");
  await page.getByRole("button", { name: "Create Lead", exact: true }).click();
  await expect(page).toHaveURL(/\/leads\/\d+/);
  const lead = json(`SELECT to_jsonb(l)::text FROM leads l WHERE email='journey-${unique}@example.invalid'`);
  expect(lead.company_name).toBe("Journey Test LLC");
  await page.getByRole("tab", { name: /Lenders/ }).click();
  await page.getByRole("button", { name: "Run Match" }).click();
  await expect(page.getByText("Visual Fixture Match Partner")).toBeVisible({ timeout: 20_000 });
  const matches = json(`SELECT COALESCE(json_agg(to_jsonb(m)), '[]'::json)::text FROM lender_matches m WHERE lead_id=${lead.id}`);
  expect(matches.length).toBeGreaterThan(0);
  await shot(page, "journey-lead-match-results");
});

test("journey: public application submit persists application, lead and typed signature", async ({ page }) => {
  await open(page, "/apply");
  await page.getByRole("button", { name: /Equipment Financing/ }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByPlaceholder("ABC LLC").fill(`Public Journey ${unique} LLC`);
  await page.getByPlaceholder("you@business.com").fill(`apply-${unique}@example.invalid`);
  await page.getByPlaceholder("(555) 000-0000").fill("+12025550802");
  await page.getByPlaceholder("e.g. 2024 Ford F-250 Work Truck").fill("Synthetic test forklift");
  await choose(page, page.getByText("Industry *", { exact: true }).locator("..").getByRole("combobox"), "Retail");
  await choose(page, page.getByText("Time in Business *", { exact: true }).locator("..").getByRole("combobox"), "4+ years");
  await page.getByPlaceholder("1000000").fill("100000");
  await choose(page, page.getByText("Requested Amount *", { exact: true }).locator("..").getByRole("combobox"), "$15,000 – $50,000");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByText("First Name *").locator("xpath=..").locator("input").fill("Synthetic");
  await page.getByText("Last Name *").locator("xpath=..").locator("input").fill("Applicant");
  await page.getByText("Social Security Number *", { exact: true }).locator("xpath=..").getByPlaceholder("XXX-XX-XXXX").fill("900-12-3456");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Skip this step" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.locator("#consent_credit").click();
  await page.locator("#consent_terms").click();
  await page.getByRole("button", { name: "Type", exact: true }).click();
  await page.getByPlaceholder("Type your full legal name").fill("Synthetic Applicant");
  await page.getByRole("button", { name: "Submit Application" }).click();
  await expect(page.getByRole("heading", { name: "Application Submitted!" })).toBeVisible({ timeout: 20_000 });
  const application = json(`SELECT to_jsonb(a)::text FROM applications a WHERE business_name='Public Journey ${unique} LLC'`);
  expect(application.signature_data).toBe("Synthetic Applicant");
  const lead = json(`SELECT to_jsonb(l)::text FROM leads l WHERE email='apply-${unique}@example.invalid'`);
  expect(application.lead_id).toBe(lead.id);
  await shot(page, "journey-public-application-confirmation");
});

test("journey: Log partner submission persists an actual manual submission", async ({ page }) => {
  const partner = json("SELECT to_jsonb(l)::text FROM lenders l WHERE name='Visual Fixture Match Partner'");
  await open(page, "/leads/1");
  await page.getByRole("tab", { name: /Docs/ }).click();
  await page.getByRole("button", { name: "Log submission" }).click();
  await page.getByRole("button", { name: "Partner", exact: true }).click();
  await page.getByRole("option", { name: /^Visual Fixture Match Partner/ }).click();
  await page.getByRole("dialog").locator('input:not([type="date"]):not([type="file"]):not([role="combobox"])').fill(`Manual journey ${unique}`);
  const saved = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/submissions/manual") && response.request().method() === "POST" && response.ok());
  await page.getByRole("button", { name: "Save submission" }).click();
  await saved;
  await expect(page.getByText("Visual Fixture Match Partner").first()).toBeVisible();
  const row = json(`SELECT to_jsonb(s)::text FROM lender_submissions s WHERE lead_id=1 AND lender_id=${partner.id} AND source='manual' AND notes='Manual journey ${unique}'`);
  expect(row.status).toBe("submitted");
  await shot(page, "journey-manual-partner-submission");
});

test("journey: normal lead-document multipart upload persists DB metadata and local provider bytes", async ({ page }) => {
  await open(page, "/leads/1");
  await page.getByRole("tab", { name: /Docs/ }).click();
  const payload = Buffer.from("%PDF-1.4\nSynthetic local document fixture\n%%EOF\n");
  const filename = `journey-${unique}.pdf`;
  await page.locator('input[type="file"]').first().setInputFiles({ name: filename, mimeType: "application/pdf", buffer: payload });
  const uploadResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/leads/1/documents" && response.request().method() === "POST",
  );
  await page.getByRole("tabpanel").getByRole("button", { name: "Upload", exact: true }).click();
  expect((await uploadResponse).status()).toBe(201);
  await expect(page.getByText(filename)).toBeVisible();
  const document = json(`SELECT to_jsonb(d)::text FROM documents d WHERE lead_id=1 AND filename='${filename}'`);
  expect(document.file_size).toBe(payload.length);
  const files = await fixtureFiles(sandbox.storageDirectory);
  const { readFile } = await import("node:fs/promises");
  const storedBytes = await Promise.all(files.filter(file => !file.endsWith(".metadata.json")).map(file => readFile(file)));
  expect(storedBytes.some(file => file.equals(payload))).toBe(true);
  await shot(page, "journey-lead-document-uploaded");
});

test("journey: create campaign, preview and approve via UI/API/DB without launching", async ({ page }) => {
  await open(page, "/campaigns");
  await page.getByTestId("button-create-campaign").click();
  await page.getByLabel("Campaign Name").fill(`Synthetic Campaign ${unique}`);
  await page.getByRole("button", { name: "Create Campaign" }).click();
  await page.getByRole("heading", { name: `Synthetic Campaign ${unique}` }).waitFor();
  await page.getByRole("button", { name: "Select a template", exact: true }).click();
  await page.getByRole("option", { name: "Visual Refresh Synthetic Template", exact: true }).click();
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByRole("button", { name: "Save Changes" })).toBeDisabled();
  await page.getByRole("tab", { name: "Review" }).click();
  const previewResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname.endsWith("/preview") && response.status() === 200,
  );
  await page.getByRole("button", { name: "Calculate", exact: true }).first().click();
  await previewResponse;
  await expect(page.getByText(/eligible/i).first()).toBeVisible();
  const preview = json(`SELECT to_jsonb(p)::text FROM campaign_audience_previews p JOIN campaigns c ON c.id=p.campaign_id WHERE c.name='Synthetic Campaign ${unique}' ORDER BY p.id DESC LIMIT 1`);
  expect(preview.counts.eligible).toBeGreaterThan(0);
  await page.getByRole("checkbox", { name: /I affirm this campaign meets all compliance requirements/ }).check();
  await page.getByRole("button", { name: "Approve and continue to launch" }).click();
  await expect(page.getByText("APPROVED")).toBeVisible();
  const campaign = json(`SELECT to_jsonb(c)::text FROM campaigns c WHERE name='Synthetic Campaign ${unique}'`);
  expect(campaign.status).toBe("approved");
  const approval = json(`SELECT to_jsonb(a)::text FROM campaign_approvals a WHERE campaign_id=${campaign.id} ORDER BY id DESC LIMIT 1`);
  expect(approval.claims_affirmed).toBe(true);
  const launches = Number(db(`SELECT count(*) FROM campaign_launches WHERE campaign_id=${campaign.id}`));
  expect(launches).toBe(0);
  await shot(page, "journey-campaign-approved-not-launched");
});

test("journey: softphone opens idle without a dial or call request", async ({ page }) => {
  const callRequests: string[] = [];
  page.on("request", request => { if (/\/api\/.*(?:twilio\/call|voice\/call)/i.test(request.url())) callRequests.push(request.method()); });
  await open(page, "/leads");
  await page.locator('button[title="Open softphone"]').click();
  await expect(page.locator('[role="dialog"],[role="complementary"]').filter({ hasText: /softphone|call/i }).first()).toBeVisible();
  expect(callRequests).toEqual([]);
  await shot(page, "journey-softphone-open-idle");
});

test("journey: mobile dialog close target and rich editor keyboard focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "/email/templates");
  await page.getByRole("button", { name: "New Template" }).click();
  const editor = page.locator('[contenteditable="true"]').first();
  await expect(editor).toBeVisible();
  await editor.focus();
  await expect(editor).toBeFocused();
  await page.keyboard.type("Synthetic keyboard editor check");
  await expect(editor).toContainText("Synthetic keyboard editor check");
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
  const close = page.getByRole("button", { name: /close/i }).last();
  const box = await close.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();
});

test("visual-only floating surfaces: themed dialog/popover/toast and glass policy", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "/settings");
  const theme = page.getByLabel("Appearance theme");
  await theme.selectOption("light");
  await open(page, "/campaigns");
  await page.getByTestId("button-create-campaign").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await shot(page, "visual-floating-dialog-light");
  const dialogFilter = await page.getByRole("dialog").evaluate(el => getComputedStyle(el).backdropFilter);
  const cardFilter = await page.locator("main .bg-card").first().evaluate(el => getComputedStyle(el).backdropFilter).catch(() => "none");
  expect(dialogFilter).not.toBe("none");
  expect(cardFilter).toBe("none");
  await page.keyboard.press("Escape");
  await open(page, "/settings");
  const forwarding = page.getByText("Call Forwarding", { exact: true })
    .locator("xpath=ancestor::div[contains(@class, 'bg-card')][1]");
  await forwarding.getByRole("button", { name: /^(Add number|Edit)$/ }).click();
  await page.getByPlaceholder("+1 (555) 000-0000").fill("+12025550989");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Call forwarding number updated.", { exact: true })).toBeVisible();
  await shot(page, "visual-floating-toast-light");
  await theme.selectOption("dark");
  await shot(page, "visual-floating-toast-dark");
  await open(page, "/leads/1");
  await page.getByRole("tab", { name: /Docs/ }).click();
  await page.getByRole("button", { name: "Log submission" }).click();
  await page.getByRole("button", { name: "Partner", exact: true }).click();
  await shot(page, "visual-floating-popover-dark");
  await page.keyboard.press("Escape");
  await open(page, "/campaigns");
  await page.getByTestId("button-create-campaign").click();
  await shot(page, "visual-floating-dialog-dark");
});

const mockedVisualPages = [
  { name: "dashboard", route: "/dashboard", api: "/api/analytics/summary", skeleton: "loading-dashboard", error: "status-dashboard-summary-error" },
  { name: "leads", route: "/leads", api: "/api/leads", skeleton: "Loading leads", error: "status-leads-error" },
  { name: "lead-detail", route: "/leads/1", api: "/api/leads/1", skeleton: "loading-lead-detail", error: "detail-lead" },
  { name: "pipeline", route: "/deals", api: "/api/deals", skeleton: "loading-pipeline", error: "status-deals-error" },
  { name: "documents", route: "/documents", api: "/api/collateral/templates", skeleton: "loading-documents", error: "inline-documents" },
  { name: "campaigns", route: "/campaigns", api: "/api/campaigns", skeleton: "loading-campaigns", error: "none" },
];
for (const visual of mockedVisualPages) {
  test(`visual-only mocked loading/error/retry states where supported: ${visual.name}`, async ({ page }) => {
    let release!: () => void;
    let reached!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const firstRequest = new Promise<void>(resolve => { reached = resolve; });
    let calls = 0;
    await page.route(url => new URL(url).pathname === visual.api, async route => {
      calls++;
      reached();
      await gate;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "synthetic isolated visual-state failure" }) });
    });
    await page.goto(`${sandbox.url}${visual.route}`, { waitUntil: "domcontentloaded" });
    await Promise.race([firstRequest, new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error(`Visual fixture did not observe ${visual.api}`)), 10_000))]);
    const skeleton = visual.name === "dashboard" || visual.name === "leads"
      ? page.locator("main .skeleton-shimmer").first()
      : page.getByTestId(visual.skeleton);
    await expect(skeleton).toBeVisible();
    await shot(page, `visual-loading-${visual.name}`);
    release();
    const error = visual.error === "detail-lead"
      ? page.getByRole("alert").filter({ hasText: "Couldn't load this lead" })
      : visual.error === "inline-documents"
        ? page.getByRole("alert").filter({ hasText: "Couldn’t load documents" })
      : visual.error === "none" ? null : page.getByTestId(visual.error);
    if (!error) {
      await shot(page, `visual-loading-${visual.name}`);
      return;
    }
    await expect(error).toBeVisible({ timeout: 15_000 });
    await shot(page, `visual-error-${visual.name}`);
    if (visual.name === "leads") {
      const search = page.getByPlaceholder(/search by name, email, company/i);
      await search.fill("preserve-filter");
      await page.getByTestId(`${visual.error}-retry`).click();
      await expect(search).toHaveValue("preserve-filter");
    } else if (visual.error === "detail-lead" || visual.error === "inline-documents") {
      await page.getByRole("button", { name: "Retry", exact: true }).click();
    } else {
      await page.getByRole("button", { name: "Retry", exact: true }).click();
    }
    await expect.poll(() => calls).toBeGreaterThan(1);
  });
}