import { mkdir, writeFile, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
import { chromium } from "@playwright/test";
import { startSandbox } from "../visual-refresh/sandbox.mjs";

const root = resolve(import.meta.dirname, "../..");
const out = join(root, "reports/table-readability");
await mkdir(out, { recursive: true });
const result = { verdict: "pass", scope: "isolated schema-only synthetic fixture", checks: {}, audit: {}, screenshots: [], failures: [] };
let fixture, browser, stage = "start sandbox", currentCheck = "setup";
const recordSpecs = [
  ["Ari", "One", "ari.one@northstar.example", "Northstar Industrial Equipment and Services Corporation"],
  ["Beatrice", "LongSurname-Westfield", "beatrice.elongated.contact@precision.example", "Precision Fabrication and Logistics Group"],
  ["Cameron", "Three", `${"l".repeat(64)}@long-local.example`, "Evergreen Agricultural Processing and Distribution Holdings"],
  ["Drew", "Four", "drew.four@regional.example", "Regional Commercial Construction and Fleet Maintenance"],
  ["Elena", "Five", "elena.with.a.longer.contact.address@solutions.example", "Solutions for Advanced Manufacturing and Supply Chain"],
  ["Finley", "Six", "finley.six@representative.example", "Representative Business Name with Several Long Words"],
];

function assert(ok, message, details = {}) {
  if (!ok) {
    result.verdict = "fail";
    result.failures ??= [];
    result.failures.push({ check: currentCheck, message, ...details });
  }
}
async function capture(name, page, fullPage = true) {
  const file = join(out, name);
  await page.screenshot({ path: file, fullPage });
  result.screenshots.push(file.replace(root + "/", ""));
}
async function metrics(page) {
  return page.evaluate(() => ({
    viewport: innerWidth, docWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    table: (() => {
      const t = document.querySelector("table.leads-data-table, table.deals-data-table");
      if (!t) return null;
      const wrap = t.closest(".overflow-x-auto, .overflow-auto");
      const links = [...t.querySelectorAll('[data-contact-link="email"]')].filter(a => a.getClientRects().length > 0).map(a => {
        const span = a.querySelector("span");
        const text = span?.firstChild;
        const range = document.createRange();
        if (text) range.selectNodeContents(span);
        const rects = text ? [...range.getClientRects()] : [];
        const cs = getComputedStyle(span ?? a);
        return {
          text: span?.textContent ?? "", href: a.getAttribute("href"),
          lines: rects.length, lineHeight: cs.lineHeight, fontSize: cs.fontSize,
          whiteSpace: cs.whiteSpace, wordBreak: cs.wordBreak, overflowWrap: cs.overflowWrap,
          linkRect: a.getBoundingClientRect().toJSON(), spanRect: span?.getBoundingClientRect().toJSON(),
          cellRect: a.closest("td")?.getBoundingClientRect().toJSON(),
          clipped: !!span && (span.scrollWidth > span.clientWidth + 1 || span.scrollHeight > span.clientHeight + 2),
        };
      });
      return {
        className: t.className, width: t.getBoundingClientRect().width,
        headerCount: t.querySelectorAll("thead th").length,
        wrapperClientWidth: wrap?.clientWidth, wrapperScrollWidth: wrap?.scrollWidth,
        wrapperOverflowX: wrap && getComputedStyle(wrap).overflowX,
        rowHeights: [...t.querySelectorAll("tbody tr")].map(r => Math.round(r.getBoundingClientRect().height)),
        lastHeader: t.querySelector("thead th:last-child")?.innerText,
        lastHeaderRect: t.querySelector("thead th:last-child")?.getBoundingClientRect().toJSON(),
        emails: links,
      };
    })(),
  }));
}
async function staticAudit() {
  const healthSource = await readFile(join(root, "artifacts/mbs-crm/src/pages/system-health.tsx"), "utf8");
  const healthCell = healthSource.match(/<TableCell className="hidden lg:table-cell min-w-40 max-w-56 break-all font-mono text-xs text-muted-foreground">[\s\S]*?requestId/);
  const globalCss = await readFile(join(root, "artifacts/mbs-crm/src/index.css"), "utf8");
  result.audit.systemHealthRequestId = {
    renderedWithSyntheticError: false,
    codeCheck: !!healthCell && healthCell[0].includes("requestId"),
    assessment: "CSS/source only; fixture has no safe synthetic error row",
    rule: healthCell?.[0].match(/className="([^"]+)/)?.[1] ?? null,
    minWidthPx: 160,
  };
  result.audit.sharedTableEmailRule =
    globalCss.includes('table [data-contact-link="email"] { white-space: nowrap; flex-shrink: 0; }') &&
    globalCss.includes('table [data-contact-link="email"] > span { word-break: normal; overflow-wrap: normal; }');
  result.audit.scope = "Source-only scan of other native/shared break-all fields; no unrelated routes exercised or changed.";
  result.audit.breakAllFindings = execFileSync("rg", [
    "-n", "break-all|word-break: *break-all",
    "artifacts/mbs-crm/src/pages", "artifacts/mbs-crm/src/components",
  ], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean);
}
await staticAudit();
try {
  fixture = await startSandbox({ build: false, port: 4360 });
  stage = "launch browser";
  browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", headless: true });
  stage = "create context and authenticate";
  const context = await browser.newContext({ viewport: { width: 1024, height: 900 }, deviceScaleFactor: 1 });
  await context.addInitScript(() => {
    if (location.pathname === "/sign-in" && !sessionStorage.getItem("table-fixture-clean")) {
      localStorage.clear();
      sessionStorage.setItem("table-fixture-clean", "1");
    }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  await fixture.login(page, "admin");

  stage = "seed synthetic leads and deals";
  const seeded = await page.evaluate(async specs => {
    const leads = [];
    for (const [i, [firstName, lastName, email, companyName]] of specs.entries()) {
      const response = await fetch("/api/leads", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          firstName, lastName, email, phone: `+120255506${String(i + 1).padStart(2, "0")}`,
          companyName, applicationType: i % 2 ? "working_capital" : "equipment",
          requestedAmount: 50000 + i * 7500, leadSource: "manual",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(`Synthetic lead insert rejected (${response.status}): ${JSON.stringify(data)}`);
      leads.push(data);
    }
    const deals = [];
    for (const [i, lead] of leads.entries()) {
      const response = await fetch("/api/deals", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          leadId: lead.id, dealName: `Readable fixture deal ${i + 1}`,
          stage: ["waiting_on_app", "submitted", "approved", "information_needed", "in_funding", "hold_on"][i],
          amount: 50000 + i * 7500, approxGm: 2500 + i * 250,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(`Synthetic deal insert rejected (${response.status}): ${JSON.stringify(data)}`);
      deals.push(data);
    }
    return { leads: leads.map(({ id, email }) => ({ id, email })), deals: deals.length };
  }, recordSpecs);
  result.fixture = { leadCount: seeded.leads.length, dealCount: seeded.deals, emails: seeded.leads.map(x => x.email) };

  stage = "render Leads table";
  await page.goto(`${fixture.url}/leads`);
  await page.locator("table.leads-data-table tbody tr").first().waitFor();
  const desktopWidths = [768, 1024, 1280, 1440];
  for (const width of desktopWidths) {
    currentCheck = `leads_${width}`;
    await page.setViewportSize({ width, height: 900 });
    if (width === 1440 && await page.getByRole("button", { name: "Pin sidebar open" }).count()) {
      const pin = page.getByRole("button", { name: "Pin sidebar open" });
      if (await pin.getAttribute("aria-pressed") !== "true") await pin.click();
    }
    const m = await metrics(page);
    const emailRows = m.table?.emails ?? [];
    assert(m.docWidth <= width + 1 && m.bodyWidth <= width + 1, `Leads document overflow at ${width}px`, { m });
    assert(m.table?.wrapperScrollWidth > m.table?.wrapperClientWidth, `Leads wrapper should horizontally scroll at ${width}px`, { m });
    assert(m.table?.headerCount === 13, `Expected all 13 Leads columns at ${width}px`, { headerCount: m.table?.headerCount });
    assert(emailRows.length >= 6, `Expected six visible fixture emails at ${width}px`, { count: emailRows.length });
    assert(emailRows.every(e => e.lines === 1 && e.whiteSpace === "nowrap" && e.wordBreak === "normal" && e.overflowWrap === "normal"), `Lead table email wrapping styles/line boxes incorrect at ${width}px`, { emails: emailRows });
    assert(!emailRows.some(e => e.clipped), `Lead table email clipping at ${width}px`, { emails: emailRows.filter(e => e.clipped) });
    assert(m.table.rowHeights.every(h => h < 160), `Pathological lead row height at ${width}px`, { rowHeights: m.table.rowHeights });
    if (width === 1024) await capture("leads-1024.png", page);
    if (width === 1440) await capture("leads-1440-pinned.png", page);
    const reachState = await page.locator("table.leads-data-table").evaluate(async t => {
      const wrap = t.closest(".overflow-x-auto, .overflow-auto");
      if (wrap) wrap.scrollLeft = wrap.scrollWidth;
      await new Promise(requestAnimationFrame);
      const header = t.querySelector("thead th:last-child");
      const h = header?.getBoundingClientRect(), w = wrap?.getBoundingClientRect();
      return {
        scrollLeft: wrap?.scrollLeft, scrollWidth: wrap?.scrollWidth, clientWidth: wrap?.clientWidth,
        wrapperRect: w?.toJSON(), headerRect: h?.toJSON(),
        headerReachable: !!h && !!w && h.right <= w.right + 1 && h.left >= w.left - 1,
      };
    });
    const reachable = reachState.headerReachable;
    assert(reachable, `Rightmost Leads column not reachable via wrapper scroll at ${width}px`);
    await page.locator("table.leads-data-table").evaluate(t => {
      const wrap = t.closest(".overflow-x-auto, .overflow-auto");
      if (wrap) wrap.scrollLeft = 0;
    });
    result.checks[currentCheck] = { pass: !result.failures?.some(f => f.check === currentCheck), ...m, rightmostColumnReachable: reachable, reachState };
  }

  stage = "verify lead email composer link";
  currentCheck = "emailComposerLink";
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto(`${fixture.url}/leads`);
  const longEmail = recordSpecs[2][2];
  const longAnchor = page.locator('table.leads-data-table [data-contact-link="email"]').filter({ hasText: longEmail }).first();
  const targetHref = await longAnchor.getAttribute("href");
  assert(targetHref?.includes("/leads/") && targetHref.includes("compose=email"), "Lead email does not point to CRM composer", { targetHref });
  assert((await longAnchor.getAttribute("aria-label")) === `Email ${longEmail}`, "Lead email does not expose full accessible label", { ariaLabel: await longAnchor.getAttribute("aria-label") });
  await longAnchor.click();
  await page.waitForURL(/compose=email/);
  result.checks.emailComposerLink = { pass: !result.failures?.some(f => f.check === currentCheck) && page.url().includes("compose=email"), targetHref, currentUrl: page.url(), sendInvoked: false };

  stage = "render Deals list at 1024px";
  currentCheck = "deals_list_1024";
  await page.goto(`${fixture.url}/deals`);
  await page.locator("button:has(svg.lucide-list)").click();
  await page.locator("table.deals-data-table").waitFor({ state: "visible" });
  await page.locator("table.deals-data-table tbody tr").first().waitFor();
  const dealModeState = await page.evaluate(() => ({
    visibleBoard: !!document.querySelector('[data-testid="deals-board-desktop"]') &&
      document.querySelector('[data-testid="deals-board-desktop"]').getBoundingClientRect().width > 0,
    table: (() => { const t = document.querySelector("table.deals-data-table"); return { visible: !!t && t.getBoundingClientRect().width > 0, className: t?.className }; })(),
    viewButton: [...document.querySelectorAll("button")].filter(b => b.querySelector("svg.lucide-list")).map(b => ({ text: b.innerText, className: b.className })),
  }));
  result.checks.dealsViewMode = dealModeState;
  assert(!dealModeState.visibleBoard && dealModeState.table.visible, "Deals List mode did not replace desktop board", { dealModeState });
  const deals1024 = await metrics(page);
  assert(deals1024.docWidth <= 1025 && deals1024.bodyWidth <= 1025, "Deals list document overflow at 1024px", { deals1024 });
  assert(deals1024.table.emails.length >= 6, "Deals list missing fixture email links", { count: deals1024.table.emails.length });
  assert(deals1024.table.emails.every(e => e.lines === 1 && e.whiteSpace === "nowrap" && e.wordBreak === "normal" && e.overflowWrap === "normal"), "Deals list email wrapping styles/line boxes incorrect", { emails: deals1024.table.emails });
  assert(!deals1024.table.emails.some(e => e.clipped), "Deals list email clipping", { emails: deals1024.table.emails.filter(e => e.clipped) });
  assert(deals1024.table.rowHeights.every(h => h < 160), "Pathological Deals list row height", { rowHeights: deals1024.table.rowHeights });
  assert(deals1024.table.wrapperScrollWidth > deals1024.table.wrapperClientWidth, "Deals table wrapper does not horizontally scroll at 1024px");
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await capture("deals-list-1024-final.png", page, false);
  result.checks[currentCheck] = { pass: !result.failures?.some(f => f.check === currentCheck), ...deals1024 };

  stage = "verify desktop Deals board wrapping and containment";
  currentCheck = "deals_board_1024";
  await page.getByRole("button", { name: "Kanban", exact: true }).click();
  await page.locator('[data-testid="deals-board-desktop"]').waitFor();
  const board = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="deals-board-desktop"]');
    const anchor = [...(root?.querySelectorAll('[data-contact-link="email"]') ?? [])].find(a => a.textContent?.includes(`${"l".repeat(64)}@long-local.example`));
    const span = anchor?.querySelector("span");
    const range = document.createRange(); if (span) range.selectNodeContents(span);
    const styles = span ? getComputedStyle(span) : null;
    return {
      documentWidth: document.documentElement.scrollWidth, viewport: innerWidth,
      boardRect: root?.getBoundingClientRect().toJSON(), boardOverflowX: root && getComputedStyle(root).overflowX,
      emailLines: span ? range.getClientRects().length : 0,
      whiteSpace: styles?.whiteSpace, wordBreak: styles?.wordBreak, overflowWrap: styles?.overflowWrap,
      emailRect: span?.getBoundingClientRect().toJSON(),
      emailContained: !!span && span.getBoundingClientRect().left >= root.getBoundingClientRect().left &&
        span.getBoundingClientRect().right <= root.getBoundingClientRect().right,
    };
  });
  assert(board.documentWidth <= board.viewport + 1, "Desktop Deals board causes document overflow", { board });
  assert(board.emailLines > 1 && board.whiteSpace === "normal", "Deals board no longer wraps full email within card", { board });
  assert(board.emailContained, "Deals board email escapes board bounds", { board });
  result.checks[currentCheck] = { pass: !result.failures?.some(f => f.check === currentCheck), ...board };

  stage = "verify Leads mobile cards at 390px";
  currentCheck = "leads_mobile_390";
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${fixture.url}/leads`);
  await page.locator('[data-contact-link="email"]').first().waitFor();
  const mobileLead = await page.evaluate(email => {
    const anchor = [...document.querySelectorAll('[data-contact-link="email"]')].find(a => a.textContent?.includes(email));
    const span = anchor?.querySelector("span");
    const range = document.createRange(); if (span) range.selectNodeContents(span);
    return {
      viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth,
      cardVisible: !!anchor?.closest(".md\\:hidden"), emailText: span?.textContent,
      emailLines: span ? range.getClientRects().length : 0,
      controls: [...document.querySelectorAll("button")].filter(b => b.getClientRects().length).map(b => (b.innerText || b.getAttribute("aria-label") || "").trim()).filter(Boolean),
    };
  }, longEmail);
  assert(mobileLead.documentWidth <= 391 && mobileLead.bodyWidth <= 391, "Leads mobile page overflows at 390px", { mobileLead });
  assert(mobileLead.emailText === longEmail && mobileLead.emailLines > 1, "Long lead contact email does not wrap in mobile card", { mobileLead });
  assert(mobileLead.controls.length > 0, "Lead mobile controls disappeared", { mobileLead });
  await capture("leads-mobile-390.png", page);
  result.checks[currentCheck] = { pass: !result.failures?.some(f => f.check === currentCheck), ...mobileLead };

  stage = "verify Deals mobile list fallback at 390px";
  currentCheck = "deals_mobile_390";
  await page.goto(`${fixture.url}/deals`);
  await page.locator("button:has(svg.lucide-list)").click();
  await page.locator("table.deals-data-table tbody tr").first().waitFor();
  const mobileDeals = await page.evaluate(email => {
    const anchor = [...document.querySelectorAll("table.deals-data-table [data-contact-link=email]")].find(a => a.textContent?.includes(email));
    const span = anchor?.querySelector("span");
    const range = document.createRange(); if (span) range.selectNodeContents(span);
    return {
      viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth,
      emailText: span?.textContent, emailLines: span ? range.getClientRects().length : 0,
      visible: !!anchor && anchor.getClientRects().length > 0,
      mobileInline: !!anchor?.closest("td")?.querySelector(".md\\:hidden"),
    };
  }, longEmail);
  assert(mobileDeals.documentWidth <= 391 && mobileDeals.bodyWidth <= 391, "Deals mobile fallback causes document overflow", { mobileDeals });
  assert(mobileDeals.visible && mobileDeals.emailText === longEmail, "Deals mobile list fallback does not show contact email", { mobileDeals });
  assert(mobileDeals.emailLines > 1, "Deals mobile fallback email does not wrap", { mobileDeals });
  result.checks[currentCheck] = { pass: !result.failures?.some(f => f.check === currentCheck), ...mobileDeals };

  assert(result.audit.systemHealthRequestId.codeCheck, "System Health requestId min-width 160 CSS/source check missing");
  await writeFile(join(out, "results.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ verdict: result.verdict, screenshots: result.screenshots, failures: result.failures ?? [], audit: result.audit }, null, 2));
} catch (error) {
  const environmentBlocker = stage === "start sandbox" || stage === "launch browser" || stage === "create context and authenticate";
  result.verdict = environmentBlocker && result.verdict !== "fail" ? "unable" : "fail";
  result.checks[currentCheck] = { status: "failed", stage, error: error.message };
  result.failures ??= [];
  result.failures.push({ check: currentCheck, stage, classification: result.verdict, message: error.message, stack: error.stack });
  await writeFile(join(out, "results.json"), JSON.stringify(result, null, 2) + "\n");
  console.error(error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (fixture) await fixture.close();
}