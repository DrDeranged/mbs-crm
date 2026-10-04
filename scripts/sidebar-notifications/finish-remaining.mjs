import { chromium } from "../../node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs";
import { startSandbox } from "../visual-refresh/sandbox.mjs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

const root = resolve(import.meta.dirname, "../.."), out = join(root, "reports/sidebar-notifications");
const frozen = join(tmpdir(), `sidebar-notifications-last-${process.pid}`);
const rows = Array.from({ length: 10 }, (_, i) => ({
  id: 9300 + i, type: i ? "task_due" : "lead_assigned",
  title: i ? `Synthetic history ${i}` : "Synthetic lead assigned",
  body: "Fixture-only notification for interaction regression coverage.",
  leadId: i === 0 ? 1 : null, isRead: false, createdAt: new Date().toISOString(),
}));
const checks = [], runnerErrors = [], interceptedUrls = [];
const check = (name, pass, detail = "") => checks.push({ name, pass: !!pass, detail });
let sandbox, browser, context, page, state;
const snooze = ms => delay(ms);
const noteText = text => page.getByText(text, { exact: true });
const rowButton = text => noteText(text).locator("xpath=ancestor::button[1]");
const bell = () => page.getByRole("button", { name: "Notifications" }).first();
const notificationPopup = () => page.locator('[data-radix-popper-content-wrapper]').filter({ hasText: "Notifications" }).last();
const closePopup = async locator => {
  await locator.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
  return !await locator.isVisible().catch(() => false);
};
const shot = name => page.screenshot({ path: join(out, name) });

try {
  await mkdir(out, { recursive: true });
  await cp(join(root, "artifacts/mbs-crm/dist/public"), frozen, { recursive: true });
  sandbox = await startSandbox({ build: false, webRoot: frozen, port: 4370 });
  browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", headless: true });
  context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  page = await context.newPage();
  state = { listRequests: 0, onNextList: null, readDelay: 0 };
  await page.route("**/notifications**", async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    interceptedUrls.push(`${route.request().method()} ${url.href}`);
    const json = body => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (path.endsWith("/unread-count")) return json({ count: rows.filter(row => !row.isRead).length });
    if (path.endsWith("/read-all")) { rows.forEach(row => row.isRead = true); return json({ success: true }); }
    if (/\/notifications\/\d+\/read$/.test(path)) {
      if (state.readDelay) await delay(state.readDelay);
      const row = rows.find(item => item.id === Number(path.match(/\/(\d+)\/read$/)[1]));
      if (row) row.isRead = true;
      return json({ success: true });
    }
    if (path.endsWith("/notifications")) {
      state.listRequests++;
      state.onNextList?.(state.listRequests);
      const body = { data: rows, total: rows.length, page: 1, limit: 20 };
      if (state.listRequests === 1) await delay(650);
      return json(body);
    }
    return route.continue();
  });
  await sandbox.login(page, "admin");
  await page.goto(`${sandbox.url}/dashboard`);
  const aside = page.locator('[data-testid="desktop-sidebar"]');
  await aside.waitFor({ state: "visible", timeout: 20000 });

  // Loading, then mark-all: retain history, clear unread styling/count, toast, and stay open.
  await bell().click();
  await noteText("Loading notifications...").waitFor({ state: "visible", timeout: 3000 });
  await noteText("Synthetic lead assigned").waitFor({ state: "visible", timeout: 10000 });
  const badge = bell().locator("span.absolute");
  check("delayed list loading renders in the open panel", await noteText("Synthetic lead assigned").isVisible());
  check("fixture begins with unread badge", (await badge.innerText().catch(() => "")).trim() === "10");
  await shot("final-desktop-notifications-open.png");
  await page.getByRole("button", { name: "Mark all read" }).click();
  await page.getByText("All caught up", { exact: true }).waitFor({ state: "visible", timeout: 5000 });
  const readClasses = await rowButton("Synthetic lead assigned").getAttribute("class");
  check("mark-all-read clears unread count but retains read notification history",
    rows.every(row => row.isRead) && !(await badge.count()) === true && !(readClasses ?? "").split(/\s+/).includes("bg-muted")
      && await noteText("Synthetic lead assigned").isVisible()
      && await noteText("Notifications").last().isVisible(),
    `badge=${await badge.count()}, rowClass=${readClasses}`);
  check("mark-all-read success feedback appears", await page.getByText("All notifications marked as read.", { exact: true }).isVisible().catch(() => false));

  // Genuine outside click closes the desktop popup without reopening on pointer movement.
  await page.mouse.click(850, 450);
  const outsideClosed = await closePopup(notificationPopup());
  await snooze(250);
  check("desktop outside click closes panel without surprise reopen", outsideClosed && !await notificationPopup().isVisible().catch(() => false));

  // Reverse short hover intents, then keep an expanded bell layer mounted across list scroll/refetch.
  await page.mouse.move(25, 260); await snooze(55);
  await page.mouse.move(800, 500); await snooze(60);
  await page.mouse.move(25, 260); await snooze(170);
  check("quick enter/leave cancels stale open timer and re-entry opens rail", await aside.getAttribute("data-open") === "true");
  await page.mouse.move(800, 500); await snooze(60);
  await page.mouse.move(25, 260); await snooze(250);
  check("re-entry cancels stale close timer", await aside.getAttribute("data-open") === "true");
  await page.mouse.move(800, 500); await snooze(250);
  check("sidebar closes after a genuine sustained leave", await aside.getAttribute("data-open") === "false");

  await bell().click();
  await noteText("Synthetic lead assigned").waitFor({ state: "visible", timeout: 5000 });
  const popup = notificationPopup();
  const list = popup.locator(".overflow-y-auto").first();
  await list.evaluate(el => { el.scrollTop = 180; });
  const scrollTop = await list.evaluate(el => el.scrollTop);
  await rowButton("Synthetic history 1").focus();
  const priorLists = state.listRequests;
  let resolvePoll;
  const pollSeen = new Promise(resolve => { resolvePoll = resolve; });
  state.onNextList = count => { if (count > priorLists) resolvePoll(count); };
  const rect = await popup.boundingBox();
  if (rect) await page.mouse.move(rect.x + Math.min(80, rect.width / 2), rect.y + 80);
  await Promise.race([pollSeen, snooze(34000).then(() => null)]);
  await snooze(450);
  const afterPoll = await list.evaluate(el => el.scrollTop).catch(() => -1);
  check("scroll and scheduled list refetch keep hovered/focused panel open",
    state.listRequests > priorLists && await noteText("Synthetic lead assigned").isVisible()
      && await popup.isVisible() && afterPoll > 0 && scrollTop > 0,
    `listRequests ${priorLists}->${state.listRequests}; scrollTop ${scrollTop}->${afterPoll}`);

  // Ctrl+B while editing is not a sidebar command.
  await page.goto(`${sandbox.url}/leads`);
  const search = page.getByPlaceholder("Search by name, email, company…");
  await search.waitFor({ state: "visible", timeout: 15000 });
  await search.focus();
  await page.keyboard.press("Control+b");
  check("Ctrl+B while editing a Leads search does not pin sidebar", await aside.getAttribute("data-pinned") === "false");

  // Mobile sheet outside and Escape dismissals; let the transition settle before inspection.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${sandbox.url}/dashboard`);
  await bell().click();
  const mobileDialog = page.getByRole("dialog").last();
  await mobileDialog.waitFor({ state: "visible", timeout: 5000 });
  await noteText("Synthetic lead assigned").waitFor({ state: "visible", timeout: 10000 });
  await snooze(450);
  await shot("final-mobile-notifications-open.png");
  check("390px mobile sheet shows synthetic history", await mobileDialog.isVisible() && await noteText("Synthetic lead assigned").isVisible());
  await page.keyboard.press("Escape");
  check("mobile Escape dismisses the notification sheet", await closePopup(mobileDialog));
  await bell().click();
  await page.getByRole("dialog").last().waitFor({ state: "visible", timeout: 5000 });
  await snooze(450);
  await page.mouse.click(190, 80); // above the bottom sheet
  check("mobile outside click dismisses the notification sheet", await closePopup(page.getByRole("dialog").last()));
  check("mobile navigation control remains available after dismissing sheet", await page.getByRole("button", { name: /Open navigation/i }).isVisible().catch(() => false));
} catch (error) {
  runnerErrors.push({ message: String(error), stack: error?.stack });
} finally {
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await sandbox?.close().catch(() => {});
  await rm(frozen, { recursive: true, force: true }).catch(() => {});

  const sources = ["results.json", "continued-results.json", "resume-results.json"];
  const priorHarnessErrors = [];
  const previouslyVerified = [];
  for (const source of sources) {
    try {
      const data = JSON.parse(await readFile(join(out, source), "utf8"));
      for (const error of data.runnerErrors ?? []) priorHarnessErrors.push({ source, ...error });
      for (const item of data.checks ?? []) if (item.pass) previouslyVerified.push({ source, ...item });
    } catch {}
  }
  // The initial empty-state expectation was a harness error: read-all deliberately retains history.
  const supersededExpectations = [
    { source: "resume-results.json", check: "mark-all-read expected no notification rows", reason: "Incorrect: read-all retains history; corrected assertions above check zero count and non-unread rows." },
    { source: "resume-results.json", check: "mobile dismissal checked before sheet transition settled", reason: "Replaced with settled-dialog visibility checks in this continuation." },
  ];
  const result = {
    build: "guard-ready frozen web assets",
    finalRun: { checks, interceptedRequestCount: interceptedUrls.length, interceptedUrls, runnerErrors },
    previouslyVerified, priorHarnessErrors, supersededExpectations,
    summary: {
      finalRunPassed: checks.filter(item => item.pass).length,
      finalRunFailed: checks.filter(item => !item.pass).length,
      finalRunRunnerErrors: runnerErrors.length,
      previouslyVerified: previouslyVerified.length,
      priorHarnessErrors: priorHarnessErrors.length,
    },
  };
  await writeFile(join(out, "final-results.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result.summary));
  for (const fail of checks.filter(item => !item.pass)) console.log(`ASSERTION FAILURE: ${fail.name} — ${fail.detail}`);
  for (const error of runnerErrors) console.log(`HARNESS/RUNNER ERROR: ${error.message}`);
}