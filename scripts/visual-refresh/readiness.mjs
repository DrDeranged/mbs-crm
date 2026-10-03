export async function waitForPage(page, name) {
  const headings = {
    dashboard: "Dashboard", leads: "Leads", "lead-detail": "Fixture Equipment LLC",
    pipeline: "Deals", settings: "Settings", campaigns: "Campaigns", documents: "Documents",
  };
  if (headings[name]) await page.locator("h1").filter({ hasText: headings[name] }).first().waitFor({ timeout: 30000 });
  await page.waitForLoadState("networkidle");
  // Auth resolves before route queries. Wait for the existing loading slots,
  // not just networkidle on the initial HTML/Clerk request.
  await page.waitForFunction(() => ![...document.querySelectorAll(".animate-pulse,.skeleton-shimmer")].some(el => {
    const rect = el.getBoundingClientRect();
    return rect.width && rect.height;
  }), { timeout: 30000 });
  let previous = "", stable = 0;
  for (let attempt = 0; attempt < 30; attempt++) {
    const current = await page.locator("button,a,input,select,textarea").evaluateAll(elements =>
      JSON.stringify(elements.map(el => [el.tagName, el.textContent?.trim(), el.hasAttribute("disabled")])));
    stable = current === previous ? stable + 1 : 0;
    if (stable >= 3) return;
    previous = current;
    await page.waitForTimeout(300);
  }
  throw new Error(`Control inventory did not stabilize: ${name}`);
}