# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: desktop-workspace.spec.ts >> desktop: equal readable columns and independent lead activity at exact breakpoints
- Location: tests/desktop-workspace.spec.ts:119:5

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 200
Received: 400
```

# Test source

```ts
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
  68  |   await sandbox.login(page, "rep");
  69  |   await open(page, "/dashboard");
  70  |   await expect(sidebar).toHaveAttribute("data-pinned", "false");
  71  |   await sandbox.login(page, "admin");
  72  |   await open(page, "/dashboard");
  73  |   await expect(sidebar).toHaveAttribute("data-pinned", "true");
  74  |   await page.setViewportSize({ width: 1023, height: 900 });
  75  |   await expect(sidebar).toHaveCount(0);
  76  |   await page.keyboard.press("Control+b");
  77  |   await page.setViewportSize({ width: 1024, height: 900 });
  78  |   await expect(sidebar).toHaveAttribute("data-pinned", "true");
  79  | });
  80  | 
  81  | test("desktop: authorized palette covers company/contact/email/phone, deals, lenders, brokers and pages", async ({ page }) => {
  82  |   await open(page, "/dashboard");
  83  |   const privateLead = await api(page, "/leads", { firstName: "Restricted", lastName: "Owner", companyName: "Private Admin Company", email: "private-desktop@example.invalid", assignedRepId: 2 });
  84  |   expect(privateLead.status).toBe(201);
  85  |   const broker = await api(page, "/lenders", { name: "Desktop Broker Partner", partnerType: "broker_out", programTypes: ["equipment"], isActive: true });
  86  |   expect(broker.status).toBe(201);
  87  |   const search = async (term: string, expected: string) => {
  88  |     await page.keyboard.press("Control+k");
  89  |     await page.getByPlaceholder("Search pages, leads, deals, lenders, partners, and actions…").fill(term);
  90  |     await expect(page.getByRole("option").filter({ hasText: expected }).first()).toBeVisible();
  91  |     await page.keyboard.press("Escape");
  92  |   };
  93  |   for (const term of ["Fixture Equipment", "Synthetic Contact", "contact@example.invalid", "12025550123"]) await search(term, "Fixture Equipment LLC");
  94  |   await search("Synthetic equipment financing", "Fixture Equipment LLC");
  95  |   await search("Visual Fixture Match", "Visual Fixture Match Partner");
  96  |   await search("Desktop Broker", "Desktop Broker Partner");
  97  |   await search("Settings", "Settings");
  98  |   await page.keyboard.press("Control+k");
  99  |   await page.getByPlaceholder("Search pages, leads, deals, lenders, partners, and actions…").fill("Desktop Broker");
  100 |   await page.getByRole("option").filter({ hasText: "Desktop Broker Partner" }).click();
  101 |   await expect(page).toHaveURL(new RegExp(`/lenders\\?partner=${broker.body.id}$`));
  102 |   await expect(page.locator(`#partner-${broker.body.id}`)).toBeInViewport();
  103 |   await sandbox.login(page, "rep");
  104 |   await open(page, "/dashboard");
  105 |   await page.keyboard.press("Control+k");
  106 |   const input = page.getByPlaceholder("Search pages, leads, deals, lenders, partners, and actions…");
  107 |   await input.fill("Private Admin");
  108 |   await page.waitForLoadState("networkidle");
  109 |   await expect(page.getByRole("option").filter({ hasText: "Private Admin Company" })).toHaveCount(0);
  110 |   const forbidden = await api(page, `/leads/${privateLead.body.id}`, undefined, "GET");
  111 |   expect([403, 404]).toContain(forbidden.status);
  112 |   await input.fill("Visual Fixture Match");
  113 |   await expect(page.getByRole("option").filter({ hasText: "Visual Fixture Match Partner" })).toBeVisible();
  114 |   await page.route("**/api/leads?**", route => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Isolated search failure"}' }));
  115 |   await input.fill("Failure Search");
  116 |   await expect(page.getByText("Some record results could not be loaded.", { exact: false })).toBeVisible();
  117 | });
  118 | 
  119 | test("desktop: equal readable columns and independent lead activity at exact breakpoints", async ({ page }) => {
  120 |   await open(page, "/deals");
  121 |   const approval = await api(page, "/deals/1/approvals", {
  122 |     lenderId: 1, contractType: "EFA", advance: 125000, payment: 2500, term: 60,
  123 |     downPayment: 0, tier: "A", expiresOn: "2026-12-30", approvalDocumentId: null,
  124 |   });
  125 |   expect(approval.status).toBe(201);
  126 |   await page.reload();
  127 |   for (const width of [1024, 1280, 1440]) {
  128 |     await page.setViewportSize({ width, height: 900 });
  129 |     const board = page.getByTestId("deals-board-desktop");
  130 |     await expect(board).toBeVisible();
  131 |     const widths = await board.locator(".deals-board-desktop > div").evaluateAll(elements => elements.map(el => el.getBoundingClientRect().width));
  132 |     expect(widths.length).toBe(9);
  133 |     expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1);
  134 |     const card = board.locator(".deal-wrap").filter({ hasText: "Fixture Equipment LLC" }).first();
  135 |     for (const field of ["Synthetic Contact", "+12025550123", "$125,000", "Visual Fixture Match Partner", "Age:", "Approval expiry:", "Dec 30, 2026"]) await expect(card).toContainText(field);
  136 |     const clipped = await card.locator("*").evaluateAll(elements => elements.filter(el => {
  137 |       const style = getComputedStyle(el);
  138 |       return style.textOverflow === "ellipsis" || (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2 && style.overflowX === "hidden");
  139 |     }).map(el => el.textContent));
  140 |     expect(clipped).toEqual([]);
  141 |   }
  142 |   await page.setViewportSize({ width: 1279, height: 900 });
  143 |   // Seed enough local audit activity to make the right timeline pane scrollable.
  144 |   // Toggle the fixture lead and return it to rep 3, preserving its ownership.
  145 |   for (let i = 0; i < 20; i++) {
  146 |     const assignment = await api(page, "/leads/1/assign", { repId: i % 2 === 0 ? 2 : 3 }, "PUT");
> 147 |     expect(assignment.status).toBe(200);
      |                               ^ Error: expect(received).toBe(expected) // Object.is equality
  148 |   }
  149 |   await open(page, "/leads/1");
  150 |   await expect(page.locator(".lead-detail-columns")).toHaveCount(0);
  151 |   await expect(page.getByRole("tab", { name: "Activity", exact: true })).toBeVisible();
  152 |   await page.setViewportSize({ width: 1280, height: 900 });
  153 |   await expect(page.locator(".lead-detail-columns")).toBeVisible();
  154 |   await expect(page.getByRole("tab", { name: "Activity", exact: true })).toHaveCount(0);
  155 |   const panes = page.locator(".lead-detail-columns > *");
  156 |   await expect(panes).toHaveCount(2);
  157 |   await expect(page.getByText(/Assigned to Visual Fixture by Visual Fixture/).first()).toBeVisible();
  158 |   await page.screenshot({ path: "reports/desktop-workspace-release/journeys/desktop-lead-wide-activity.png" });
  159 |   const rightBefore = await panes.nth(1).evaluate(el => el.scrollTop);
  160 |   await panes.nth(0).evaluate(el => { el.scrollTop = el.scrollHeight; });
  161 |   expect(await panes.nth(0).evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  162 |   expect(await panes.nth(1).evaluate(el => el.scrollTop)).toBe(rightBefore);
  163 |   await panes.nth(0).evaluate(el => { el.scrollTop = 0; });
  164 |   await panes.nth(1).evaluate(el => { el.scrollTop = el.scrollHeight; });
  165 |   expect(await panes.nth(1).evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  166 |   expect(await panes.nth(0).evaluate(el => el.scrollTop)).toBe(0);
  167 |   await page.screenshot({ path: "reports/desktop-workspace-release/journeys/desktop-lead-wide-right-scroll.png" });
  168 |   for (const tab of ["Docs", "Lenders"]) await expect(page.getByRole("tab", { name: tab, exact: true })).toBeVisible();
  169 | });
  170 | 
  171 | test("desktop: funded deal action-bar upload persists metadata and exact bytes", async ({ page }) => {
  172 |   await open(page, "/deals/1");
  173 |   const funded = await api(page, "/deals/1", { stage: "funded", actualGm: 7500 }, "PUT");
  174 |   expect(funded.status).toBe(200);
  175 |   await page.reload();
  176 |   const payload = Buffer.from(`Synthetic funded-deal evidence ${Date.now()}\n`);
  177 |   const filename = `funded-desktop-${Date.now()}.txt`;
  178 |   const chooser = page.waitForEvent("filechooser");
  179 |   await page.getByRole("navigation", { name: "Record actions" }).getByRole("button", { name: "Upload", exact: true }).click();
  180 |   const uploaded = page.waitForResponse(response => /\/api\/leads\/1\/documents$/.test(response.url()) && response.request().method() === "POST" && response.status() === 201);
  181 |   await (await chooser).setFiles({ name: filename, mimeType: "text/plain", buffer: payload });
  182 |   await uploaded;
  183 |   const row = JSON.parse(sandbox.query(`SELECT to_jsonb(d)::text FROM documents d WHERE lead_id=1 AND filename='${filename}'`));
  184 |   expect(row.file_size).toBe(payload.length);
  185 |   async function files(directory: string): Promise<string[]> {
  186 |     const entries = await readdir(directory, { withFileTypes: true });
  187 |     return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]))).flat();
  188 |   }
  189 |   const stored = await Promise.all((await files(sandbox.storageDirectory)).filter(path => !path.endsWith(".metadata.json")).map(path => readFile(path)));
  190 |   expect(stored.some(bytes => bytes.equals(payload))).toBe(true);
  191 |   await page.screenshot({ path: "reports/desktop-workspace-release/journeys/funded-deal-upload.png" });
  192 | });
  193 | 
  194 | test("desktop: phone handoff on mobile and desktop without a registered softphone", async ({ page }) => {
  195 |   const callRequests: string[] = [];
  196 |   page.on("request", request => {
  197 |     if (/\/api\/.*(?:voice\/call|twilio\/call)/.test(request.url())) callRequests.push(request.url());
  198 |   });
  199 |   for (const width of [1440, 390]) {
  200 |     await page.setViewportSize({ width, height: 900 });
  201 |     await open(page, "/leads/1");
  202 |     const phone = page.locator('a[href="tel:+12025550123"]').first();
  203 |     await expect(phone).toBeVisible();
  204 |     await page.evaluate(() => {
  205 |       (window as any).__handoffs = [];
  206 |       document.addEventListener("click", event => {
  207 |         const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="tel:"]');
  208 |         if (!anchor) return;
  209 |         queueMicrotask(() => {
  210 |           (window as any).__handoffs.push({ href: anchor.getAttribute("href"), handledByCRM: event.defaultPrevented });
  211 |           // A headless browser has no phone dialer; do not invoke one.
  212 |           event.preventDefault();
  213 |         });
  214 |       }, true);
  215 |     });
  216 |     await phone.click();
  217 |     await expect.poll(() => page.evaluate(() => (window as any).__handoffs)).toEqual([{ href: "tel:+12025550123", handledByCRM: false }]);
  218 |   }
  219 |   expect(callRequests).toEqual([]);
  220 | });
```