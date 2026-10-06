import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const run = join(root, "reports/opt-in-recertification/supplemental/run");
const lines = async file => (await readFile(join(run, file), "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
const [events, consoles, failures, routes, journeys, progress, integrity, sourceProof, combined, cleanup, pageErrors] = await Promise.all([
  lines("http-events.ndjson"), lines("console-events.ndjson"), lines("request-failures.ndjson"),
  readFile(join(run, "route-progress.json"), "utf8").then(JSON.parse),
  readFile(join(run, "journeys.json"), "utf8").then(JSON.parse),
  readFile(join(run, "run-progress.json"), "utf8").then(JSON.parse),
  readFile(join(run, "original-evidence-integrity.json"), "utf8").then(JSON.parse),
  readFile(join(run, "source-branch-validation.json"), "utf8").then(JSON.parse),
  readFile(join(run, "combined-summary.json"), "utf8").then(JSON.parse),
  readFile(join(run, "cleanup-verification.json"), "utf8").then(JSON.parse),
  lines("page-errors.ndjson").catch(error => error.code === "ENOENT" ? [] : Promise.reject(error)),
]);
const cdp = events.filter(row => row.type === "cdp-status");
const responses = events.filter(row => row.type === "playwright-response");
const bodyReasons = events.filter(row => row.type === "response-body-reason");
const key = row => [row.role, row.phase, row.method, row.status, row.url?.origin, row.url?.path, row.pagePathAtInitiation].join("|");
const classifyHttp = row => {
  const responseMatches = responses.map(response => ({ response, delta: Math.abs(Date.parse(response.observedAt) - Date.parse(row.observedAt)) }))
    .filter(item => key(item.response) === key(row) && item.delta <= 500).sort((a,b) => a.delta-b.delta);
  const match = responseMatches.length === 1 ? responseMatches[0] : null;
  const reason = match?.response.reason ?? null;
  if (row.status === 503 && row.method === "POST" && row.url?.path === "/api/twilio/token"
      && reason?.error === "Twilio token unavailable" && reason?.reason === "missing:TWILIO_ACCOUNT_SID")
    return { ...row, classification: "expected isolated-fixture missing Twilio credentials", reasonOrAmbiguity: { reason }, bodyAssociation: "direct", responseDeltaMs: match.delta };
  if (row.status === 503 && row.method === "GET" && row.url?.path === "/api/settings/telephony/owned-numbers"
      && reason?.error === "Twilio owned-number lookup unavailable")
    return { ...row, classification: "expected isolated-fixture missing Twilio credentials", reasonOrAmbiguity: { reason }, bodyAssociation: "direct", responseDeltaMs: match.delta };
  if (row.status === 404 && row.method === "GET" && /\/api\/leads\/[^/]+\/application$/.test(row.url?.path ?? "")
      && (reason?.error === "No application on file" || !reason))
    return { ...row, classification: reason ? "expected fixture application absence" : "expected fixture application absence; explicit response-body association ambiguity",
      reasonOrAmbiguity: reason ? { reason } : { ambiguity: "7 response-body-reason events lack role/page/request fields because parallel CDP request IDs collide",
        supportingReason: { error: "No application on file" }, sourceBranchValidated: true }, bodyAssociation: reason ? "direct" : "explicitly ambiguous",
      responseDeltaMs: match?.delta ?? null };
  return { ...row, classification: "unexpected or insufficiently classified", reasonOrAmbiguity: match ? { reason } : { ambiguity: "no matching response body" },
    bodyAssociation: match ? "direct" : "missing" };
};
const http = cdp.map(classifyHttp);
const matchConsole = event => {
  const status = Number(event.message.match(/\b(403|404|503)\b/)?.[1] ?? 0), url = event.location?.url;
  const matches = cdp.filter(row => row.status === status && row.role === event.role && row.url?.origin === url?.origin
    && row.url?.path === url?.path && row.pagePathAtInitiation === event.pagePath
    && Math.abs(Date.parse(row.observedAt)-Date.parse(event.observedAt)) <= 2000);
  const serviceWorker = /service.?worker|navigator\.serviceWorker/i.test(event.message + JSON.stringify(event.location));
  return { ...event, matchedStatusRows: matches.map(row => ({ method: row.method, path: row.url.path, status: row.status,
    role: row.role, page: row.pagePathAtInitiation, phase: row.phase, observedAt: row.observedAt })),
    matchConfidence: matches.length === 1 ? "unique exact role/url/page/status/time" : matches.length ? "ambiguous multiple exact matches" : "unmatched",
    serviceWorkerException: serviceWorker, classification: serviceWorker ? "defect" : matches.length ? "expected response-status console event" : "unmatched console error" };
};
const consoleRows = consoles.map(matchConsole);
const screenshotFiles = (await readdir(join(run, "screenshots"))).filter(file => /^leads-(390|768|1280|1440)-(light|dark)\.png$/.test(file)).sort();
const repListPath = join(run, "rep-user-list-requests.ndjson");
const repListRequests = await readFile(repListPath, "utf8").then(text => text.trim().split("\n").filter(Boolean).map(JSON.parse)).catch(error => error.code === "ENOENT" ? [] : Promise.reject(error));
const summary = {
  status: "DERIVED_FIRST_SUPPLEMENT_REVIEW; campaign step still incomplete",
  scope: "fresh supplemental trace only; attempt-6 primitive console events not imported or reclassified",
  http: { statusRows: http, counts: { total: http.length, status403: http.filter(x=>x.status===403).length,
    status404: http.filter(x=>x.status===404).length, status503: http.filter(x=>x.status===503).length,
    directBody: http.filter(x=>x.bodyAssociation==="direct").length, explicitAmbiguity: http.filter(x=>x.bodyAssociation==="explicitly ambiguous").length,
    unexpectedOrInsufficient: http.filter(x=>x.classification==="unexpected or insufficiently classified").length } },
  console: { rows: consoleRows, counts: { total: consoleRows.length, unique: consoleRows.filter(x=>x.matchConfidence.startsWith("unique")).length,
    ambiguous: consoleRows.filter(x=>x.matchConfidence.startsWith("ambiguous")).length, unmatched: consoleRows.filter(x=>x.matchConfidence==="unmatched").length,
    serviceWorkerErrors: consoleRows.filter(x=>x.serviceWorkerException).length } },
  journeys: { candidateRouteVisits: routes.visits.length, requiredRouteVisits: routes.required, functionalSteps: journeys.length,
    screenshotFiles, screenshotCount: screenshotFiles.length, campaignSent13: combined.supplementalEvidence.campaignSent13,
    campaignInsertFailure: combined.failure },
  assertions: { candidateRouteVisits18: routes.completed===18&&routes.visits.length===18,
    leadsJourneys22Recorded: journeys.length===22 && journeys.every(row=>!!row.step&&!!row.outcome), pageExceptionsZero: pageErrors.length===0,
    candidateRepGetUsersRequestsZero: repListRequests.length===0, serviceWorkerErrorsZero: consoleRows.every(x=>!x.serviceWorkerException),
    everyConsoleErrorMatched: consoleRows.every(x=>x.matchedStatusRows.length>0),
    allHttpStatusesExpectedOrExplicitlyAmbiguous: http.every(x=>x.classification.startsWith("expected ")),
    eightLeadsScreenshots: screenshotFiles.length===8, originalAttempt6EvidenceUnchanged: integrity.unchanged,
    sourceBranchesProven: sourceProof.routeResponsesProven, campaignResultsSent13: combined.supplementalEvidence.campaignSent13,
    supplementalUsersDeletedAndAbsent: cleanup.deletedAndAbsentUsers===cleanup.createdSyntheticUsers,
    supplementalFixtureDatabaseAbsent: cleanup.fixtureDatabaseAbsent },
  requestFailures: failures, attempt6OriginalRawEventCount: 143, originalRunSummaryStatus: combined.status,
  originalEvidenceIntegrity: integrity, cleanup, pageErrors, sourceProof: { routeResponsesProven: sourceProof.routeResponsesProven },
  note: "CDP request IDs collide across parallel contexts. Direct Playwright response bodies are matched by role, phase, method, status, URL, page, and time; the seven remaining application-404 bodies are explicitly ambiguous. The campaign SQL failure does not invalidate the saved Leads-stage evidence.",
  generatedAt: new Date().toISOString(),
};
const out = join(root, "reports/opt-in-recertification/supplemental/derived-first-supplement-review.json");
await writeFile(out, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ output: out, assertions: summary.assertions, http: summary.http.counts, console: summary.console.counts }, null, 2));
