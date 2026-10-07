import { test, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

let sandbox: any;
const reportDir = "reports/deals-pipeline-fix";

test.beforeAll(async () => {
  const nativeImport = new Function("path", "return import(path)");
  const { startSandbox } = await nativeImport("../scripts/visual-refresh/sandbox.mjs");
  sandbox = await startSandbox({ build: true, port: 4372 });
  await mkdir(reportDir, { recursive: true });

  sandbox.seedFixture(`INSERT INTO leads(id,first_name,last_name,email,phone,company_name,application_type,status,assigned_rep_id,created_at,updated_at,last_activity_at)
    VALUES (3,'Private','Fixture','private-linked@example.invalid','+12025550199','Private Linked Business','equipment','contacted',2,'2026-09-15','2026-09-15','2026-09-15') RETURNING id;`);
  const deals = Array.from({ length: 24 }, (_, index) => {
    const n = String(index + 1).padStart(2, "0");
    return `(${5 + index},NULL,'Pipeline Scroll Business ${n}','submitted',${10000 + index * 100},500,1,'2026-12-31','2026-12-31')`;
  });
  deals.push("(29,NULL,'','submitted',10000,500,1,'2026-12-31','2026-12-31')");
  deals.push("(30,1,'Authorized Stored Name Must Not Win','waiting_on_app',125000,7500,3,'2026-12-31','2026-12-31')");
  deals.push("(31,3,'Private Linked Business Stored Name','waiting_on_app',50000,3000,3,'2026-12-31','2026-12-31')");
  sandbox.seedFixture(`INSERT INTO deals(id,lead_id,deal_name,stage,amount,approx_gm,assigned_to,created_at,updated_at) VALUES ${deals.join(",")} RETURNING id;`);
});

test.afterAll(async () => {
  if (sandbox) {
    await sandbox.close();
    const cleanup = sandbox.cleanupReport();
    await writeFile(`${reportDir}/cleanup.json`, JSON.stringify(cleanup, null, 2));
  }
});

async function open(page: Page, role = "admin") {
  await sandbox.login(page, role);
  await page.goto(`${sandbox.url}/deals`);
  await expect(page.getByRole("heading", { name: "Deals", exact: true })).toBeVisible();
  await expect(page.getByTestId("deals-board-desktop").or(page.locator(".deals-data-table"))).toBeVisible();
}

async function api(page: Page, path: string, method = "GET", body?: unknown) {
  return page.evaluate(async ({ path, method, body }) => {
    const token = await (window as any).Clerk.session.getToken();
    const response = await fetch(`/api${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  }, { path, method, body });
}

test("desktop pipeline identities and stage scrolling at target sizes, themes, and densities", async ({ page }) => {
  await open(page);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const board = page.getByTestId("deals-board-desktop");
  const submitted = page.getByTestId("deals-stage-scroll-submitted");
  const linkedStage = page.getByTestId("deals-stage-scroll-waiting_on_app");
  await page.getByPlaceholder("Search deals...").fill("Authorized Stored Name Must Not Win");
  await expect(linkedStage).toContainText("Fixture Equipment LLC");
  await expect(linkedStage).toContainText("Synthetic Contact");
  await expect(linkedStage).toContainText("+12025550123");
  await expect(linkedStage).toContainText("contact@example.invalid");
  await page.getByPlaceholder("Search deals...").fill("");
  await expect(submitted).toContainText("Pipeline Scroll Business 24");
  const expectedNames = Array.from({ length: 24 }, (_, index) =>
    `Pipeline Scroll Business ${String(index + 1).padStart(2, "0")}`);
  await expect(board).toContainText(expectedNames[0]);
  for (const name of expectedNames) await expect(submitted).toContainText(name);
  await expect(submitted).not.toContainText(/Deal\s*#?\s*\d+/i);
  const blank = submitted.locator(".deal-wrap").filter({ has: page.locator('a[href="/deals/29"]') });
  await expect(blank).toBeVisible();
  await expect(blank).not.toContainText(/Deal\s*#?\s*\d+/i);

  for (const [width, height] of [[1024, 600], [1280, 720], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    for (const theme of ["light", "dark"]) {
      await page.evaluate(theme => {
        localStorage.setItem("mbs-web-appearance:1", theme);
        document.documentElement.classList.toggle("dark", theme === "dark");
      }, theme);
      for (const density of ["compact", "comfortable"]) {
        const toggle = page.getByRole("button", { name: "Toggle compact Kanban" });
        const currentlyCompact = (await toggle.getAttribute("aria-pressed")) === "true";
        if (currentlyCompact !== (density === "compact")) await toggle.click();
        await expect(board.locator(":scope > div")).toHaveAttribute("data-density", density);
        if (density === "compact") {
          const columnWidths = await board.locator(":scope > div > div").evaluateAll(els => els.map(el => el.getBoundingClientRect().width));
          console.log("compact column metrics", width, height, columnWidths, await board.evaluate(el => ({
            clientWidth: el.clientWidth, scrollWidth: el.scrollWidth,
            inner: el.firstElementChild?.getBoundingClientRect().toJSON(),
            innerScrollWidth: (el.firstElementChild as HTMLElement)?.scrollWidth,
          })));
          await page.screenshot({ path: `${reportDir}/compact-debug-${width}x${height}.png` });
          expect(Math.min(...columnWidths)).toBeGreaterThan(0);
          expect(Math.max(...columnWidths) - Math.min(...columnWidths)).toBeLessThan(2);
          // Nine readable columns fit wide screens; at shorter desktop widths,
          // the compact board must scroll horizontally rather than crush cards.
          if (width >= 1440) {
            expect(await board.evaluate(el => el.scrollWidth)).toBeLessThanOrEqual(await board.evaluate(el => el.clientWidth + 1));
          } else {
            expect(await board.evaluate(el => el.scrollWidth)).toBeGreaterThan(await board.evaluate(el => el.clientWidth));
          }
        } else {
          expect(await board.evaluate(el => el.scrollWidth)).toBeGreaterThan(await board.evaluate(el => el.clientWidth));
          await board.evaluate(el => { el.scrollLeft = el.scrollWidth; });
          expect(await board.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
          await expect(board.locator(":scope > div > div").last()).toBeInViewport();
        }
        await submitted.evaluate(el => { el.scrollTop = 0; });
        await submitted.hover();
        await page.mouse.wheel(0, 100000);
        await expect.poll(() => submitted.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
        const scrollAfterWheel = await submitted.evaluate(el => el.scrollTop);
        const scrollMetrics = await submitted.evaluate(el => ({
          scrollTop: el.scrollTop, clientHeight: el.clientHeight, scrollHeight: el.scrollHeight,
          overflowY: getComputedStyle(el).overflowY,
          stage: el.getBoundingClientRect().toJSON(),
          board: el.parentElement?.getBoundingClientRect().toJSON(),
          last: el.lastElementChild?.getBoundingClientRect().toJSON(),
        }));
        console.log("deals scroll metrics", width, height, theme, density, scrollMetrics);
        await page.screenshot({ path: `${reportDir}/wheel-debug-${width}x${height}-${theme}-${density}.png` });
        expect(scrollAfterWheel).toBeGreaterThan(0);
        await submitted.focus();
        await page.keyboard.press("End");
        const endState = await submitted.evaluate(el => ({
          top: el.scrollTop, max: el.scrollHeight - el.clientHeight,
          last: el.lastElementChild?.getBoundingClientRect().toJSON(),
          region: el.getBoundingClientRect().toJSON(),
          header: document.querySelector("h1")?.getBoundingClientRect().toJSON(),
        }));
        expect(endState.top).toBeGreaterThan(0);
        expect(endState.top).toBeGreaterThanOrEqual(endState.max - 2);
        expect(endState.last.y).toBeGreaterThanOrEqual(endState.region.y - 1);
        expect(endState.last.y + endState.last.height).toBeLessThanOrEqual(endState.region.y + endState.region.height + 1);
        expect(endState.header.y).toBeGreaterThanOrEqual(0);
        await expect(page.getByText("Total Approx GM:", { exact: true })).toBeVisible();
        await page.screenshot({ path: `${reportDir}/desktop-${width}x${height}-${theme}-${density}.png` });
        await submitted.evaluate(el => { el.scrollTop = 0; });
      }
    }
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByTestId("deals-stage-scroll-submitted").locator(".deal-wrap").filter({ hasText: "Pipeline Scroll Business 01" }).getByRole("link").first().click();
  await expect(page).toHaveURL(/\/deals\/\d+$/);
  expect(errors).toEqual([]);
});

test("authorized and private identities, no communication handoff, table/mobile fallback", async ({ page }) => {
  await open(page);
  const phoneCalls: string[] = [];
  const communicationRequests: string[] = [];
  page.on("request", request => {
    if (/\/api\/.*(?:twilio\/(?:call|sms)|email\/send|voice\/call)/.test(request.url()) && request.method() !== "GET")
      communicationRequests.push(`${request.method()} ${request.url()}`);
  });
  await page.getByPlaceholder("Search deals...").fill("Authorized Stored Name Must Not Win");
  await expect(page.getByTestId("deals-stage-scroll-waiting_on_app")).toContainText("Fixture Equipment LLC");
  const authorizedCard = page.locator(".deal-wrap").filter({ hasText: "Fixture Equipment LLC" }).first();
  await expect(authorizedCard).toContainText("Synthetic Contact");
  const phone = authorizedCard.locator('a[href^="tel:"]').first();
  const email = authorizedCard.locator('a[href*="compose=email"]').first();
  await expect(phone).toHaveAttribute("href", "tel:+12025550123");
  await expect(email).toHaveAttribute("href", "/leads/1?compose=email");
  await page.evaluate(() => document.addEventListener("click", event => {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="tel:"],a[href*="compose=email"]');
    if (link) { (window as any).__handoffs = [...((window as any).__handoffs ?? []), link.getAttribute("href")]; event.preventDefault(); }
  }, true));
  await phone.click();
  await email.click();
  phoneCalls.push(...await page.evaluate(() => (window as any).__handoffs ?? []));
  expect(phoneCalls).toEqual(["tel:+12025550123", "/leads/1?compose=email"]);
  await expect(page).toHaveURL(/\/leads\/1\?compose=email$/);
  expect(communicationRequests).toEqual([]);
  await page.goto(`${sandbox.url}/deals`);
  await expect(page.getByRole("heading", { name: "Deals", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Table/ }).click();
  await expect(page.locator(".deals-data-table")).toBeVisible();
  await page.setViewportSize({ width: 1024, height: 720 });
  const tableOverflow = await page.locator(".deals-data-table").evaluate(el => {
    let ancestor = el.parentElement;
    while (ancestor && ancestor.scrollWidth <= ancestor.clientWidth + 1) ancestor = ancestor.parentElement;
    return ancestor ? {
      clientWidth: ancestor.clientWidth, scrollWidth: ancestor.scrollWidth,
      overflowX: getComputedStyle(ancestor).overflowX,
    } : null;
  });
  console.log("table scroll metrics", tableOverflow);
  expect(tableOverflow).not.toBeNull();
  expect(tableOverflow!.scrollWidth).toBeGreaterThan(tableOverflow!.clientWidth);
  await page.screenshot({ path: `${reportDir}/deals-table.png` });
  await page.getByRole("button", { name: /Kanban/ }).click();

  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.reload();
    await expect(page.getByTestId("deals-board-desktop")).toHaveCount(0);
    await expect(page.locator(".deals-board-desktop")).toHaveCount(0);
    const waiting = page.getByText("Waiting on App", { exact: true }).first();
    const submitted = page.getByText("Submitted", { exact: true }).first();
    await expect(waiting).toBeVisible();
    await expect(submitted).toBeAttached();
    expect((await waiting.boundingBox())!.x).toBeLessThan((await submitted.boundingBox())!.x);
    await page.screenshot({ path: `${reportDir}/deals-table-${width}.png` });
  }

  const browser = page.context().browser();
  if (!browser) throw new Error("Expected a browser for isolated role contexts");
  // Clerk does not permit a second sign-in ticket on an already signed-in page.
  // Keep each role in its own browser context, as in the production boundary.
  const managerContext = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: "block" });
  try {
    const managerPage = await managerContext.newPage();
    await open(managerPage, "manager");
    const manager = await api(managerPage, "/deals/30");
    expect(manager.status).toBe(200);
    expect(JSON.stringify(manager.body)).toContain("Fixture Equipment LLC");
    expect(JSON.stringify(manager.body)).toContain("Synthetic Contact");
  } finally {
    await managerContext.close();
  }

  const repContext = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: "block" });
  try {
    const repPage = await repContext.newPage();
    const repUserRequests: string[] = [];
    repPage.on("request", request => {
      if (request.method() === "GET" && /\/api\/users(?:[/?]|$)/.test(new URL(request.url()).pathname))
        repUserRequests.push(request.url());
    });
    await open(repPage, "rep");
    const rep = await api(repPage, "/deals?limit=100");
    expect(rep.status).toBe(200);
    expect(repUserRequests).toEqual([]);
    const authorizedRepDeal = rep.body.deals.find((deal: any) => deal.id === 30);
    expect(authorizedRepDeal.dealName).toContain("Fixture Equipment LLC");
    expect(authorizedRepDeal.contactName).toBe("Synthetic Contact");
    expect(authorizedRepDeal.contactEmail).toBe("contact@example.invalid");
    const privateDeal = rep.body.deals.find((deal: any) => deal.id === 31);
    expect(privateDeal).toBeTruthy();
    expect(privateDeal.dealName).toBe("Lead details unavailable");
    expect(JSON.stringify(privateDeal)).not.toMatch(/Private Linked Business|private-linked@example\.invalid|\+12025550199/);
    await repPage.getByPlaceholder("Search deals...").fill("Private Linked Business");
    await expect(repPage.locator(".deal-wrap")).toHaveCount(0);
    await repPage.screenshot({ path: `${reportDir}/rep-private-identity-check.png` });
  } finally {
    await repContext.close();
  }
});

test("synthetic drag/drop changes and persists stage; tablet/phone kanban remains scrollable", async ({ page }) => {
  await open(page);
  const source = page.locator(".deal-wrap").filter({ hasText: "Pipeline Scroll Business 01" }).first();
  const target = page.getByTestId("deals-stage-scroll-approved");
  await source.dragTo(target);
  await expect.poll(async () => (await api(page, "/deals/5")).body.stage).toBe("approved");
  await page.reload();
  await page.getByPlaceholder("Search deals...").fill("Pipeline Scroll Business 01");
  await expect(page.getByTestId("deals-stage-scroll-approved")).toContainText("Pipeline Scroll Business 01");
  await page.screenshot({ path: `${reportDir}/deal-drag-drop-persisted.png` });
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.reload();
    await expect(page.getByTestId("deals-board-desktop")).toHaveCount(0);
    await expect(page.locator(".deals-board-desktop")).toHaveCount(0);
    await expect(page.getByText("Waiting on App", { exact: true }).first()).toBeVisible();
    const region = page.locator(".overflow-x-auto").first();
    expect(await region.evaluate(el => el.scrollWidth)).toBeGreaterThan(await region.evaluate(el => el.clientWidth));
  }
});

test("automatically loads every page when the pipeline has more than 100 deals", async ({ page }) => {
  const rows = Array.from({ length: 80 }, (_, index) => {
    const n = String(index + 1).padStart(3, "0");
    return `(${100 + index},NULL,'Multi Page Business ${n}','approved',10000,500,1,'2026-12-31','2026-12-31')`;
  });
  sandbox.seedFixture(`INSERT INTO deals(id,lead_id,deal_name,stage,amount,approx_gm,assigned_to,created_at,updated_at) VALUES ${rows.join(",")} RETURNING id;`);
  await open(page);
  const first = await api(page, "/deals?limit=100");
  expect(first.status).toBe(200);
  expect(first.body.total).toBeGreaterThan(100);
  const second = await api(page, "/deals?limit=100&page=2");
  expect(second.status).toBe(200);
  expect(second.body.deals.length).toBeGreaterThan(0);
  // Count card links rather than all .deal-wrap containers: each stage also
  // contributes a wrapper with that class but no detail-page link.
  const cards = page.locator(".deal-wrap").filter({ has: page.locator('a[href^="/deals/"]') });
  await expect.poll(async () => cards.count()).toBe(first.body.total);
  const visibleIds = await cards.evaluateAll(els =>
    els.map(el => el.querySelector('a[href^="/deals/"]')?.getAttribute("href")));
  expect(new Set(visibleIds).size).toBe(first.body.total);
  const approved = page.getByTestId("deals-stage-scroll-approved");
  await expect(approved).toContainText("Multi Page Business 001");
  await expect(approved).toContainText("Multi Page Business 080");
  await approved.focus();
  await page.keyboard.press("End");
  await expect.poll(async () =>
    approved.evaluate(el => el.scrollTop >= el.scrollHeight - el.clientHeight - 2)
  ).toBe(true);
});
