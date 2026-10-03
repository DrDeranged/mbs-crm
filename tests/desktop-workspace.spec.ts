import { test, expect, type Page } from "@playwright/test";
import { readFile, readdir, mkdir } from "node:fs/promises";

let sandbox: any;
test.beforeAll(async () => {
  const nativeImport = new Function("path", "return import(path)");
  const { startSandbox } = await nativeImport("../scripts/visual-refresh/sandbox.mjs");
  sandbox = await startSandbox({ build: false, port: 4350 });
  await mkdir("reports/desktop-workspace-release/journeys", { recursive: true });
});
test.afterAll(async () => { await sandbox?.close(); });
test.beforeEach(async ({ page }) => { await sandbox.login(page, "admin"); });

async function open(page: Page, path: string) {
  await page.goto(sandbox.url + path);
  await page.locator("h1").first().waitFor();
  await page.waitForLoadState("networkidle");
}
async function api(page: Page, path: string, body?: unknown, method = "POST") {
  return page.evaluate(async ({ path, body, method }) => {
    const token = await (window as any).Clerk.session.getToken();
    const response = await fetch(`/api${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  }, { path, body, method });
}

test("desktop: rail hover delays, no reflow, pin persistence, keyboard and account isolation", async ({ page }) => {
  await open(page, "/dashboard");
  const sidebar = page.getByTestId("desktop-sidebar");
  await expect(sidebar).toHaveAttribute("data-pinned", "false");
  expect((await sidebar.boundingBox())?.width).toBe(56);
  await expect(sidebar.locator('[aria-current="page"]')).toHaveAttribute("aria-label", "Dashboard");
  const mainX = (await page.locator("main").boundingBox())!.x;
  await page.mouse.move(28, 200);
  await page.waitForTimeout(80);
  await expect(sidebar).toHaveAttribute("data-open", "false");
  await expect(sidebar).toHaveAttribute("data-open", "true");
  expect((await page.locator("main").boundingBox())!.x).toBe(mainX);
  await expect(page.getByRole("button", { name: "Open command palette", exact: true })).toHaveCount(1);
  await page.screenshot({ path: "reports/desktop-workspace-release/journeys/desktop-rail-hover-open.png" });
  await page.mouse.move(400, 200);
  await page.waitForTimeout(180);
  await expect(sidebar).toHaveAttribute("data-open", "true");
  await expect(sidebar).toHaveAttribute("data-open", "false");
  await page.mouse.move(28, 200);
  await page.waitForTimeout(60);
  await page.mouse.move(400, 200);
  await page.waitForTimeout(190);
  await expect(sidebar).toHaveAttribute("data-open", "false");
  await page.keyboard.press("Control+b");
  await expect(sidebar).toHaveAttribute("data-pinned", "true");
  expect((await page.locator("main").boundingBox())!.x).toBe(256);
  await page.screenshot({ path: "reports/desktop-workspace-release/journeys/desktop-rail-pinned.png" });
  await page.reload();
  await expect(sidebar).toHaveAttribute("data-pinned", "true");
  await page.keyboard.press("Meta+b");
  await expect(sidebar).toHaveAttribute("data-pinned", "false");
  await page.keyboard.press("Control+k");
  const input = page.getByPlaceholder("Search pages, leads, deals, lenders, partners, and actions…");
  await input.fill("Settings");
  await page.keyboard.press("Control+b");
  await expect(sidebar).toHaveAttribute("data-pinned", "false");
  await page.keyboard.press("Escape");
  await page.getByRole("heading", { name: "Dashboard", exact: true }).click();
  await page.keyboard.press("Control+b");
  await open(page, "/settings");
  await page.getByRole("button", { name: "Sign Out", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Sign Out", exact: true })).toHaveCount(0);
  await sandbox.login(page, "rep");
  await open(page, "/dashboard");
  await expect(sidebar).toHaveAttribute("data-pinned", "false");
  await open(page, "/settings");
  await page.getByRole("button", { name: "Sign Out", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Sign Out", exact: true })).toHaveCount(0);
  await sandbox.login(page, "admin");
  await open(page, "/dashboard");
  await expect(sidebar).toHaveAttribute("data-pinned", "true");
  await page.setViewportSize({ width: 1023, height: 900 });
  await expect(sidebar).toHaveCount(0);
  await page.keyboard.press("Control+b");
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(sidebar).toHaveAttribute("data-pinned", "true");
});

test("desktop: authorized palette covers company/contact/email/phone, deals, lenders, brokers and pages", async ({ page }) => {
  await open(page, "/dashboard");
  const privateLead = await api(page, "/leads", { firstName: "Restricted", lastName: "Owner", companyName: "Private Admin Company", email: "private-desktop@example.invalid", assignedRepId: 2 });
  expect(privateLead.status).toBe(201);
  const broker = await api(page, "/lenders", { name: "Desktop Broker Partner", partnerType: "broker_out", programTypes: ["equipment"], isActive: true });
  expect(broker.status).toBe(201);
  const search = async (term: string, expected: string) => {
    await page.keyboard.press("Control+k");
    await page.getByPlaceholder("Search pages, leads, deals, lenders, partners, and actions…").fill(term);
    await expect(page.getByRole("option").filter({ hasText: expected }).first()).toBeVisible();
    await page.keyboard.press("Escape");
  };
  for (const term of ["Fixture Equipment", "Synthetic Contact", "contact@example.invalid", "12025550123"]) await search(term, "Fixture Equipment LLC");
  await search("Synthetic equipment financing", "Fixture Equipment LLC");
  await search("Visual Fixture Match", "Visual Fixture Match Partner");
  await search("Desktop Broker", "Desktop Broker Partner");
  await search("Settings", "Settings");
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder("Search pages, leads, deals, lenders, partners, and actions…").fill("Desktop Broker");
  await page.getByRole("option").filter({ hasText: "Desktop Broker Partner" }).click();
  await expect(page).toHaveURL(new RegExp(`/lenders\\?partner=${broker.body.id}$`));
  await expect(page.locator(`#partner-${broker.body.id}`)).toBeInViewport();
  await open(page, "/settings");
  await page.getByRole("button", { name: "Sign Out", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Sign Out", exact: true })).toHaveCount(0);
  await sandbox.login(page, "rep");
  await open(page, "/dashboard");
  await page.keyboard.press("Control+k");
  const input = page.getByPlaceholder("Search pages, leads, deals, lenders, partners, and actions…");
  await input.fill("Private Admin");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("option").filter({ hasText: "Private Admin Company" })).toHaveCount(0);
  const forbidden = await api(page, `/leads/${privateLead.body.id}`, undefined, "GET");
  expect([403, 404]).toContain(forbidden.status);
  await input.fill("Visual Fixture Match");
  await expect(page.getByRole("option").filter({ hasText: "Visual Fixture Match Partner" })).toBeVisible();
  await page.route("**/api/leads?**", route => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Isolated search failure"}' }));
  await input.fill("Failure Search");
  await expect(page.getByText("Some record results could not be loaded.", { exact: false })).toBeVisible();
});

test("desktop: equal readable columns and independent lead activity at exact breakpoints", async ({ page }) => {
  await open(page, "/deals");
  const approval = await api(page, "/deals/1/approvals", {
    lenderId: 1, contractType: "EFA", advance: 125000, payment: 2500, term: 60,
    downPayment: 0, tier: "A", expiresOn: "2026-12-30", approvalDocumentId: null,
  });
  expect(approval.status).toBe(201);
  await page.reload();
  for (const width of [1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const board = page.getByTestId("deals-board-desktop");
    await expect(board).toBeVisible();
    const widths = await board.locator(".deals-board-desktop > div").evaluateAll(elements => elements.map(el => el.getBoundingClientRect().width));
    expect(widths.length).toBe(9);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1);
    const card = board.locator(".deal-wrap").filter({ hasText: "Fixture Equipment LLC" }).first();
    for (const field of ["Synthetic Contact", "+12025550123", "$125,000", "Visual Fixture Match Partner", "Age:", "Approval expiry:", "Dec 30, 2026"]) await expect(card).toContainText(field);
    const clipped = await card.locator("*").evaluateAll(elements => elements.filter(el => {
      const style = getComputedStyle(el);
      return style.textOverflow === "ellipsis" || (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2 && style.overflowX === "hidden");
    }).map(el => el.textContent));
    expect(clipped).toEqual([]);
  }
  await page.setViewportSize({ width: 1279, height: 900 });
  // Seed enough local audit activity to make the right timeline pane scrollable,
  // then restore the fixture company identity before exercising layout.
  for (let i = 0; i < 20; i++) {
    const companyName = i === 19 ? "Fixture Equipment LLC" : `Fixture Equipment Activity ${i}`;
    const update = await api(page, "/leads/1", { companyName }, "PUT");
    expect(update.status).toBe(200);
  }
  await open(page, "/leads/1");
  await expect(page.locator(".lead-detail-columns")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Activity", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator(".lead-detail-columns")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Activity", exact: true })).toHaveCount(0);
  const panes = page.locator(".lead-detail-columns > *");
  await expect(panes).toHaveCount(2);
  await expect(page.getByText(/Visual Fixture updated lead/).first()).toBeVisible();
  await page.screenshot({ path: "reports/desktop-workspace-release/journeys/desktop-lead-wide-activity.png" });
  const rightBefore = await panes.nth(1).evaluate(el => el.scrollTop);
  await panes.nth(0).evaluate(el => { el.scrollTop = el.scrollHeight; });
  expect(await panes.nth(0).evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  expect(await panes.nth(1).evaluate(el => el.scrollTop)).toBe(rightBefore);
  await panes.nth(0).evaluate(el => { el.scrollTop = 0; });
  await panes.nth(1).evaluate(el => { el.scrollTop = el.scrollHeight; });
  expect(await panes.nth(1).evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  expect(await panes.nth(0).evaluate(el => el.scrollTop)).toBe(0);
  await page.screenshot({ path: "reports/desktop-workspace-release/journeys/desktop-lead-wide-right-scroll.png" });
  for (const tab of ["Docs", "Lenders"]) await expect(page.getByRole("tab", { name: tab, exact: true })).toBeVisible();
});

test("desktop: funded deal action-bar upload persists metadata and exact bytes", async ({ page }) => {
  await open(page, "/deals/1");
  const funded = await api(page, "/deals/1", { stage: "funded", actualGm: 7500 }, "PUT");
  expect(funded.status).toBe(200);
  await page.reload();
  const payload = Buffer.from(`Synthetic funded-deal evidence ${Date.now()}\n`);
  const filename = `funded-desktop-${Date.now()}.txt`;
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("navigation", { name: "Record actions" }).getByRole("button", { name: "Upload", exact: true }).click();
  const uploaded = page.waitForResponse(response => /\/api\/leads\/1\/documents$/.test(response.url()) && response.request().method() === "POST" && response.status() === 201);
  await (await chooser).setFiles({ name: filename, mimeType: "text/plain", buffer: payload });
  await uploaded;
  const row = JSON.parse(sandbox.query(`SELECT to_jsonb(d)::text FROM documents d WHERE lead_id=1 AND filename='${filename}'`));
  expect(row.file_size).toBe(payload.length);
  async function files(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]))).flat();
  }
  const stored = await Promise.all((await files(sandbox.storageDirectory)).filter(path => !path.endsWith(".metadata.json")).map(path => readFile(path)));
  expect(stored.some(bytes => bytes.equals(payload))).toBe(true);
  await page.screenshot({ path: "reports/desktop-workspace-release/journeys/funded-deal-upload.png" });
});

test("desktop: phone handoff on mobile and desktop without a registered softphone", async ({ page }) => {
  const callRequests: string[] = [];
  page.on("request", request => {
    if (/\/api\/.*(?:voice\/call|twilio\/call)/.test(request.url())) callRequests.push(request.url());
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await open(page, "/leads/1");
    const phone = page.locator('a[href="tel:+12025550123"]').first();
    await expect(phone).toBeVisible();
    await page.evaluate(() => {
      (window as any).__handoffs = [];
      document.addEventListener("click", event => {
        const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="tel:"]');
        if (!anchor) return;
        queueMicrotask(() => {
          (window as any).__handoffs.push({ href: anchor.getAttribute("href"), handledByCRM: event.defaultPrevented });
          // A headless browser has no phone dialer; do not invoke one.
          event.preventDefault();
        });
      }, true);
    });
    await phone.click();
    await expect.poll(() => page.evaluate(() => (window as any).__handoffs)).toEqual([{ href: "tel:+12025550123", handledByCRM: false }]);
  }
  expect(callRequests).toEqual([]);
});