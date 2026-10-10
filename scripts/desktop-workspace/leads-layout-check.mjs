import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { chromium } from "@playwright/test";
import { startSandbox } from "../visual-refresh/sandbox.mjs";

const root = resolve(import.meta.dirname, "../..");
const phase = process.argv[2] ?? "after";
const before = phase === "before";
const output = join(root, "reports/leads-layout", phase);
await mkdir(output, { recursive: true });
const resume = !before && process.env.LEADS_LAYOUT_RESUME === "1";
const contactsOnly = !before && process.env.LEADS_LAYOUT_CONTACTS_ONLY === "1";
const prior = resume ? JSON.parse(await readFile(join(output, "results.json"), "utf8")) : null;
if (prior) await writeFile(join(output, `prior-check-${Date.now()}.json`), JSON.stringify(prior, null, 2));
const report = { phase, cases: prior?.cases ?? [], flows: [], failures: [], httpErrors: [], directoryRequestsByRole: contactsOnly ? { ...prior?.directoryRequestsByRole } : {}, cleanup: null };
const check = (ok, label) => { if (!ok) report.failures.push(label); };
const sizes = [390, 768, 960, 1023, 1024, 1280, 1440];
let fixture, browser;

async function geometry(page) {
  return page.evaluate(() => {
    const box = el => el?.getBoundingClientRect().toJSON();
    const region = document.querySelector(".leads-fit-region");
    const heads = [...document.querySelectorAll(".leads-fit-table th")];
    const content = document.querySelector("[data-desktop-content]");
    const footer = document.querySelector(".leads-fit-footer");
    const bulk = document.querySelector(".leads-fit-bulk-slot");
    const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== "hidden";
    return {
      desktop: !!region, documentWidth: document.documentElement.scrollWidth, viewport: { width: innerWidth, height: innerHeight },
      content: content && { clientHeight: content.clientHeight, scrollHeight: content.scrollHeight, clientWidth: content.clientWidth, scrollWidth: content.scrollWidth },
      region: region && { rect: box(region), clientHeight: region.clientHeight, scrollHeight: region.scrollHeight, clientWidth: region.clientWidth, scrollWidth: region.scrollWidth, scrollTop: region.scrollTop, gutter: box(region).width - region.clientWidth },
      header: heads.map(el => ({ rect: box(el), background: getComputedStyle(el).backgroundColor, text: el.textContent.trim() })),
      bulk: box(bulk), footer: box(footer),
      rows: document.querySelectorAll("[data-leads-row]").length,
      inventory: [...document.querySelectorAll("main a[href], main button, main input, main [role=combobox]")]
        .filter(visible).map(el => ({ tag: el.tagName, role: el.getAttribute("role"), name: el.getAttribute("aria-label") || el.textContent.trim(), href: el.getAttribute("href"), placeholder: el.getAttribute("placeholder") })),
    };
  });
}

async function ready(page) {
  await page.getByRole("heading", { name: "Leads", exact: true }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll("main a")].some(el => el.textContent.includes("Scroll Layout")));
  await page.waitForTimeout(180);
}

try {
  fixture = await startSandbox({
    build: false, port: before ? 4440 : 4442,
    webRoot: join(root, before ? ".local/leads-layout-baseline/public" : "artifacts/mbs-crm/dist/public"),
  });
  const repId = Number(fixture.query("SELECT id FROM users WHERE role = 'rep' ORDER BY id LIMIT 1"));
  const tuples = Array.from({ length: 90 }, (_, n) => {
    const i = n + 1;
    return `('Scrolling','Contact ${i}','layout${i}@fixture.example','+1202555${String(i).padStart(4, "0")}','Scroll Layout Industrial Equipment and Services Company ${i}','equipment','new_lead','manual',${repId})`;
  });
  fixture.seedFixture(`INSERT INTO leads (first_name,last_name,email,phone,company_name,application_type,status,lead_source,assigned_rep_id) VALUES ${tuples.join(",")} RETURNING id`);
  browser = await chromium.launch({
    executablePath: "/repl/tools/bin/chromium", headless: true,
    // Playwright otherwise hides the actual native scrollbar in headless mode.
    ignoreDefaultArgs: ["--hide-scrollbars"], args: ["--disable-features=OverlayScrollbar"],
  });
  for (const role of contactsOnly ? ["admin"] : ["admin", "manager", "rep"]) {
    report.directoryRequestsByRole[role] ??= 0;
    const context = await browser.newContext({ viewport: { width: 1024, height: 560 }, serviceWorkers: "block" });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("response", response => {
      const path = new URL(response.url()).pathname;
      if (path === "/api/users") report.directoryRequestsByRole[role]++;
      if ([403, 404, 503].includes(response.status()) && path.startsWith("/api/")) report.httpErrors.push({ role, path, status: response.status() });
    });
    await fixture.login(page, role);
    for (const width of sizes) {
      await page.setViewportSize({ width, height: 560 });
      for (const pinned of width >= 1024 ? [false, true] : [false]) {
        for (const theme of ["light", "dark"]) {
          const name = `${role}-${width}-${pinned ? "pinned" : "rail"}-${theme}`;
          if (report.cases.some(entry => entry.name === name)) continue;
          await page.goto(fixture.url + "/leads");
          await ready(page);
          if (width >= 1024) {
            const actual = await page.locator(".desktop-rail").getAttribute("data-pinned");
            if ((actual === "true") !== pinned) {
              await page.evaluate(() => document.activeElement?.blur?.());
              await page.keyboard.press("Control+b");
            }
            const toggle = page.getByRole("button", { name: `Switch to ${theme} mode`, exact: true });
            if (await toggle.count()) await toggle.click();
          } else {
            await page.evaluate(theme => localStorage.setItem("mbs-theme", theme), theme);
            await page.evaluate(theme => document.documentElement.classList.toggle("dark", theme === "dark"), theme);
          }
          await page.waitForTimeout(100);
          const metrics = await geometry(page);
          report.cases.push({ name, ...metrics });
          if (!before) {
            check(metrics.documentWidth <= width, `${name}: document horizontal overflow`);
            if (width >= 1024) {
              check(metrics.region.clientHeight >= 120, `${name}: unusably short records region`);
              check(!metrics.bulk, `${name}: empty bulk-action reservation`);
              check(metrics.content.scrollHeight <= metrics.content.clientHeight + 1, `${name}: outer vertical overflow`);
              check(metrics.content.scrollWidth <= metrics.content.clientWidth + 1, `${name}: outer horizontal overflow`);
              check(metrics.footer.bottom <= 561, `${name}: footer clipped`);
              check(metrics.header.every(h => !["rgba(0, 0, 0, 0)", "transparent"].includes(h.background)), `${name}: transparent sticky header`);
            }
          }
          if (role === "admin" && [390, 768, 1024, 1280, 1440].includes(width) && !pinned) {
            await page.screenshot({ path: join(output, name + ".png") });
          }
          if (width >= 1024) {
            await page.locator(".leads-fit-region").evaluate(el => { el.scrollTop = 95; });
            await page.waitForTimeout(70);
            const scrolled = await geometry(page);
            report.cases.at(-1).scrolledHeader = scrolled.header;
            if (!before) check(scrolled.header.every(h => Math.abs(h.rect.top - scrolled.region.rect.top - 1) < 2), `${name}: header does not stay at scroll-region top`);
            if (role === "admin" && width === 1024 && !pinned) await page.screenshot({ path: join(output, name + "-scrolled.png") });
          }
        }
      }
    }
    if (!before && role === "admin") {
      await page.setViewportSize({ width: 1024, height: 560 });
      await page.goto(fixture.url + "/leads"); await ready(page);
      const region = page.locator(".leads-fit-region");
      let loaded = { rows: prior?.flows?.find(flow => flow.role === "admin")?.loadedRows ?? 0 };
      if (!contactsOnly) {
      await region.focus(); await page.keyboard.press("End");
      await page.waitForFunction(() => document.querySelectorAll("[data-leads-row]").length > 50);
      loaded = await geometry(page);
      check(loaded.rows > 50, "continuous loading beyond 50");
      await region.focus(); await page.keyboard.press("Home");
      await page.waitForTimeout(250);
      check((await geometry(page)).region.scrollTop === 0, "keyboard Home reaches top");
      await page.mouse.move(700, 350); await page.mouse.wheel(0, 400); await page.waitForTimeout(250);
      check((await geometry(page)).region.scrollTop > 0, "wheel scrolls records");
      const bounds = await region.boundingBox();
      await region.evaluate(el => { el.scrollTop = 0; });
      await page.waitForTimeout(200);
      // Native Linux scrollbars have an up-arrow before the thumb.
      await page.screenshot({ path: join(output, "admin-1024-native-scrollbar.png") });
      await page.mouse.move(bounds.x + bounds.width - 7, bounds.y + 26);
      await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width - 7, bounds.y + bounds.height - 16, { steps: 15 }); await page.mouse.up();
      await page.waitForTimeout(200);
      check((await geometry(page)).region.scrollTop > 0, "scrollbar drag scrolls records");
      await region.evaluate(el => { el.scrollTop = 300; });
      await page.getByPlaceholder(/Search by name/).fill("Contact 60");
      await page.waitForFunction(() => document.querySelectorAll("[data-leads-row]").length === 1);
      check((await geometry(page)).region.scrollTop === 0, "search resets scrolling");
      await page.getByPlaceholder(/Search by name/).fill(""); await ready(page);
      await page.getByRole("button", { name: "Sort by last activity" }).click();
      await page.waitForTimeout(350);
      check((await geometry(page)).region.scrollTop === 0, "sorting resets scrolling");
      const unselected = (await geometry(page)).region.clientHeight;
      await page.locator("[data-leads-row]").first().getByRole("checkbox").click();
      const selected = await geometry(page);
      check(!!selected.bulk && selected.region.clientHeight < unselected, "bulk actions consume space only when selected");
      await page.getByRole("button", { name: "Clear", exact: true }).click();
      check(!(await geometry(page)).bulk, "clearing selection returns records space");
      await page.locator("[data-leads-row]").first().locator("td").last().click({ position: { x: 2, y: 2 } });
      check(/\/leads\/\d+$/.test(new URL(page.url()).pathname), "whole-row navigation");
      await page.goto(fixture.url + "/leads"); await ready(page);
      }
      for (const kind of ["phone", "email"]) {
        const target = region.locator(kind === "phone" ? 'a[href^="tel:"]' : '[data-contact-link="email"]').first();
        if (await target.count()) {
          await target.click();
          const destination = new URL(page.url());
          check(kind === "phone" ? destination.pathname === "/leads" : destination.searchParams.get("compose") === "email",
            `${kind} follows its contact action rather than ordinary row navigation`);
          const dialog = page.getByRole("dialog");
          if (await dialog.count()) await page.keyboard.press("Escape");
        } else check(false, `missing ${kind} contact link`);
      }
      // Email intentionally opens Lead Detail with ?compose=email. Resize the
      // actual list rather than mistaking that intended route for a missing list.
      await page.goto(fixture.url + "/leads"); await ready(page);
      for (const width of [1023, 1024, 960, 1280]) {
        await page.setViewportSize({ width, height: 560 }); await page.waitForTimeout(250);
        check((await geometry(page)).desktop === (width >= 1024), `breakpoint transition at ${width}`);
      }
      report.flows.push({ role, loadedRows: loaded.rows, checked: ["continuous loading", "Home/End", "wheel", "scrollbar drag", "search", "sort", "bulk", "row click", "contact boundaries", "breakpoint resizing"] });
    }
    await context.close();
  }
  if (!before) {
    const baseline = JSON.parse(await readFile(join(root, "reports/leads-layout/before/results.json"), "utf8"));
    for (const entry of report.cases.filter(c => c.viewport.width < 1024)) {
      const original = baseline.cases.find(c => c.name === entry.name);
      check(JSON.stringify(entry.inventory) === JSON.stringify(original?.inventory), `${entry.name}: mobile/tablet inventory changed`);
    }
    check(report.directoryRequestsByRole.rep === 0, "rep requested users directory");
    check(report.httpErrors.length === 0, "unexpected API 403/404/503");
  }
} catch (error) {
  report.failures.push(error.message.replace(/https?:\/\/\S+/g, "[URL]"));
} finally {
  await browser?.close();
  if (fixture) report.cleanup = await fixture.close();
  report.passed = report.failures.length === 0;
  await writeFile(join(output, "results.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ phase, cases: report.cases.length, flows: report.flows, failures: report.failures, httpErrors: report.httpErrors, directoryRequestsByRole: report.directoryRequestsByRole, cleanup: report.cleanup, passed: report.passed }, null, 2));
}
process.exit(report.passed ? 0 : 1);
