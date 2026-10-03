# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: web-visual-refresh.spec.ts >> journey: Log partner submission persists an actual manual submission
- Location: tests/web-visual-refresh.spec.ts:148:5

# Error details

```
Test timeout of 90000ms exceeded.
```

```
Error: locator.click: Test timeout of 90000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Log submission' })
    - locator resolved to <button class="inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 motion-reduce:transition-none border border-primary-border bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[.98] min-h-8 rounded-md px-3 text-xs max-md:min-…>Log submission</button>
  - attempting click action
    - waiting for element to be visible, enabled and stable
    - element is visible, enabled and stable
    - scrolling into view if needed
    - done scrolling
    - <div class="flex flex-col space-y-1.5 p-6 pb-4 border-b">…</div> from <div class="space-y-6 lg:sticky lg:top-[160px]">…</div> subtree intercepts pointer events
  - retrying click action
    - waiting for element to be visible, enabled and stable
    - element is visible, enabled and stable
    - scrolling into view if needed
    - done scrolling
    - <div class="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Created</div> from <div class="space-y-6 lg:sticky lg:top-[160px]">…</div> subtree intercepts pointer events
  - retrying click action
    - waiting 20ms
    - waiting for element to be visible, enabled and stable
    - element is visible, enabled and stable
    - scrolling into view if needed
    - done scrolling
    - <div class="p-6 space-y-4 pt-4">…</div> from <div class="space-y-6 lg:sticky lg:top-[160px]">…</div> subtree intercepts pointer events
  2 × retrying click action
      - waiting 100ms
      - waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <div class="flex flex-col space-y-1.5 p-6 pb-4 border-b">…</div> from <div class="space-y-6 lg:sticky lg:top-[160px]">…</div> subtree intercepts pointer events
  41 × retrying click action
       - waiting 500ms
       - waiting for element to be visible, enabled and stable
       - element is visible, enabled and stable
       - scrolling into view if needed
       - done scrolling
       - <div class="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Created</div> from <div class="space-y-6 lg:sticky lg:top-[160px]">…</div> subtree intercepts pointer events
     - retrying click action
       - waiting 500ms
       - waiting for element to be visible, enabled and stable
       - element is visible, enabled and stable
       - scrolling into view if needed
       - done scrolling
       - <div class="p-6 space-y-4 pt-4">…</div> from <div class="space-y-6 lg:sticky lg:top-[160px]">…</div> subtree intercepts pointer events
     - retrying click action
       - waiting 500ms
       - waiting for element to be visible, enabled and stable
       - element is visible, enabled and stable
       - scrolling into view if needed
       - done scrolling
       - <div class="flex flex-col space-y-1.5 p-6 pb-4 border-b">…</div> from <div class="space-y-6 lg:sticky lg:top-[160px]">…</div> subtree intercepts pointer events
     - retrying click action
       - waiting 500ms
       - waiting for element to be visible, enabled and stable
       - element is visible, enabled and stable
       - scrolling into view if needed
       - done scrolling
       - <div class="flex flex-col space-y-1.5 p-6 pb-4 border-b">…</div> from <div class="space-y-6 lg:sticky lg:top-[160px]">…</div> subtree intercepts pointer events
  - retrying click action
    - waiting 500ms
    - waiting for element to be visible, enabled and stable
    - element is visible, enabled and stable
    - scrolling into view if needed
    - done scrolling
    - <div class="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Created</div> from <div class="space-y-6 lg:sticky lg:top-[160px]">…</div> subtree intercepts pointer events
  - retrying click action
    - waiting 500ms
    - waiting for element to be visible, enabled and stable
    - element is visible, enabled and stable
    - scrolling into view if needed
    - done scrolling
    - <div class="p-6 space-y-4 pt-4">…</div> from <div class="space-y-6 lg:sticky lg:top-[160px]">…</div> subtree intercepts pointer events
  - retrying click action
    - waiting 500ms

```

# Test source

```ts
  52  |   await theme.selectOption("dark");
  53  |   await expect(page.locator("html")).toHaveAttribute("data-appearance", "dark");
  54  |   await page.reload();
  55  |   await expect(page.locator("html")).toHaveAttribute("data-appearance", "dark");
  56  |   await theme.selectOption("system");
  57  |   await page.emulateMedia({ colorScheme: "dark" });
  58  |   await expect(page.locator("html")).toHaveAttribute("data-appearance", "dark");
  59  |   await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  60  |   await expect(page.locator("html")).toHaveAttribute("data-appearance", "light");
  61  |   await open(page, "/dashboard");
  62  |   const reducedMotion = await page.evaluate(() => ({
  63  |     active: matchMedia("(prefers-reduced-motion: reduce)").matches,
  64  |     duration: getComputedStyle(document.querySelector(".skeleton-shimmer") ?? document.body).animationDuration,
  65  |   }));
  66  |   expect(reducedMotion.active).toBe(true);
  67  |   expect(reducedMotion.duration).toBe("0s");
  68  |   await shot(page, "journey-settings-system-reduced-motion");
  69  |   await open(page, "/settings");
  70  |   await theme.selectOption("dark");
  71  |   await page.getByRole("button", { name: "Sign Out", exact: true }).first().click();
  72  |   await expect(page.getByRole("button", { name: "Sign Out" })).toHaveCount(0);
  73  |   await sandbox.login(page, "rep");
  74  |   await open(page, "/settings");
  75  |   await expect(page.getByLabel("Appearance theme")).toHaveValue("light");
  76  |   await expect(page.locator("html")).toHaveAttribute("data-appearance", "light");
  77  |   await page.getByLabel("Appearance theme").selectOption("light");
  78  |   await page.getByRole("button", { name: "Sign Out", exact: true }).first().click();
  79  |   await page.goto(`${sandbox.url}/apply`);
  80  |   await expect(page.locator("html")).toHaveAttribute("data-appearance", "light");
  81  |   await sandbox.login(page, "admin");
  82  |   await open(page, "/settings");
  83  |   await expect(page.getByLabel("Appearance theme")).toHaveValue("dark");
  84  | });
  85  | 
  86  | test("journey: existing call-forwarding profile saves through UI and persists", async ({ page }) => {
  87  |   await open(page, "/settings");
  88  |   await page.getByRole("button", { name: "Add number" }).click();
  89  |   const phone = page.getByPlaceholder("+1 (555) 000-0000");
  90  |   await phone.fill("+12025550987");
  91  |   await page.getByRole("button", { name: "Save", exact: true }).click();
  92  |   await expect(page.getByText("+12025550987")).toBeVisible();
  93  |   const row = json("SELECT to_jsonb(u)::text FROM users u WHERE email='fixture-admin@example.invalid'");
  94  |   expect(row.mobile_number).toBe("+12025550987");
  95  | });
  96  | 
  97  | test("journey: create lead in UI and Run Match with DB-backed results", async ({ page }) => {
  98  |   await open(page, "/leads/new");
  99  |   await page.getByLabel(/First name/).fill("Journey");
  100 |   await page.getByLabel(/Last name/).fill("Fixture");
  101 |   await page.getByLabel("Email address").fill(`journey-${unique}@example.invalid`);
  102 |   await page.getByLabel("Phone number").fill("+12025550801");
  103 |   await page.getByLabel("Company name").fill("Journey Test LLC");
  104 |   await page.getByRole("button", { name: "Create Lead", exact: true }).click();
  105 |   await expect(page).toHaveURL(/\/leads\/\d+/);
  106 |   const lead = json(`SELECT to_jsonb(l)::text FROM leads l WHERE email='journey-${unique}@example.invalid'`);
  107 |   expect(lead.company_name).toBe("Journey Test LLC");
  108 |   await page.getByRole("tab", { name: /Lenders/ }).click();
  109 |   await page.getByRole("button", { name: "Run Match" }).click();
  110 |   await expect(page.getByText("Visual Fixture Match Partner")).toBeVisible({ timeout: 20_000 });
  111 |   const matches = json(`SELECT COALESCE(json_agg(to_jsonb(m)), '[]'::json)::text FROM lender_matches m WHERE lead_id=${lead.id}`);
  112 |   expect(matches.length).toBeGreaterThan(0);
  113 |   await shot(page, "journey-lead-match-results");
  114 | });
  115 | 
  116 | test("journey: public application submit persists application, lead and typed signature", async ({ page }) => {
  117 |   await open(page, "/apply");
  118 |   await page.getByRole("button", { name: /Equipment Financing/ }).click();
  119 |   await page.getByRole("button", { name: "Next" }).click();
  120 |   await page.getByPlaceholder("ABC LLC").fill(`Public Journey ${unique} LLC`);
  121 |   await page.getByPlaceholder("you@business.com").fill(`apply-${unique}@example.invalid`);
  122 |   await page.getByPlaceholder("(555) 000-0000").fill("+12025550802");
  123 |   await page.getByPlaceholder("e.g. 2024 Ford F-250 Work Truck").fill("Synthetic test forklift");
  124 |   await choose(page, page.getByText("Industry *", { exact: true }).locator("..").getByRole("combobox"), "Retail");
  125 |   await choose(page, page.getByText("Time in Business *", { exact: true }).locator("..").getByRole("combobox"), "4+ years");
  126 |   await page.getByPlaceholder("1000000").fill("100000");
  127 |   await choose(page, page.getByText("Requested Amount *", { exact: true }).locator("..").getByRole("combobox"), "$15,000 – $50,000");
  128 |   await page.getByRole("button", { name: "Next" }).click();
  129 |   await page.getByText("First Name *").locator("xpath=..").locator("input").fill("Synthetic");
  130 |   await page.getByText("Last Name *").locator("xpath=..").locator("input").fill("Applicant");
  131 |   await page.getByPlaceholder("XXX-XX-XXXX").fill("900-12-3456");
  132 |   await page.getByRole("button", { name: "Next" }).click();
  133 |   await page.getByRole("button", { name: "Skip this step" }).click();
  134 |   await page.getByRole("button", { name: "Next" }).click();
  135 |   await page.locator("#consent_credit").click();
  136 |   await page.locator("#consent_terms").click();
  137 |   await page.getByRole("button", { name: "Type", exact: true }).click();
  138 |   await page.getByPlaceholder("Type your full legal name").fill("Synthetic Applicant");
  139 |   await page.getByRole("button", { name: "Submit Application" }).click();
  140 |   await expect(page.getByRole("heading", { name: "Application Submitted!" })).toBeVisible({ timeout: 20_000 });
  141 |   const application = json(`SELECT to_jsonb(a)::text FROM applications a WHERE business_name='Public Journey ${unique} LLC'`);
  142 |   expect(application.signature_data).toBe("Synthetic Applicant");
  143 |   const lead = json(`SELECT to_jsonb(l)::text FROM leads l WHERE email='apply-${unique}@example.invalid'`);
  144 |   expect(application.lead_id).toBe(lead.id);
  145 |   await shot(page, "journey-public-application-confirmation");
  146 | });
  147 | 
  148 | test("journey: Log partner submission persists an actual manual submission", async ({ page }) => {
  149 |   const partner = json("SELECT to_jsonb(l)::text FROM lenders l WHERE name='Visual Fixture Match Partner'");
  150 |   await open(page, "/leads/1");
  151 |   await page.getByRole("tab", { name: /Docs/ }).click();
> 152 |   await page.getByRole("button", { name: "Log submission" }).click();
      |                                                              ^ Error: locator.click: Test timeout of 90000ms exceeded.
  153 |   await page.getByRole("button", { name: "Partner", exact: true }).click();
  154 |   await page.getByRole("option", { name: /^Visual Fixture Match Partner/ }).click();
  155 |   await page.getByRole("dialog").locator('input:not([type="date"]):not([type="file"])').fill(`Manual journey ${unique}`);
  156 |   const saved = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/submissions/manual") && response.request().method() === "POST" && response.ok());
  157 |   await page.getByRole("button", { name: "Save submission" }).click();
  158 |   await saved;
  159 |   await expect(page.getByText("Visual Fixture Match Partner").first()).toBeVisible();
  160 |   const row = json(`SELECT to_jsonb(s)::text FROM lender_submissions s WHERE lead_id=1 AND lender_id=${partner.id} AND source='manual' AND notes='Manual journey ${unique}'`);
  161 |   expect(row.status).toBe("submitted");
  162 |   await shot(page, "journey-manual-partner-submission");
  163 | });
  164 | 
  165 | test("journey: normal lead-document multipart upload persists DB metadata and local provider bytes", async ({ page }) => {
  166 |   await open(page, "/leads/1");
  167 |   await page.getByRole("tab", { name: /Docs/ }).click();
  168 |   const payload = Buffer.from("%PDF-1.4\nSynthetic local document fixture\n%%EOF\n");
  169 |   const filename = `journey-${unique}.pdf`;
  170 |   await page.locator('input[type="file"]').first().setInputFiles({ name: filename, mimeType: "application/pdf", buffer: payload });
  171 |   const uploadResponse = page.waitForResponse(response =>
  172 |     new URL(response.url()).pathname === "/api/leads/1/documents" && response.request().method() === "POST",
  173 |   );
  174 |   await page.getByRole("tabpanel").getByRole("button", { name: "Upload", exact: true }).click();
  175 |   expect((await uploadResponse).status()).toBe(201);
  176 |   await expect(page.getByText(filename)).toBeVisible();
  177 |   const document = json(`SELECT to_jsonb(d)::text FROM documents d WHERE lead_id=1 AND filename='${filename}'`);
  178 |   expect(document.file_size).toBe(payload.length);
  179 |   const files = await fixtureFiles(sandbox.storageDirectory);
  180 |   const { readFile } = await import("node:fs/promises");
  181 |   const storedBytes = await Promise.all(files.filter(file => !file.endsWith(".metadata.json")).map(file => readFile(file)));
  182 |   expect(storedBytes.some(file => file.equals(payload))).toBe(true);
  183 |   await shot(page, "journey-lead-document-uploaded");
  184 | });
  185 | 
  186 | test("journey: create campaign, preview and approve via UI/API/DB without launching", async ({ page }) => {
  187 |   await open(page, "/campaigns");
  188 |   await page.getByTestId("button-create-campaign").click();
  189 |   await page.getByLabel("Campaign Name").fill(`Synthetic Campaign ${unique}`);
  190 |   await page.getByRole("button", { name: "Create Campaign" }).click();
  191 |   await page.getByRole("heading", { name: `Synthetic Campaign ${unique}` }).waitFor();
  192 |   await page.getByRole("button", { name: "Select a template", exact: true }).click();
  193 |   await page.getByRole("option", { name: "Visual Refresh Synthetic Template", exact: true }).click();
  194 |   await page.getByRole("button", { name: "Save Changes" }).click();
  195 |   await expect(page.getByRole("button", { name: "Save Changes" })).toBeDisabled();
  196 |   await page.getByRole("tab", { name: "Review" }).click();
  197 |   const previewResponse = page.waitForResponse(response =>
  198 |     new URL(response.url()).pathname.endsWith("/preview") && response.status() === 200,
  199 |   );
  200 |   await page.getByRole("button", { name: "Calculate", exact: true }).click();
  201 |   await previewResponse;
  202 |   await expect(page.getByText(/eligible/i).first()).toBeVisible();
  203 |   const preview = json(`SELECT to_jsonb(p)::text FROM campaign_audience_previews p JOIN campaigns c ON c.id=p.campaign_id WHERE c.name='Synthetic Campaign ${unique}' ORDER BY p.id DESC LIMIT 1`);
  204 |   expect(preview.counts.eligible).toBeGreaterThan(0);
  205 |   await page.getByRole("checkbox", { name: /I affirm this campaign meets all compliance requirements/ }).check();
  206 |   await page.getByRole("button", { name: "Approve and continue to launch" }).click();
  207 |   await expect(page.getByText("APPROVED")).toBeVisible();
  208 |   const campaign = json(`SELECT to_jsonb(c)::text FROM campaigns c WHERE name='Synthetic Campaign ${unique}'`);
  209 |   expect(campaign.status).toBe("approved");
  210 |   const approval = json(`SELECT to_jsonb(a)::text FROM campaign_approvals a WHERE campaign_id=${campaign.id} ORDER BY id DESC LIMIT 1`);
  211 |   expect(approval.claims_affirmed).toBe(true);
  212 |   const launches = Number(db(`SELECT count(*) FROM campaign_launches WHERE campaign_id=${campaign.id}`));
  213 |   expect(launches).toBe(0);
  214 |   await shot(page, "journey-campaign-approved-not-launched");
  215 | });
  216 | 
  217 | test("journey: softphone opens idle without a dial or call request", async ({ page }) => {
  218 |   const callRequests: string[] = [];
  219 |   page.on("request", request => { if (/\/api\/.*(?:twilio\/call|voice\/call)/i.test(request.url())) callRequests.push(request.method()); });
  220 |   await open(page, "/leads");
  221 |   await page.locator('button[title="Open softphone"]').click();
  222 |   await expect(page.locator('[role="dialog"],[role="complementary"]').filter({ hasText: /softphone|call/i }).first()).toBeVisible();
  223 |   expect(callRequests).toEqual([]);
  224 |   await shot(page, "journey-softphone-open-idle");
  225 | });
  226 | 
  227 | test("journey: mobile dialog close target and rich editor keyboard focus", async ({ page }) => {
  228 |   await page.setViewportSize({ width: 390, height: 844 });
  229 |   await open(page, "/email/templates");
  230 |   await page.getByRole("button", { name: "New Template" }).click();
  231 |   const editor = page.locator('[contenteditable="true"]').first();
  232 |   await expect(editor).toBeVisible();
  233 |   await editor.focus();
  234 |   await expect(editor).toBeFocused();
  235 |   await page.keyboard.type("Synthetic keyboard editor check");
  236 |   await expect(editor).toContainText("Synthetic keyboard editor check");
  237 |   await page.keyboard.press("Tab");
  238 |   await expect(page.locator(":focus")).toBeVisible();
  239 |   const close = page.getByRole("button", { name: /close/i }).last();
  240 |   const box = await close.boundingBox();
  241 |   expect(box?.width).toBeGreaterThanOrEqual(44);
  242 |   expect(box?.height).toBeGreaterThanOrEqual(44);
  243 |   await page.keyboard.press("Escape");
  244 |   await expect(editor).toBeHidden();
  245 | });
  246 | 
  247 | test("visual-only floating surfaces: themed dialog/popover/toast and glass policy", async ({ page }) => {
  248 |   await page.setViewportSize({ width: 390, height: 844 });
  249 |   await open(page, "/settings");
  250 |   const theme = page.getByLabel("Appearance theme");
  251 |   await theme.selectOption("light");
  252 |   await open(page, "/campaigns");
```