// Three-check final-scope runner for GitHub main 8622188. This file is
// prepared-only until Main pins that commit and starts it. --check-ready-only
// never launches a browser, fixture, Clerk account, or API child.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "../..");
const reportDir = join(root, "reports/focused-final-8622188");
const authFile = join(root, "reports/role-directory-certification/launch-authorization.json");
const pushReceiptFile = join(root, ".local/final-role-evidence-push.json");
const sourceBindingFile = join(root, "reports/role-directory-certification/final-source-binding.json");
const historicalFile = join(root, ".local/certification-853f4e4/historical-campaign.json");
const originalSandbox = join(root, "scripts/visual-refresh/sandbox.mjs");
const transportHook = join(reportDir, "sendgrid-transport-interceptor.cjs");
const systemChromium = "/repl/tools/bin/chromium";
const finalGithubCommit = "862218809a23c7f4d4adc748f07d74534746fb6d";
const syntheticReplyTo = "synthetic-replies@example.invalid";
const expectedRecipient = "contact@example.invalid";
const fakeSendgridKey = "SG.FOCUSED_FAKE_KEY_NEVER_VALID";
const require = createRequire(join(root, "artifacts/api-server/package.json"));
const { check } = { check: (condition, message) => { if (!condition) throw new Error(message); } };
const sha = (data) => createHash("sha256").update(data).digest("hex");
const shaFile = (path) => sha(readFileSync(path));

async function shaTree(directory) {
  const hash = createHash("sha256");
  async function visit(folder, rel = "") {
    for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(rel, entry.name);
      if (entry.isDirectory()) await visit(join(folder, entry.name), path);
      else if (entry.isFile()) {
        hash.update(path); hash.update("\0"); hash.update(readFileSync(join(directory, path))); hash.update("\0");
      }
    }
  }
  await visit(directory);
  return hash.digest("hex");
}

function gitBlobSha(bytes) {
  return createHash("sha1").update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest("hex");
}

async function readyProof() {
  const lock = JSON.parse(readFileSync(authFile, "utf8"));
  check(lock.sourceFinalized && lock.elevenGatePreflightExit === 0 && lock.immutablePinsFrozen && lock.launchAuthorized,
    "The retained final-source authorization is incomplete; this runner does not rerun preflight.");
  const pushReceipt = JSON.parse(readFileSync(pushReceiptFile, "utf8"));
  const binding = JSON.parse(readFileSync(sourceBindingFile, "utf8"));
  check(pushReceipt.parent === lock.targetRevision && pushReceipt.commit === finalGithubCommit
    && pushReceipt.verified === true && pushReceipt.published === false,
  "The retained 8622188 push receipt does not match the certified parent/commit verification.");
  check(binding.candidate === lock.targetRevision && binding.sourceFilesMatched === 886
    && binding.files?.length === 886, "The retained final-source binding must cover exactly the 886 fd9816 source blobs.");
  const boundReceipt = pushReceipt.files?.find((file) => file.path === "reports/role-directory-certification/final-source-binding.json");
  check(boundReceipt?.sha === gitBlobSha(readFileSync(sourceBindingFile)),
    "The final-source-binding document does not match its retained push-receipt blob.");
  for (const entry of binding.files) {
    const path = resolve(root, entry.path);
    check(path.startsWith(root + "/") && existsSync(path) && shaFile(path) === entry.sha256,
      `Final-source-bound file changed or is missing: ${entry.path}`);
  }
  check(lock.sandboxHelperSha256 === shaFile(originalSandbox), "Pinned fixture sandbox helper changed.");
  check(lock.historicalCampaignFixtureSha256 === shaFile(historicalFile), "Pinned Campaign 5 historical fixture changed.");
  const webRoot = resolve(root, lock.candidateWebRoot);
  const actual = {
    webSource: await shaTree(join(root, "artifacts/mbs-crm/src")),
    apiSource: await shaTree(join(root, "artifacts/api-server/src")),
    webBuild: await shaTree(webRoot),
    webIndex: shaFile(join(webRoot, "index.html")),
    apiDist: await shaTree(join(root, "artifacts/api-server/dist")),
  };
  const expected = {
    webSource: lock.candidateWebSourceTreeSha256,
    apiSource: lock.candidateApiSourceTreeSha256,
    webBuild: lock.candidateWebTreeSha256,
    webIndex: lock.candidateIndexSha256,
    apiDist: lock.candidateApiDistSha256,
  };
  for (const key of Object.keys(expected)) check(actual[key] === expected[key], `${key} no longer matches the prior frozen certification pin.`);
  check(existsSync(systemChromium), `Required system Chromium is missing at ${systemChromium}.`);
  check(shaFile(transportHook) === "7edf08e882ef3e22d09f14d7fd8edf70abbd47c6ec2df3ac1969a7fa52933ece", "Transport interceptor source changed after preparation.");
  const bundle = join(root, "artifacts/api-server/dist/chunks/chunk-KLBRZB65.mjs");
  check(existsSync(bundle) && readFileSync(bundle, "utf8").includes("https.request(options)"),
    "Pinned compiled API no longer exposes the verified Node HTTPS transport seam.");
  return { lock, pushReceipt, binding, actual, expected, systemChromium, bundle };
}

function atomicJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
function append(file, value) { appendFileSync(file, `${JSON.stringify(value)}\n`); }
function safeText(value, max = 1000) { return String(value ?? "").replace(/[\r\n\t]+/g, " ").slice(0, max); }
function safePath(raw) {
  try {
    const url = new URL(raw);
    return url.pathname.replace(/(\/api\/(?:leads|deals|campaigns)\/)\d+/g, "$1[ID]");
  } catch { return String(raw ?? "").split("?")[0]; }
}
function q(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function ts(value) { return value == null ? "NULL" : `${q(value.replace("T", " "))}::timestamp`; }
function tz(value) { return value == null ? "NULL" : `${q(value)}::timestamptz`; }

function createSandboxDerivative(output, readyFile, providerReadyFile, launchGateFile) {
  const original = readFileSync(originalSandbox, "utf8");
  const fsImport = `import { createReadStream, existsSync, statSync } from "node:fs";`;
  check(original.split(fsImport).length === 2, "Sandbox filesystem import no longer matches the narrow derivative patch.");
  const source = original.replace(fsImport,
    `import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";`);
  const oldGuard = `        if (/\\/(?:twilio\\/(?:call|sms)|email\\/send|credit\\/pull|campaigns\\/[^/]+\\/launch)/.test(req.url) && req.method !== "GET") {
          res.writeHead(403, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "External delivery prohibited by test runner" }));
        }`;
  const newGuard = `        if (/\\/(?:twilio\\/(?:call|sms)|email\\/send|credit\\/pull|campaigns\\/[^/]+\\/launch)/.test(req.url) && req.method !== "GET") {
          let gate = null, intercept = null, provider = null;
          try { gate = JSON.parse(readFileSync(process.env.FOCUSED_LAUNCH_GATE_FILE, "utf8")); } catch {}
          try { intercept = JSON.parse(readFileSync(process.env.FOCUSED_SENDGRID_READY_PATH, "utf8")); } catch {}
          try { provider = JSON.parse(readFileSync(process.env.FOCUSED_PROVIDER_READY_PATH, "utf8")); } catch {}
          const path = new URL(req.url, "http://fixture.local").pathname;
          const allowed = req.method === "POST" && gate?.path === path && gate?.remaining > 0
            && intercept?.ready === true && provider?.ready === true
            && intercept?.fakeApiKeyInstalled === true && intercept?.inboundParseSecretUnset === true;
          if (!allowed) {
            res.writeHead(403, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ error: "Focused launch requires one allow-listed campaign and confirmed local SendGrid transport interception" }));
          }
          gate.remaining -= 1; gate.lastConsumedAt = new Date().toISOString();
          writeFileSync(process.env.FOCUSED_LAUNCH_GATE_FILE, JSON.stringify(gate, null, 2) + String.fromCharCode(10));
        }`;
  check(source.split(oldGuard).length === 2, "Sandbox safety guard no longer matches the approved derivative patch.");
  const derived = source.replace(oldGuard, newGuard);
  check(derived.includes("Focused launch requires one allow-listed campaign")
    && derived.includes("twilio") && derived.includes("email") && derived.includes("credit"),
  "Derived sandbox must retain Twilio/email/credit denial and only permit the confirmed focused launch.");
  const destination = join(reportDir, "derived-sandbox.mjs");
  writeFileSync(destination, derived);
  atomicJson(join(output, "sandbox-derivative-proof.json"), {
    originalPath: "scripts/visual-refresh/sandbox.mjs", originalSha256: shaFile(originalSandbox),
    derivativePath: "reports/focused-final-8622188/derived-sandbox.mjs",
    derivativeSha256: shaFile(destination), importedFilesystemHelpers: ["readFileSync", "writeFileSync"],
    narrowOverride: "POST /api/campaigns/{one allow-listed id}/launch only",
    launchRequires: ["parent local provider listener ready", "API-child transport preloader ready", "fake key installed", "inbound parse settings unset"],
    allOtherExternalDeliveryBlocksRetained: true,
  });
  process.env.FOCUSED_SENDGRID_READY_PATH = readyFile;
  process.env.FOCUSED_PROVIDER_READY_PATH = providerReadyFile;
  process.env.FOCUSED_LAUNCH_GATE_FILE = launchGateFile;
  return destination;
}

async function captureProviderServer(output, fakeKey) {
  const { createServer } = await import("node:http");
  const calls = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const rawBody = Buffer.concat(chunks).toString("utf8");
    let payload = null;
    try { payload = JSON.parse(rawBody); } catch {}
    const recipients = (payload?.personalizations ?? []).flatMap((item) => (item.to ?? []).map((to) => to.email));
    const replyTo = payload?.reply_to?.email ?? payload?.replyTo?.email ?? null;
    const authOkay = req.headers.authorization === `Bearer ${fakeKey}`;
    const safePayload = recipients.length === 1 && recipients[0] === expectedRecipient
      && recipients.every((email) => email.endsWith("@example.invalid"))
      && replyTo === syntheticReplyTo && authOkay;
    const status = req.method === "POST" && req.url === "/v3/mail/send" && safePayload ? 202 : 400;
    const responseBody = "";
    const responseHeaders = status === 202
      ? { "x-message-id": "focused-8622188-send-1@example.invalid", "content-length": "0" }
      : { "content-type": "application/json" };
    const row = {
      method: req.method, path: req.url, rawRequestHeaders: {
        authorization: authOkay ? "Bearer [FAKE_KEY_REDACTED]" : "[MISSING_OR_WRONG]",
        contentType: req.headers["content-type"] ?? null, host: req.headers.host ?? null,
      },
      rawRequestBody: rawBody, parsedTo: recipients, parsedReplyTo: replyTo,
      response: { status, headers: responseHeaders, rawBody: responseBody },
      fakeKeyAccepted: authOkay, allRecipientsSynthetic: recipients.length > 0 && recipients.every((email) => email.endsWith("@example.invalid")),
      at: new Date().toISOString(),
    };
    calls.push(row);
    append(join(output, "sendgrid-raw-transport.ndjson"), row);
    res.writeHead(status, responseHeaders);
    res.end(responseBody);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  check(address && typeof address === "object", "Local SendGrid interception server failed to bind.");
  return { server, port: address.port, calls };
}

async function apiRequest(context, output, phase, method, path, data, authToken) {
  check(typeof authToken === "string" && authToken.length > 20, "Fixture admin session did not provide an API bearer token.");
  const response = await context.request.fetch(`${process.env.FOCUSED_APP_URL}${path}`, {
    method, ...(data === undefined ? {} : { data }),
    headers: { authorization: `Bearer ${authToken}`, ...(data === undefined ? {} : { "content-type": "application/json" }) },
  });
  let body;
  try { body = await response.json(); } catch { body = await response.text().catch(() => ""); }
  append(join(output, "campaign-api-status.ndjson"), {
    phase, method, path, status: response.status(), body,
    at: new Date().toISOString(),
  });
  return { response, body };
}

async function seedHistoricalCampaign5(fixture, output, databaseUrl) {
  const bytes = readFileSync(historicalFile);
  const historical = JSON.parse(bytes);
  check(historical.campaign?.id === 5 && historical.campaign?.status === "completed"
    && historical.launches?.length === 1 && historical.recipients?.length === 13 && historical.sends?.length === 13,
  "Pinned Campaign 5 history fixture must contain one completed launch and thirteen recipients/sends.");
  const dbName = fixture.query("SELECT current_database()");
  check(/^visual_refresh_fixture_\d+_\d+$/.test(dbName), "Historical inserts are restricted to the isolated visual fixture database.");
  const targetUrl = new URL(databaseUrl);
  targetUrl.pathname = `/${dbName}`;
  const leadSources = [...new Set(historical.recipients.map((row) => row.lead_id))];
  const leadIds = new Map(leadSources.map((id, index) => [id, index + 3]));
  const statements = [];
  for (const id of leadSources) {
    const newId = leadIds.get(id), n = newId - 2, ordinal = String(n).padStart(2, "0");
    statements.push(`INSERT INTO leads(id,first_name,last_name,email,phone,company_name,application_type,status,assigned_rep_id,lead_source,created_at,updated_at)
      VALUES (${newId},'Historical','Fixture Recipient ${ordinal}',${q(`historical-recipient-${ordinal}@example.invalid`)},
      ${q(`+1202555${String(100 + n).padStart(4, "0")}`)},${q(`Synthetic Campaign Recipient ${ordinal}`)},'equipment','contacted',3,'manual',now(),now());`);
  }
  const c = historical.campaign, launch = historical.launches[0];
  statements.push(`INSERT INTO campaigns(id,name,channel,status,email_template_id,audience_rules,scheduled_at,launched_at,completed_at,owner_id,created_by,version,created_at,updated_at,tracking_since,reply_to_email,flyer_delivery_mode)
    VALUES (5,${q(c.name)},${q(c.channel)},${q(c.status)},1,'{}'::jsonb,${tz(c.scheduled_at)},${tz(c.launched_at)},${tz(c.completed_at)},1,1,${c.version},${tz(c.created_at)},${tz(c.updated_at)},NULL,'fixture-replies@example.invalid',${q(c.flyer_delivery_mode)});`);
  statements.push(`INSERT INTO campaign_launches(id,campaign_id,idempotency_key,requested_by,mode,status,eligible_count,excluded_count,sent_count,failed_count,scheduled_at,started_at,completed_at,created_at)
    VALUES (5,5,'historical-fixture-launch-5',1,${q(launch.mode)},${q(launch.status)},${launch.eligible_count},${launch.excluded_count},${launch.sent_count},${launch.failed_count},${tz(launch.scheduled_at)},${tz(launch.started_at)},${tz(launch.completed_at)},${tz(launch.created_at)});`);
  for (const send of historical.sends) {
    const id = leadIds.get(send.lead_id), ordinal = String(id - 2).padStart(2, "0");
    statements.push(`INSERT INTO email_sends(id,lead_id,user_id,template_id,subject,to_email,from_email,status,sendgrid_message_id,sent_at,opened_at,clicked_at,created_at,updated_at,campaign_id,campaign_launch_id,delivery_kind)
      VALUES (${send.id},${id},1,1,${q("Vendors — Heavy Equipment (synthetic historical fixture)")},${q(`historical-recipient-${ordinal}@example.invalid`)},'fixture-sender@example.invalid',
      ${q(send.status)},NULL,${ts(send.sent_at)},${ts(send.opened_at)},${ts(send.clicked_at)},${ts(send.created_at)},${ts(send.updated_at)},5,5,${q(send.delivery_kind)});`);
  }
  for (const recipient of historical.recipients) {
    statements.push(`INSERT INTO campaign_recipients(id,launch_id,campaign_id,lead_id,channel,status,exclusion_reason,available_at,email_send_id,sent_at,created_at)
      VALUES (${recipient.id},5,5,${leadIds.get(recipient.lead_id)},${q(recipient.channel)},${q(recipient.status)},
      ${recipient.exclusion_reason == null ? "NULL" : q(recipient.exclusion_reason)},${tz(recipient.available_at)},${recipient.email_send_id},NULL,${tz(recipient.created_at)});`);
  }
  for (const [table, sequence] of [["leads", 15], ["campaigns", 5], ["campaign_launches", 5], ["campaign_recipients", 26], ["email_sends", 45]]) {
    statements.push(`SELECT setval(pg_get_serial_sequence('${table}','id'),${sequence},true);`);
  }
  const inserted = spawnSync("psql", [
    `--dbname=${targetUrl}`, "--no-psqlrc", "--set=ON_ERROR_STOP=on", "--single-transaction", "--command", statements.join("\n"),
  ], { cwd: root, encoding: "utf8" });
  check(inserted.status === 0, `Campaign 5 history insert failed: ${safeText(inserted.stderr?.slice(-1200))}`);
  const verify = JSON.parse(fixture.query(`SELECT row_to_json(q) FROM (
    SELECT c.id,c.status,l.sent_count,
    (SELECT count(*) FROM campaign_recipients r WHERE r.campaign_id=5 AND r.status='sent') AS recipient_sent,
    (SELECT count(*) FROM email_sends e WHERE e.campaign_id=5 AND e.status IN ('sent','delivered','opened','clicked')) AS email_sent
    FROM campaigns c JOIN campaign_launches l ON l.campaign_id=c.id WHERE c.id=5) q`));
  check(verify.id === 5 && verify.status === "completed" && Number(verify.sent_count) === 13
    && Number(verify.recipient_sent) === 13 && Number(verify.email_sent) === 13,
  `Campaign 5 fixture row verification failed: ${JSON.stringify(verify)}`);
  atomicJson(join(output, "campaign5-history-seed.json"), {
    source: ".local/certification-853f4e4/historical-campaign.json", sourceSha256: sha(bytes),
    database: dbName, campaignId: 5, insertedStatements: statements.length,
    fixtureRows: { launches: 1, recipients: 13, sends: 13 }, verification: verify,
    sourceKind: "schema-only disposable fixture; not production-data rehearsal",
  });
  return dbName;
}

async function captureManagerPages(browser, fixture, output, fixtureUrl) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "light", serviceWorkers: "block" });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  let phase = "manager-auth";
  const responses = [], cdpResponses = [], consoleErrors = [], pageErrors = [], requestFailures = [];
  page.on("response", (response) => {
    const row = { page: phase, method: response.request().method(), path: safePath(response.url()), status: response.status(), at: new Date().toISOString() };
    responses.push(row); append(join(output, "manager-pwr-statuses.ndjson"), row);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      const row = { page: phase, text: safeText(message.text()), url: safePath(message.location().url), at: new Date().toISOString() };
      consoleErrors.push(row); append(join(output, "manager-console-errors.ndjson"), row);
    }
  });
  page.on("pageerror", (error) => {
    const row = { page: phase, text: safeText(error.message), at: new Date().toISOString() };
    pageErrors.push(row); append(join(output, "manager-page-errors.ndjson"), row);
  });
  page.on("requestfailed", (request) => {
    const row = { page: phase, method: request.method(), path: safePath(request.url()), error: safeText(request.failure()?.errorText), at: new Date().toISOString() };
    requestFailures.push(row); append(join(output, "manager-request-failures.ndjson"), row);
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  cdp.on("Network.responseReceived", (event) => {
    const row = { page: phase, status: event.response.status, url: safePath(event.response.url), at: new Date().toISOString() };
    cdpResponses.push(row); append(join(output, "manager-cdp-statuses.ndjson"), row);
  });
  try {
    await fixture.login(page, "manager");
    const paths = [
      ["Leads", "/leads"],
      ["Lead Detail", "/leads/1"],
      ["Deals", "/deals"],
      ["Campaigns", "/campaigns"],
      ["Campaign 5 Results", "/campaigns/5"],
    ];
    let resultsApi = null, resultsBody = null, resultsText = "";
    for (const [label, path] of paths) {
      phase = label;
      let resultWait;
      if (label === "Campaign 5 Results") {
        resultWait = page.waitForResponse((response) =>
          response.request().method() === "GET" && new URL(response.url()).pathname === "/api/campaigns/5/results",
        { timeout: 20000 });
      }
      await page.goto(`${fixtureUrl}${path}`);
      await page.getByRole("heading", { level: 1 }).first().waitFor({ state: "visible" });
      if (label === "Campaign 5 Results") {
        const tab = page.getByRole("tab", { name: "Results", exact: true });
        if (await tab.count()) await tab.click();
        const response = await resultWait;
        resultsApi = { status: response.status(), path: "/api/campaigns/5/results" };
        resultsBody = await response.json();
        await page.getByText("Campaign Results", { exact: true }).waitFor({ state: "visible" });
        resultsText = await page.locator("body").innerText();
        check(response.status() === 200 && resultsBody.counts?.sent === 13
          && resultsBody.launches?.length === 1 && resultsBody.launches[0]?.status === "completed",
        "Campaign 5 real Results API did not report one completed launch and Sent 13.");
        check(/13\s*\n\s*Sent|Sent\s*\n\s*13/i.test(resultsText),
          "Campaign 5 real Results UI did not visibly pair Sent with 13.");
        const screenshot = join(output, "campaign5-results-manager.png");
        await page.screenshot({ path: screenshot, fullPage: true, animations: "disabled" });
        atomicJson(join(output, "campaign5-results-ui-api.json"), {
          page: "/campaigns/5", resultTab: "Results", api: resultsApi, counts: resultsBody.counts,
          launchCount: resultsBody.launches.length, launchStatus: resultsBody.launches[0].status,
          visibleUiSent13: true, screenshot: "campaign5-results-manager.png", screenshotSha256: shaFile(screenshot),
        });
      }
    }
    const bad = [...responses.map((row) => ({ source: "PWR", ...row })),
      ...cdpResponses.map((row) => ({ source: "CDP", ...row }))]
      .filter((row) => [403, 404, 503].includes(row.status));
    atomicJson(join(output, "manager-page-summary.json"), {
      pages: paths.map(([label, path]) => ({ label, path })),
      pwrResponses: responses.length, cdpResponses: cdpResponses.length,
      forbiddenStatuses: bad, consoleErrors, pageErrors, requestFailures,
      campaign5ResultApi: resultsApi, campaign5ResultCounts: resultsBody?.counts,
    });
    check(bad.length === 0, `Manager page flow received ${bad.length} unexpected 403/404/503 response(s).`);
    check(consoleErrors.length === 0 && pageErrors.length === 0, "Manager page flow produced console/page errors.");
    return { responses, cdpResponses, consoleErrors, pageErrors, requestFailures, resultsApi, resultsBody };
  } finally {
    await cdp.detach().catch(() => {});
    await context.close();
  }
}

async function runFocused() {
  const ready = await readyProof();
  const output = join(reportDir, "runs", `run-${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`);
  mkdirSync(output, { recursive: true });
  const apiEnv = { ...process.env };
  const priorNodeOptions = process.env.NODE_OPTIONS ?? "";
  const readyFile = join(output, "sendgrid-interceptor-ready.json");
  const providerReadyFile = join(output, "sendgrid-provider-ready.json");
  const launchGateFile = join(output, "single-campaign-launch-gate.json");
  const provider = await captureProviderServer(output, fakeSendgridKey);
  writeFileSync(providerReadyFile, `${JSON.stringify({ ready: true, bind: "127.0.0.1", port: provider.port, fakeProvider: "local-only" }, null, 2)}\n`);
  process.env.FOCUSED_SENDGRID_PORT = String(provider.port);
  process.env.FOCUSED_SENDGRID_READY_PATH = readyFile;
  process.env.FOCUSED_SENDGRID_TRANSPORT_LOG = join(output, "sendgrid-child-transport.ndjson");
  process.env.NODE_OPTIONS = `${priorNodeOptions} --require=${transportHook}`.trim();
  process.env.FOCUSED_APP_URL = `http://127.0.0.1:${ready.lock.port}`;
  // The production-mode outbound guard accepts only the canonical origin.
  // The recipient and key are synthetic, and the HTTPS SendGrid transport
  // is intercepted locally before any actual provider request can escape.
  process.env.PUBLIC_APP_URL = "https://app.my-business-solutions.com";

  let fixture, browser, dbName = null, fixtureClosed = false, cleanupError = null;
  const createdUsers = [];
  const clerkClient = require("@clerk/express").clerkClient;
  const originalCreateUser = clerkClient.users.createUser.bind(clerkClient.users);
  clerkClient.users.createUser = async (...args) => {
    const user = await originalCreateUser(...args);
    createdUsers.push(user.id);
    return user;
  };
  const apiCalls = [], guardProof = {};
  let runError = null;
  try {
    const derivativePath = createSandboxDerivative(output, readyFile, providerReadyFile, launchGateFile);
    const { startSandbox } = await import(pathToFileURL(derivativePath).href);
    fixture = await startSandbox({ build: false, webRoot: resolve(root, ready.lock.candidateWebRoot), port: ready.lock.port });
    dbName = fixture.query("SELECT current_database()");
    check(/^visual_refresh_fixture_\d+_\d+$/.test(dbName), "API campaign test is not running in the disposable schema-only fixture.");
    const preloaded = JSON.parse(readFileSync(readyFile, "utf8"));
    check(preloaded.ready && preloaded.fakeApiKeyInstalled && preloaded.inboundParseSecretUnset,
      "Compiled API child did not confirm transport interception before import.");
    const apiBundle = ready.bundle.replace(root + "/", "");
    atomicJson(join(output, "run-source-proof.json"), {
      targetGithubCommit: finalGithubCommit, previousFrozenRevision: ready.lock.targetRevision,
      mainMustIndependentlyPinAndStartThisExactCommit: true,
      pushReceipt: { verified: ready.pushReceipt.verified, published: ready.pushReceipt.published, commit: ready.pushReceipt.commit },
      sourceBinding: { candidate: ready.binding.candidate, sourceFilesMatched: ready.binding.sourceFilesMatched },
      appSourceHashes: ready.actual, frozenBuildHashes: ready.expected, apiBundle,
      apiBundleNodeHttpsRequestSeam: "verified compiled axios line: https.request(options)",
      apiChildPreloadedBeforeCompiledApiEntry: true, systemChromium,
      nodeOptionsPreload: "reports/focused-final-8622188/sendgrid-transport-interceptor.cjs",
      sendgridInboundParse: "unset in isolated API process", actualProviderCredential: "none; replaced with fake key",
    });
    const { chromium } = await import("@playwright/test");
    browser = await chromium.launch({ headless: true, executablePath: systemChromium });
    const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
    const adminPage = await adminContext.newPage();
    adminPage.setDefaultTimeout(15000);
    await fixture.login(adminPage, "admin");
    const api = async (phase, method, path, body) => apiRequest(
      adminContext, output, phase, method, path, body,
      await adminPage.evaluate(() => window.Clerk.session?.getToken()),
    );

    const settings = await api("enable-email-in-disposable-db", "PUT", "/api/settings/email-delivery", {
      emailSendingEnabled: true, bulkEmailPerMinute: 20, bulkEmailPerDay: 20,
    });
    check(settings.response.status() === 200 && settings.body.emailSendingEnabled === true,
      "Could not enable email delivery in this disposable DB through the admin settings API.");
    guardProof.emailEnabledOnlyInFixture = { status: settings.response.status(), enabled: settings.body.emailSendingEnabled, database: dbName };

    const created = await api("create-one-recipient-campaign", "POST", "/api/campaigns", {
      name: "Synthetic one-recipient transport test 8622188",
      channel: "email", emailTemplateId: 1, audienceRules: { pickedLeadIds: [1] },
      replyToEmail: syntheticReplyTo, flyerDeliveryMode: "attach",
    });
    check(created.response.status() === 201 && Number.isInteger(created.body.id), `Campaign create failed (${created.response.status()}).`);
    const campaignId = created.body.id;
    const launchPath = `/api/campaigns/${campaignId}/launch`;
    atomicJson(launchGateFile, { path: launchPath, remaining: 2, useLimit: "one pre-approval guard attempt plus one approved live launch", used: false });

    const rejected = await api("approval-guard-draft-live-launch", "POST", launchPath, {
      idempotencyKey: `guard-${randomUUID()}`, mode: "live",
    });
    check(rejected.response.status() === 409, `Draft campaign launch guard expected 409, got ${rejected.response.status()}.`);
    check(provider.calls.length === 0, "SendGrid transport was called before campaign approval.");
    guardProof.draftLaunchRejected = { status: rejected.response.status(), response: rejected.body, providerCallsBeforeApproval: provider.calls.length };

    const preview = await api("calculate-live-audience", "POST", `/api/campaigns/${campaignId}/preview`, {});
    check(preview.response.status() === 200 && preview.body.counts?.eligible === 1
      && preview.body.eligible?.length === 1 && preview.body.eligible[0]?.target === expectedRecipient,
    "Real campaign preview did not resolve exactly one synthetic eligible recipient.");
    const staleApproval = await api("approval-guard-without-preview", "POST", `/api/campaigns/${campaignId}/approve`, {
      approvalType: "content_and_audience", previewToken: "stale-preview-token-8622188", claimsAffirmed: true,
    });
    check(staleApproval.response.status() === 409, `Missing-preview approval guard expected 409, got ${staleApproval.response.status()}.`);
    const approval = await api("approve-current-audience-snapshot", "POST", `/api/campaigns/${campaignId}/approve`, {
      approvalType: "content_and_audience", previewToken: preview.body.previewToken, claimsAffirmed: true,
    });
    check(approval.response.status() === 200 && approval.body.status === "approved",
      `Current preview approval failed (${approval.response.status()}).`);
    guardProof.audiencePreview = { status: preview.response.status(), counts: preview.body.counts, eligibleRecipients: preview.body.eligible?.length };
    guardProof.stalePreviewApprovalRejected = { status: staleApproval.response.status(), response: staleApproval.body };
    guardProof.currentPreviewApproval = { status: approval.response.status(), campaignStatus: approval.body.status };
    atomicJson(join(output, "campaign-approval-audience-guards.json"), guardProof);

    const launched = await api("approved-one-recipient-live-launch", "POST", launchPath, {
      idempotencyKey: `live-${randomUUID()}`, mode: "live",
    });
    check([200, 201].includes(launched.response.status()), `Approved live launch failed (${launched.response.status()}).`);
    if (provider.calls.length !== 1) {
      const sendFailures = fixture.query(`SELECT coalesce(json_agg(row_to_json(q))::text, '[]') FROM (
        SELECT id, status, failure_reason, to_email FROM email_sends WHERE campaign_id=${campaignId} ORDER BY id
      ) q`);
      const recipientFailures = fixture.query(`SELECT coalesce(json_agg(row_to_json(q))::text, '[]') FROM (
        SELECT id, status, exclusion_reason FROM campaign_recipients WHERE campaign_id=${campaignId} ORDER BY id
      ) q`);
      atomicJson(join(output, "failed-send-diagnosis.json"), {
        launch: launched.body, sends: JSON.parse(sendFailures), recipients: JSON.parse(recipientFailures),
        providerCalls: provider.calls.length, interceptReady: preloaded.ready,
      });
    }
    check(provider.calls.length === 1, `Expected exactly one real API transport send; intercepted ${provider.calls.length}.`);
    const call = provider.calls[0];
    check(call.response.status === 202 && call.fakeKeyAccepted && call.parsedTo.length === 1
      && call.parsedTo[0] === expectedRecipient && call.parsedReplyTo === syntheticReplyTo
      && call.allRecipientsSynthetic, "Local SendGrid transport did not validate the single synthetic To/Reply-To and 202.");
    const childTransportRows = readFileSync(join(output, "sendgrid-child-transport.ndjson"), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
    check(childTransportRows.length === 1 && childTransportRows[0].host === "api.sendgrid.com"
      && childTransportRows[0].path === "/v3/mail/send", "Compiled API transport hook was not called exactly once for the expected SendGrid endpoint.");
    guardProof.liveLaunch = { status: launched.response.status(), body: launched.body, transportCalls: provider.calls.length, providerStatus: call.response.status };
    atomicJson(join(output, "campaign-approval-audience-guards.json"), guardProof);

    const sendState = JSON.parse(fixture.query(`SELECT row_to_json(q) FROM (
      SELECT c.id AS campaign_id,c.status AS campaign_status,l.id AS launch_id,l.status AS launch_status,
      l.sent_count,(SELECT count(*) FROM campaign_recipients r WHERE r.launch_id=l.id AND r.status='sent') AS recipient_sent,
      (SELECT count(*) FROM email_sends e WHERE e.campaign_launch_id=l.id AND e.status='sent') AS email_sends_sent,
      (SELECT min(to_email) FROM email_sends e WHERE e.campaign_launch_id=l.id) AS to_email,
      (SELECT min(sendgrid_message_id) FROM email_sends e WHERE e.campaign_launch_id=l.id) AS provider_message_id
      FROM campaigns c JOIN campaign_launches l ON l.campaign_id=c.id WHERE c.id=${campaignId}) q`));
    check(sendState.campaign_status === "completed" && sendState.launch_status === "completed"
      && Number(sendState.sent_count) === 1 && Number(sendState.recipient_sent) === 1
      && Number(sendState.email_sends_sent) === 1 && sendState.to_email === expectedRecipient,
    `Database send ledger did not record the intercepted one-recipient send: ${JSON.stringify(sendState)}`);
    atomicJson(join(output, "one-recipient-launch-db-verification.json"), {
      database: dbName, campaignId, verification: sendState, providerMessageId: call.response.headers["x-message-id"],
      actualApiRouteUsed: true, actualCompiledSendGridClientUsed: true, senderUnitMockUsed: false,
    });
    await adminContext.close();

    // Seed historical Campaign 5 from the already-pinned fixture after the
    // one-recipient live send; these rows are separate read-only UI evidence.
    await seedHistoricalCampaign5(fixture, output, process.env.DATABASE_URL);

    // Exactly one non-admin role scope: Manager navigation/read path only.
    const manager = await captureManagerPages(browser, fixture, output, fixture.url);
    check(manager.resultsBody.counts.sent === 13, "Campaign 5 Results API did not report Sent 13.");
    atomicJson(join(output, "focused-run-result.json"), {
      status: "passed", checks: [
        "one approved single-recipient API launch through local SendGrid transport interceptor",
        "Manager HTTP error-status audit for Leads, Lead Detail, Deals, Campaigns, Campaign 5 Results",
        "Campaign 5 historical Results Sent 13 via real API/UI and screenshot",
      ],
      targetGithubCommit: finalGithubCommit, fixtureDatabase: dbName, historicalSends: 13,
      providerTransportCalls: provider.calls.length, managerUnexpectedStatuses: 0,
    });
  } catch (error) {
    runError = safeText(error.stack ?? error, 6000);
    atomicJson(join(output, "failure.json"), { status: "failed", message: runError, providerCalls: provider.calls.length, at: new Date().toISOString() });
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (fixture) {
      try { await fixture.close(); fixtureClosed = true; }
      catch (error) { cleanupError = safeText(error.message); }
    }
    const databaseAbsent = dbName ? (() => {
      const result = spawnSync("psql", [
        `--dbname=${process.env.DATABASE_URL}`, "--no-psqlrc", "--tuples-only", "--no-align", "--set=ON_ERROR_STOP=on",
        "--command", `SELECT NOT EXISTS (SELECT 1 FROM pg_database WHERE datname=${q(dbName)});`,
      ], { cwd: root, encoding: "utf8" });
      return result.status === 0 && result.stdout.trim() === "t";
    })() : false;
    const absentUsers = [];
    for (const id of createdUsers) {
      try { await require("@clerk/express").clerkClient.users.getUser(id); absentUsers.push({ id, absent: false }); }
      catch (error) { absentUsers.push({ id, absent: Number(error?.status) === 404 || /not found/i.test(String(error?.message)) }); }
    }
    atomicJson(join(output, "cleanup-verification.json"), {
      fixtureClosed, fixtureDatabaseAbsent: databaseAbsent,
      syntheticUsersCreated: createdUsers.length, syntheticUsersAbsent: absentUsers,
      allSyntheticUsersAbsent: absentUsers.length === createdUsers.length && absentUsers.every((x) => x.absent),
      cleanupError, verifiedAt: new Date().toISOString(),
    });
    await new Promise((resolve) => provider.server.close(resolve));
    process.env.NODE_OPTIONS = priorNodeOptions;
    for (const key of ["FOCUSED_SENDGRID_PORT", "FOCUSED_SENDGRID_READY_PATH", "FOCUSED_SENDGRID_TRANSPORT_LOG",
      "FOCUSED_APP_URL", "FOCUSED_PROVIDER_READY_PATH", "FOCUSED_LAUNCH_GATE_FILE"]) delete process.env[key];
    clerkClient.users.createUser = originalCreateUser;
  }
  if (runError) throw new Error(`${runError}\nOutput: ${output}`);
  check(fixtureClosed && cleanupError === null, `Disposable fixture cleanup failed. Output: ${output}`);
  console.log(JSON.stringify({ status: "passed", outputDirectory: output, chromium: systemChromium }, null, 2));
}

if (process.argv.includes("--check-ready-only")) {
  const ready = await readyProof();
  const preparationDir = join(reportDir, "preparation");
  mkdirSync(preparationDir, { recursive: true });
  const derivative = createSandboxDerivative(preparationDir,
    join(preparationDir, "sendgrid-interceptor-ready.json"),
    join(preparationDir, "sendgrid-provider-ready.json"),
    join(preparationDir, "single-campaign-launch-gate.json"));
  const derivativeCheck = spawnSync(process.execPath, ["--check", derivative], { cwd: root, encoding: "utf8" });
  for (const key of ["FOCUSED_SENDGRID_READY_PATH", "FOCUSED_PROVIDER_READY_PATH", "FOCUSED_LAUNCH_GATE_FILE"]) delete process.env[key];
  check(derivativeCheck.status === 0, `Derived sandbox syntax check failed: ${safeText(derivativeCheck.stderr, 2000)}`);
  const proof = {
    status: "PREPARED; no browser, Clerk user, fixture, or API child launched",
    targetGithubCommit: finalGithubCommit, mainMustIndependentlyPinAndStart: true,
    pushReceipt: { parent: ready.pushReceipt.parent, commit: ready.pushReceipt.commit, verified: ready.pushReceipt.verified, published: ready.pushReceipt.published },
    sourceBinding: { candidate: ready.binding.candidate, sourceFilesMatched: ready.binding.sourceFilesMatched },
    sourceAndBuildPinsVerified: true, priorFrozenBuildPins: ready.actual,
    derivativeSandboxSha256: shaFile(derivative),
    derivativeSandboxSyntaxCheck: "passed; narrow filesystem import patched in the report-local derivative",
    systemChromium, runnerSha256: shaFile(join(reportDir, "focused-final-8622188-runner.mjs")),
    transportInterceptorSha256: shaFile(transportHook),
    exactPrepareCommand: "node reports/focused-final-8622188/focused-final-8622188-runner.mjs --check-ready-only",
    exactLaunchCommand: "node reports/focused-final-8622188/focused-final-8622188-runner.mjs --run",
  };
  atomicJson(join(reportDir, "prepared-source-proof.json"), proof);
  console.log(JSON.stringify(proof, null, 2));
} else if (process.argv.includes("--run")) {
  await runFocused();
} else {
  console.log("Usage: node reports/focused-final-8622188/focused-final-8622188-runner.mjs --check-ready-only | --run");
  process.exitCode = 2;
}
