# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: desktop-workspace.spec.ts >> desktop: funded deal action-bar upload persists metadata and exact bytes
- Location: tests/desktop-workspace.spec.ts:156:5

# Error details

```
Error: page.evaluate: SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON
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
> 20  |   return page.evaluate(async ({ path, body, method }) => {
      |               ^ Error: page.evaluate: SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON
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
  37  |   await sidebar.dispatchEvent("pointerenter");
  38  |   await page.waitForTimeout(80);
  39  |   await expect(sidebar).toHaveAttribute("data-open", "false");
  40  |   await expect(sidebar).toHaveAttribute("data-open", "true");
  41  |   expect((await page.locator("main").boundingBox())!.x).toBe(mainX);
  42  |   await expect(page.getByRole("button", { name: "Open command palette", exact: true })).toHaveCount(1);
  43  |   await sidebar.dispatchEvent("pointerleave");
  44  |   await page.waitForTimeout(180);
  45  |   await expect(sidebar).toHaveAttribute("data-open", "true");
  46  |   await expect(sidebar).toHaveAttribute("data-open", "false");
  47  |   await sidebar.dispatchEvent("pointerenter");
  48  |   await page.waitForTimeout(60);
  49  |   await sidebar.dispatchEvent("pointerleave");
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
  81  |   const privateLead = await api(page, "/leads", { firstName: "Restricted", lastName: "Owner", companyName: "Private Admin Company", email: "private-desktop@example.invalid", assignedRepId: 1 });
  82  |   expect(privateLead.status).toBe(201);
  83  |   const broker = await api(page, "/lenders", { name: "Desktop Broker Partner", partnerType: "broker_out", programTypes: ["equipment"], isActive: true });
  84  |   expect(broker.status).toBe(201);
  85  |   const search = async (term: string, expected: string) => {
  86  |     await page.keyboard.press("Control+k");
  87  |     await page.getByPlaceholder("Search pages, leads, deals, lenders, partners, and actions…").fill(term);
  88  |     await expect(page.getByRole("option").filter({ hasText: expected }).first()).toBeVisible();
  89  |     await page.keyboard.press("Escape");
  90  |   };
  91  |   for (const term of ["Fixture Equipment", "Synthetic Contact", "contact@example.invalid", "12025550123"]) await search(term, "Fixture Equipment LLC");
  92  |   await search("Synthetic equipment financing", "Fixture Equipment LLC");
  93  |   await search("Visual Fixture Match", "Visual Fixture Match Partner");
  94  |   await search("Desktop Broker", "Desktop Broker Partner");
  95  |   await search("Settings", "Settings");
  96  |   await page.keyboard.press("Control+k");
  97  |   await page.getByPlaceholder("Search pages, leads, deals, lenders, partners, and actions…").fill("Desktop Broker");
  98  |   await page.getByRole("option").filter({ hasText: "Desktop Broker Partner" }).click();
  99  |   await expect(page).toHaveURL(new RegExp(`/lenders\\?partner=${broker.body.id}$`));
  100 |   await expect(page.locator(`#partner-${broker.body.id}`)).toBeInViewport();
  101 |   await sandbox.login(page, "rep");
  102 |   await open(page, "/dashboard");
  103 |   await page.keyboard.press("Control+k");
  104 |   const input = page.getByPlaceholder("Search pages, leads, deals, lenders, partners, and actions…");
  105 |   await input.fill("Private Admin");
  106 |   await page.waitForLoadState("networkidle");
  107 |   await expect(page.getByRole("option").filter({ hasText: "Private Admin Company" })).toHaveCount(0);
  108 |   const forbidden = await api(page, `/leads/${privateLead.body.id}`, undefined, "GET");
  109 |   expect([403, 404]).toContain(forbidden.status);
  110 |   await input.fill("Visual Fixture Match");
  111 |   await expect(page.getByRole("option").filter({ hasText: "Visual Fixture Match Partner" })).toBeVisible();
  112 |   await page.route("**/api/leads?**", route => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Isolated search failure"}' }));
  113 |   await input.fill("Failure Search");
  114 |   await expect(page.getByText("Some record results could not be loaded.", { exact: false })).toBeVisible();
  115 | });
  116 | 
  117 | test("desktop: equal readable columns and independent lead activity at exact breakpoints", async ({ page }) => {
  118 |   await open(page, "/deals");
  119 |   const approval = await api(page, "/deals/1/approvals", {
  120 |     lenderId: 1, contractType: "EFA", advance: 125000, payment: 2500, term: 60,
```