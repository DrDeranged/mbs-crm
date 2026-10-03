# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: desktop-workspace.spec.ts >> desktop: authorized palette covers company/contact/email/phone, deals, lenders, brokers and pages
- Location: tests/desktop-workspace.spec.ts:79:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('option').filter({ hasText: 'Fixture Equipment LLC' }).first()
Expected: visible
Timeout: 8000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('option').filter({ hasText: 'Fixture Equipment LLC' }).first() with timeout 8000ms
  - waiting for getByRole('option').filter({ hasText: 'Fixture Equipment LLC' }).first()

```

```yaml
- dialog "Search pages and actions":
  - heading "Search pages and actions" [level=2]
  - paragraph: Navigate to a page or choose an available CRM action.
  - combobox [expanded]: Fixture Equipment
  - listbox "Suggestions":
    - group "Record search":
      - option "Some record results could not be loaded. Try again or open the relevant record list." [disabled]
  - button "Close"
```

# Test source

```ts
  1   | import { test, expect, type Page } from "@playwright/test";
  2   | import { readFile, readdir, mkdir } from "node:fs/promises";
  3   | 
  4   | let sandbox: any;
  5   | test.beforeAll(async () => {
  6   |   const nativeImport = new Function("path", "return import(path)");
  7   |   const { startSandbox } = await nativeImport("../scripts/visual-refresh/sandbox.mjs");
  8   |   sandbox = await startSandbox({ build: false, port: 4350 });
  9   |   await mkdir("reports/desktop-workspace-release/journeys", { recursive: true });
  10  | });
  11  | test.afterAll(async () => { await sandbox?.close(); });
  12  | test.beforeEach(async ({ page }) => { await sandbox.login(page, "admin"); });
  13  | 
  14  | async function open(page: Page, path: string) {
  15  |   await page.goto(sandbox.url + path);
  16  |   await page.locator("h1").first().waitFor();
  17  |   await page.waitForLoadState("networkidle");
  18  | }
  19  | async function api(page: Page, path: string, body?: unknown, method = "POST") {
  20  |   return page.evaluate(async ({ path, body, method }) => {
  21  |     const token = await (window as any).Clerk.session.getToken();
  22  |     const response = await fetch(`/api${path}`, {
  23  |       method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  24  |       ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  25  |     });
  26  |     return { status: response.status, body: await response.json() };
  27  |   }, { path, body, method });
  28  | }
  29  | 
  30  | test("desktop: rail hover delays, no reflow, pin persistence, keyboard and account isolation", async ({ page }) => {
  31  |   await open(page, "/dashboard");
  32  |   const sidebar = page.getByTestId("desktop-sidebar");
  33  |   await expect(sidebar).toHaveAttribute("data-pinned", "false");
  34  |   expect((await sidebar.boundingBox())?.width).toBe(56);
  35  |   await expect(sidebar.locator('[aria-current="page"]')).toHaveAttribute("aria-label", "Dashboard");
  36  |   const mainX = (await page.locator("main").boundingBox())!.x;
  37  |   await page.mouse.move(28, 200);
  38  |   await page.waitForTimeout(80);
  39  |   await expect(sidebar).toHaveAttribute("data-open", "false");
  40  |   await expect(sidebar).toHaveAttribute("data-open", "true");
  41  |   expect((await page.locator("main").boundingBox())!.x).toBe(mainX);
  42  |   await expect(page.getByRole("button", { name: "Open command palette", exact: true })).toHaveCount(1);
  43  |   await page.mouse.move(400, 200);
  44  |   await page.waitForTimeout(180);
  45  |   await expect(sidebar).toHaveAttribute("data-open", "true");
  46  |   await expect(sidebar).toHaveAttribute("data-open", "false");
  47  |   await page.mouse.move(28, 200);
  48  |   await page.waitForTimeout(60);
  49  |   await page.mouse.move(400, 200);
  50  |   await page.waitForTimeout(190);
  51  |   await expect(sidebar).toHaveAttribute("data-open", "false");
  52  |   await page.keyboard.press("Control+b");
  53  |   await expect(sidebar).toHaveAttribute("data-pinned", "true");
  54  |   expect((await page.locator("main").boundingBox())!.x).toBe(256);
  55  |   await page.reload();
  56  |   await expect(sidebar).toHaveAttribute("data-pinned", "true");
  57  |   await page.keyboard.press("Meta+b");
  58  |   await expect(sidebar).toHaveAttribute("data-pinned", "false");
  59  |   await page.keyboard.press("Control+k");
  60  |   const input = page.getByPlaceholder("Search pages, leads, deals, lenders, partners, and actions…");
  61  |   await input.fill("Settings");
  62  |   await page.keyboard.press("Control+b");
  63  |   await expect(sidebar).toHaveAttribute("data-pinned", "false");
  64  |   await page.keyboard.press("Escape");
  65  |   await page.keyboard.press("Control+b");
  66  |   await sandbox.login(page, "rep");
  67  |   await open(page, "/dashboard");
  68  |   await expect(sidebar).toHaveAttribute("data-pinned", "false");
  69  |   await sandbox.login(page, "admin");
  70  |   await open(page, "/dashboard");
  71  |   await expect(sidebar).toHaveAttribute("data-pinned", "true");
  72  |   await page.setViewportSize({ width: 1023, height: 900 });
  73  |   await expect(sidebar).toHaveCount(0);
  74  |   await page.keyboard.press("Control+b");
  75  |   await page.setViewportSize({ width: 1024, height: 900 });
  76  |   await expect(sidebar).toHaveAttribute("data-pinned", "true");
  77  | });
  78  | 
  79  | test("desktop: authorized palette covers company/contact/email/phone, deals, lenders, brokers and pages", async ({ page }) => {
  80  |   await open(page, "/dashboard");
  81  |   page.on("response", async response => {
  82  |     if (!/\/api\/(?:leads|deals)(?:[/?]|$)/.test(response.url())) return;
  83  |     let body: string;
  84  |     try { body = await response.text(); } catch { body = "<unreadable response body>"; }
  85  |     console.log(`[palette-api] ${response.request().method()} ${response.url()} status=${response.status()} body=${body}`);
  86  |   });
  87  |   const privateLead = await api(page, "/leads", { firstName: "Restricted", lastName: "Owner", companyName: "Private Admin Company", email: "private-desktop@example.invalid", assignedRepId: 2 });
  88  |   expect(privateLead.status).toBe(201);
  89  |   const broker = await api(page, "/lenders", { name: "Desktop Broker Partner", partnerType: "broker_out", programTypes: ["equipment"], isActive: true });
  90  |   expect(broker.status).toBe(201);
  91  |   const search = async (term: string, expected: string) => {
  92  |     await page.keyboard.press("Control+k");
  93  |     await page.getByPlaceholder("Search pages, leads, deals, lenders, partners, and actions…").fill(term);
> 94  |     await expect(page.getByRole("option").filter({ hasText: expected }).first()).toBeVisible();
      |                                                                                  ^ Error: expect(locator).toBeVisible() failed
  95  |     await page.keyboard.press("Escape");
  96  |   };
  97  |   for (const term of ["Fixture Equipment", "Synthetic Contact", "contact@example.invalid", "12025550123"]) await search(term, "Fixture Equipment LLC");
  98  |   await search("Synthetic equipment financing", "Fixture Equipment LLC");
  99  |   await search("Visual Fixture Match", "Visual Fixture Match Partner");
  100 |   await search("Desktop Broker", "Desktop Broker Partner");
  101 |   await search("Settings", "Settings");
  102 |   await page.keyboard.press("Control+k");
  103 |   await page.getByPlaceholder("Search pages, leads, deals, lenders, partners, and actions…").fill("Desktop Broker");
  104 |   await page.getByRole("option").filter({ hasText: "Desktop Broker Partner" }).click();
  105 |   await expect(page).toHaveURL(new RegExp(`/lenders\\?partner=${broker.body.id}$`));
  106 |   await expect(page.locator(`#partner-${broker.body.id}`)).toBeInViewport();
  107 |   await sandbox.login(page, "rep");
  108 |   await open(page, "/dashboard");
  109 |   await page.keyboard.press("Control+k");
  110 |   const input = page.getByPlaceholder("Search pages, leads, deals, lenders, partners, and actions…");
  111 |   await input.fill("Private Admin");
  112 |   await page.waitForLoadState("networkidle");
  113 |   await expect(page.getByRole("option").filter({ hasText: "Private Admin Company" })).toHaveCount(0);
  114 |   const forbidden = await api(page, `/leads/${privateLead.body.id}`, undefined, "GET");
  115 |   expect([403, 404]).toContain(forbidden.status);
  116 |   await input.fill("Visual Fixture Match");
  117 |   await expect(page.getByRole("option").filter({ hasText: "Visual Fixture Match Partner" })).toBeVisible();
  118 |   await page.route("**/api/leads?**", route => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Isolated search failure"}' }));
  119 |   await input.fill("Failure Search");
  120 |   await expect(page.getByText("Some record results could not be loaded.", { exact: false })).toBeVisible();
  121 | });
  122 | 
  123 | test("desktop: equal readable columns and independent lead activity at exact breakpoints", async ({ page }) => {
  124 |   await open(page, "/deals");
  125 |   const approval = await api(page, "/deals/1/approvals", {
  126 |     lenderId: 1, contractType: "EFA", advance: 125000, payment: 2500, term: 60,
  127 |     downPayment: 0, tier: "A", expiresOn: "2026-12-30", approvalDocumentId: null,
  128 |   });
  129 |   expect(approval.status).toBe(201);
  130 |   await page.reload();
  131 |   for (const width of [1024, 1280, 1440]) {
  132 |     await page.setViewportSize({ width, height: 900 });
  133 |     const board = page.getByTestId("deals-board-desktop");
  134 |     await expect(board).toBeVisible();
  135 |     const widths = await board.locator(".deals-board-desktop > div").evaluateAll(elements => elements.map(el => el.getBoundingClientRect().width));
  136 |     expect(widths.length).toBe(9);
  137 |     expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1);
  138 |     const card = board.locator(".deal-wrap").filter({ hasText: "Fixture Equipment LLC" }).first();
  139 |     for (const field of ["Synthetic Contact", "+12025550123", "$125,000", "Visual Fixture Match Partner", "Age:", "Approval expiry:", "Dec 30, 2026"]) await expect(card).toContainText(field);
  140 |     const clipped = await card.locator("*").evaluateAll(elements => elements.filter(el => {
  141 |       const style = getComputedStyle(el);
  142 |       return style.textOverflow === "ellipsis" || (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2 && style.overflowX === "hidden");
  143 |     }).map(el => el.textContent));
  144 |     expect(clipped).toEqual([]);
  145 |   }
  146 |   await page.setViewportSize({ width: 1279, height: 900 });
  147 |   await open(page, "/leads/1");
  148 |   await expect(page.locator(".lead-detail-columns")).toHaveCount(0);
  149 |   await expect(page.getByRole("tab", { name: "Activity", exact: true })).toBeVisible();
  150 |   await page.setViewportSize({ width: 1280, height: 900 });
  151 |   await expect(page.locator(".lead-detail-columns")).toBeVisible();
  152 |   await expect(page.getByRole("tab", { name: "Activity", exact: true })).toHaveCount(0);
  153 |   const panes = page.locator(".lead-detail-columns > *");
  154 |   await expect(panes).toHaveCount(2);
  155 |   const rightBefore = await panes.nth(1).evaluate(el => el.scrollTop);
  156 |   await panes.nth(0).evaluate(el => { el.scrollTop = el.scrollHeight; });
  157 |   expect(await panes.nth(0).evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  158 |   expect(await panes.nth(1).evaluate(el => el.scrollTop)).toBe(rightBefore);
  159 |   for (const tab of ["Docs", "Lenders"]) await expect(page.getByRole("tab", { name: tab, exact: true })).toBeVisible();
  160 | });
  161 | 
  162 | test("desktop: funded deal action-bar upload persists metadata and exact bytes", async ({ page }) => {
  163 |   await open(page, "/deals/1");
  164 |   const funded = await api(page, "/deals/1", { stage: "funded", actualGm: 7500 }, "PUT");
  165 |   expect(funded.status).toBe(200);
  166 |   await page.reload();
  167 |   const payload = Buffer.from(`Synthetic funded-deal evidence ${Date.now()}\n`);
  168 |   const filename = `funded-desktop-${Date.now()}.txt`;
  169 |   const chooser = page.waitForEvent("filechooser");
  170 |   await page.getByRole("navigation", { name: "Record actions" }).getByRole("button", { name: "Upload", exact: true }).click();
  171 |   const uploaded = page.waitForResponse(response => /\/api\/leads\/1\/documents$/.test(response.url()) && response.request().method() === "POST" && response.status() === 201);
  172 |   await (await chooser).setFiles({ name: filename, mimeType: "text/plain", buffer: payload });
  173 |   await uploaded;
  174 |   const row = JSON.parse(sandbox.query(`SELECT to_jsonb(d)::text FROM documents d WHERE lead_id=1 AND filename='${filename}'`));
  175 |   expect(row.file_size).toBe(payload.length);
  176 |   async function files(directory: string): Promise<string[]> {
  177 |     const entries = await readdir(directory, { withFileTypes: true });
  178 |     return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]))).flat();
  179 |   }
  180 |   const stored = await Promise.all((await files(sandbox.storageDirectory)).filter(path => !path.endsWith(".metadata.json")).map(path => readFile(path)));
  181 |   expect(stored.some(bytes => bytes.equals(payload))).toBe(true);
  182 |   await page.screenshot({ path: "reports/desktop-workspace-release/journeys/funded-deal-upload.png" });
  183 | });
  184 | 
  185 | test("desktop: phone handoff on mobile and desktop without a registered softphone", async ({ page }) => {
  186 |   const callRequests: string[] = [];
  187 |   page.on("request", request => {
  188 |     if (/\/api\/.*(?:voice\/call|twilio\/call)/.test(request.url())) callRequests.push(request.url());
  189 |   });
  190 |   for (const width of [1440, 390]) {
  191 |     await page.setViewportSize({ width, height: 900 });
  192 |     await open(page, "/leads/1");
  193 |     const phone = page.locator('a[href="tel:+12025550123"]').first();
  194 |     await expect(phone).toBeVisible();
```