# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: desktop-workspace.spec.ts >> desktop: rail hover delays, no reflow, pin persistence, keyboard and account isolation
- Location: tests/desktop-workspace.spec.ts:30:5

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  getByTestId('desktop-sidebar')
Expected: "true"
Received: "false"
Timeout:  8000ms

Call log:
  - Expect "toHaveAttribute" getByTestId('desktop-sidebar') with timeout 8000ms
  - waiting for getByTestId('desktop-sidebar')
    20 × locator resolved to <aside data-open="false" data-pinned="false" data-testid="desktop-sidebar" class="desktop-rail fixed inset-y-0 left-0 z-[var(--z-sidebar)] border-r border-sidebar-border bg-sidebar text-sidebar-foreground">…</aside>
       - unexpected value "false"

```

```yaml
- complementary:
  - button "Notifications"
  - navigation "Primary"
  - button "Sign Out"
  - button "Pin sidebar open"
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
  43  |   await page.screenshot({ path: "reports/desktop-workspace-release/journeys/desktop-rail-hover-open.png" });
  44  |   await page.mouse.move(400, 200);
  45  |   await page.waitForTimeout(180);
  46  |   await expect(sidebar).toHaveAttribute("data-open", "true");
  47  |   await expect(sidebar).toHaveAttribute("data-open", "false");
  48  |   await page.mouse.move(28, 200);
  49  |   await page.waitForTimeout(60);
  50  |   await page.mouse.move(400, 200);
  51  |   await page.waitForTimeout(190);
  52  |   await expect(sidebar).toHaveAttribute("data-open", "false");
  53  |   await page.keyboard.press("Control+b");
  54  |   await expect(sidebar).toHaveAttribute("data-pinned", "true");
  55  |   expect((await page.locator("main").boundingBox())!.x).toBe(256);
  56  |   await page.screenshot({ path: "reports/desktop-workspace-release/journeys/desktop-rail-pinned.png" });
  57  |   await page.reload();
  58  |   await expect(sidebar).toHaveAttribute("data-pinned", "true");
  59  |   await page.keyboard.press("Meta+b");
  60  |   await expect(sidebar).toHaveAttribute("data-pinned", "false");
  61  |   await page.keyboard.press("Control+k");
  62  |   const input = page.getByPlaceholder("Search pages, leads, deals, lenders, partners, and actions…");
  63  |   await input.fill("Settings");
  64  |   await page.keyboard.press("Control+b");
  65  |   await expect(sidebar).toHaveAttribute("data-pinned", "false");
  66  |   await page.keyboard.press("Escape");
  67  |   await page.keyboard.press("Control+b");
  68  |   console.log("[rail-pin] admin before sign-out", await page.evaluate(() => ({
  69  |     userId: (window as any).Clerk.user?.id,
  70  |     keys: Object.keys(localStorage).filter(key => key.startsWith("mbs-desktop-sidebar-pinned:")).map(key => [key, localStorage.getItem(key)]),
  71  |   })));
  72  |   await open(page, "/settings");
  73  |   await page.getByRole("button", { name: "Sign Out", exact: true }).first().click();
  74  |   await expect(page.getByRole("button", { name: "Sign Out", exact: true })).toHaveCount(0);
  75  |   console.log("[rail-pin] after admin sign-out", await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("mbs-desktop-sidebar-pinned:")).map(key => [key, localStorage.getItem(key)])));
  76  |   await sandbox.login(page, "rep");
  77  |   await open(page, "/dashboard");
  78  |   await expect(sidebar).toHaveAttribute("data-pinned", "false");
  79  |   await open(page, "/settings");
  80  |   await page.getByRole("button", { name: "Sign Out", exact: true }).first().click();
  81  |   await expect(page.getByRole("button", { name: "Sign Out", exact: true })).toHaveCount(0);
  82  |   console.log("[rail-pin] after rep sign-out", await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("mbs-desktop-sidebar-pinned:")).map(key => [key, localStorage.getItem(key)])));
  83  |   await sandbox.login(page, "admin");
  84  |   await open(page, "/dashboard");
> 85  |   await expect(sidebar).toHaveAttribute("data-pinned", "true");
      |                         ^ Error: expect(locator).toHaveAttribute(expected) failed
  86  |   await page.setViewportSize({ width: 1023, height: 900 });
  87  |   await expect(sidebar).toHaveCount(0);
  88  |   await page.keyboard.press("Control+b");
  89  |   await page.setViewportSize({ width: 1024, height: 900 });
  90  |   await expect(sidebar).toHaveAttribute("data-pinned", "true");
  91  | });
  92  | 
  93  | test("desktop: authorized palette covers company/contact/email/phone, deals, lenders, brokers and pages", async ({ page }) => {
  94  |   await open(page, "/dashboard");
  95  |   const privateLead = await api(page, "/leads", { firstName: "Restricted", lastName: "Owner", companyName: "Private Admin Company", email: "private-desktop@example.invalid", assignedRepId: 2 });
  96  |   expect(privateLead.status).toBe(201);
  97  |   const broker = await api(page, "/lenders", { name: "Desktop Broker Partner", partnerType: "broker_out", programTypes: ["equipment"], isActive: true });
  98  |   expect(broker.status).toBe(201);
  99  |   const search = async (term: string, expected: string) => {
  100 |     await page.keyboard.press("Control+k");
  101 |     await page.getByPlaceholder("Search pages, leads, deals, lenders, partners, and actions…").fill(term);
  102 |     await expect(page.getByRole("option").filter({ hasText: expected }).first()).toBeVisible();
  103 |     await page.keyboard.press("Escape");
  104 |   };
  105 |   for (const term of ["Fixture Equipment", "Synthetic Contact", "contact@example.invalid", "12025550123"]) await search(term, "Fixture Equipment LLC");
  106 |   await search("Synthetic equipment financing", "Fixture Equipment LLC");
  107 |   await search("Visual Fixture Match", "Visual Fixture Match Partner");
  108 |   await search("Desktop Broker", "Desktop Broker Partner");
  109 |   await search("Settings", "Settings");
  110 |   await page.keyboard.press("Control+k");
  111 |   await page.getByPlaceholder("Search pages, leads, deals, lenders, partners, and actions…").fill("Desktop Broker");
  112 |   await page.getByRole("option").filter({ hasText: "Desktop Broker Partner" }).click();
  113 |   await expect(page).toHaveURL(new RegExp(`/lenders\\?partner=${broker.body.id}$`));
  114 |   await expect(page.locator(`#partner-${broker.body.id}`)).toBeInViewport();
  115 |   await open(page, "/settings");
  116 |   await page.getByRole("button", { name: "Sign Out", exact: true }).first().click();
  117 |   await expect(page.getByRole("button", { name: "Sign Out", exact: true })).toHaveCount(0);
  118 |   await sandbox.login(page, "rep");
  119 |   await open(page, "/dashboard");
  120 |   await page.keyboard.press("Control+k");
  121 |   const input = page.getByPlaceholder("Search pages, leads, deals, lenders, partners, and actions…");
  122 |   await input.fill("Private Admin");
  123 |   await page.waitForLoadState("networkidle");
  124 |   await expect(page.getByRole("option").filter({ hasText: "Private Admin Company" })).toHaveCount(0);
  125 |   const forbidden = await api(page, `/leads/${privateLead.body.id}`, undefined, "GET");
  126 |   expect([403, 404]).toContain(forbidden.status);
  127 |   await input.fill("Visual Fixture Match");
  128 |   await expect(page.getByRole("option").filter({ hasText: "Visual Fixture Match Partner" })).toBeVisible();
  129 |   await page.route("**/api/leads?**", route => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Isolated search failure"}' }));
  130 |   await input.fill("Failure Search");
  131 |   await expect(page.getByText("Some record results could not be loaded.", { exact: false })).toBeVisible();
  132 | });
  133 | 
  134 | test("desktop: equal readable columns and independent lead activity at exact breakpoints", async ({ page }) => {
  135 |   await open(page, "/deals");
  136 |   const approval = await api(page, "/deals/1/approvals", {
  137 |     lenderId: 1, contractType: "EFA", advance: 125000, payment: 2500, term: 60,
  138 |     downPayment: 0, tier: "A", expiresOn: "2026-12-30", approvalDocumentId: null,
  139 |   });
  140 |   expect(approval.status).toBe(201);
  141 |   await page.reload();
  142 |   for (const width of [1024, 1280, 1440]) {
  143 |     await page.setViewportSize({ width, height: 900 });
  144 |     const board = page.getByTestId("deals-board-desktop");
  145 |     await expect(board).toBeVisible();
  146 |     const widths = await board.locator(".deals-board-desktop > div").evaluateAll(elements => elements.map(el => el.getBoundingClientRect().width));
  147 |     expect(widths.length).toBe(9);
  148 |     expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1);
  149 |     const card = board.locator(".deal-wrap").filter({ hasText: "Fixture Equipment LLC" }).first();
  150 |     for (const field of ["Synthetic Contact", "+12025550123", "$125,000", "Visual Fixture Match Partner", "Age:", "Approval expiry:", "Dec 30, 2026"]) await expect(card).toContainText(field);
  151 |     const clipped = await card.locator("*").evaluateAll(elements => elements.filter(el => {
  152 |       const style = getComputedStyle(el);
  153 |       return style.textOverflow === "ellipsis" || (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2 && style.overflowX === "hidden");
  154 |     }).map(el => el.textContent));
  155 |     expect(clipped).toEqual([]);
  156 |   }
  157 |   await page.setViewportSize({ width: 1279, height: 900 });
  158 |   // Seed enough local audit activity to make the right timeline pane scrollable,
  159 |   // then restore the fixture company identity before exercising layout.
  160 |   for (let i = 0; i < 20; i++) {
  161 |     const companyName = i === 19 ? "Fixture Equipment LLC" : `Fixture Equipment Activity ${i}`;
  162 |     const update = await api(page, "/leads/1", { companyName }, "PUT");
  163 |     expect(update.status).toBe(200);
  164 |   }
  165 |   await open(page, "/leads/1");
  166 |   await expect(page.locator(".lead-detail-columns")).toHaveCount(0);
  167 |   await expect(page.getByRole("tab", { name: "Activity", exact: true })).toBeVisible();
  168 |   await page.setViewportSize({ width: 1280, height: 900 });
  169 |   await expect(page.locator(".lead-detail-columns")).toBeVisible();
  170 |   await expect(page.getByRole("tab", { name: "Activity", exact: true })).toHaveCount(0);
  171 |   const panes = page.locator(".lead-detail-columns > *");
  172 |   await expect(panes).toHaveCount(2);
  173 |   await expect(page.getByText(/Visual Fixture updated lead/).first()).toBeVisible();
  174 |   await page.screenshot({ path: "reports/desktop-workspace-release/journeys/desktop-lead-wide-activity.png" });
  175 |   const rightBefore = await panes.nth(1).evaluate(el => el.scrollTop);
  176 |   await panes.nth(0).evaluate(el => { el.scrollTop = el.scrollHeight; });
  177 |   expect(await panes.nth(0).evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  178 |   expect(await panes.nth(1).evaluate(el => el.scrollTop)).toBe(rightBefore);
  179 |   await panes.nth(0).evaluate(el => { el.scrollTop = 0; });
  180 |   await panes.nth(1).evaluate(el => { el.scrollTop = el.scrollHeight; });
  181 |   expect(await panes.nth(1).evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  182 |   expect(await panes.nth(0).evaluate(el => el.scrollTop)).toBe(0);
  183 |   await page.screenshot({ path: "reports/desktop-workspace-release/journeys/desktop-lead-wide-right-scroll.png" });
  184 |   for (const tab of ["Docs", "Lenders"]) await expect(page.getByRole("tab", { name: tab, exact: true })).toBeVisible();
  185 | });
```