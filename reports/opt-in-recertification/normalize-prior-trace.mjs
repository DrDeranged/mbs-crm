import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const dir = join(root, "reports/opt-in-recertification");
const httpRaw = JSON.parse(await readFile(join(dir, "prior-candidate-http-errors.json"), "utf8"));
const consoleRaw = JSON.parse(await readFile(join(dir, "prior-candidate-console-errors.json"), "utf8"));
const summary = JSON.parse(await readFile(join(dir, "prior-candidate-diagnostic-summary.json"), "utf8"));
const used = new Set(), http = [];
const keyFor = row => JSON.stringify([row.role,row.phase,row.method,row.url?.origin,row.url?.path,row.url?.query,row.status,row.pagePathAtInitiation]);
for (const cdp of httpRaw.filter(row => row.cdpRequestId)) {
  const key = keyFor(cdp), t = Date.parse(cdp.responseObservedAt);
  const companions = httpRaw.filter(row => !row.cdpRequestId && !used.has(row.eventId) && keyFor(row) === key
    && Math.abs(Date.parse(row.responseObservedAt) - t) <= 1000);
  const companion = companions.sort((a,b) => Math.abs(Date.parse(a.responseObservedAt)-t)-Math.abs(Date.parse(b.responseObservedAt)-t))[0];
  if (companion) used.add(companion.eventId);
  http.push({
    ...cdp, eventId: `response-${cdp.cdpRequestId}`,
    instrumentationRecordsMerged: companion ? [cdp.eventId, companion.eventId] : [cdp.eventId],
    reason: companion?.reason ?? cdp.reason,
    traceNote: companion ? "one Chromium CDP response and its matching Playwright response event; merged, not two HTTP requests" : "CDP response; no Playwright companion observed",
  });
}
for (const row of httpRaw.filter(row => !row.cdpRequestId && !used.has(row.eventId))) {
  http.push({ ...row, eventId: `response-${row.eventId}`, instrumentationRecordsMerged: [row.eventId],
    traceNote: "Playwright response without matching Chromium CDP event" });
}
http.sort((a,b) => Date.parse(a.responseObservedAt)-Date.parse(b.responseObservedAt));
const console = consoleRaw.map(entry => {
  const status = Number(entry.message.match(/\b(403|404|503)\b/)?.[1] ?? 0);
  const loc = entry.location?.url;
  if (!status || !loc) return { ...entry, correlation: { confidence: "no status or exact console location URL available" } };
  const t = Date.parse(entry.observedAt);
  const endpointCandidates = http.filter(row => row.status === status && row.role === entry.role
    && row.url?.origin === loc.origin && row.url?.path === loc.path
    && Math.abs(Date.parse(row.responseObservedAt) - t) <= 2000);
  const samePageCandidates = endpointCandidates.filter(row => row.pagePathAtInitiation === entry.pagePathAtConsole);
  const candidates = samePageCandidates.length ? samePageCandidates : endpointCandidates;
  const sorted = [...candidates].sort((a,b) =>
    Math.abs(Date.parse(a.responseObservedAt)-t)-Math.abs(Date.parse(b.responseObservedAt)-t));
  return { ...entry, correlation: {
    status, consoleLocationMatchesResponsePath: true,
    pageMatchedInitiation: samePageCandidates.length > 0,
    candidateResponseIds: sorted.map(row => row.eventId),
    confidence: sorted.length === 1 ? (samePageCandidates.length ? "unique exact URL+status+role+initiating-page response in +/-2s" : "unique exact URL+status+role response in +/-2s; page changed before console event") :
      sorted.length === 0 ? "no matching response within +/-2s" : "ambiguous: multiple exact URL+status+role responses in +/-2s",
    candidates: sorted.map(row => ({
      eventId: row.eventId, method: row.method, url: row.url, phaseAtInitiation: row.phase,
      pagePathAtInitiation: row.pagePathAtInitiation, responseReason: row.reason,
      pagePathAtConsoleDiffersFromInitiation: row.pagePathAtInitiation !== entry.pagePathAtConsole,
    })),
  } };
});

const classes = [
  {
    id: "fixture-twilio-token-no-credentials", status: 503, method: "POST", origin: "http://127.0.0.1:4320", path: "/api/twilio/token",
    classification: "expected fixture missing credential; not a candidate product defect",
    reason: "Every response body says Twilio token unavailable / missing:TWILIO_ACCOUNT_SID. startSandbox intentionally strips TWILIO_* from the isolated API child. These are token requests only; no call or send was triggered.",
  },
  {
    id: "fixture-owned-number-lookup-no-credentials", status: 503, method: "GET", origin: "http://127.0.0.1:4320", path: "/api/settings/telephony/owned-numbers",
    classification: "expected fixture missing credential; not a candidate product defect",
    reason: "Admin Settings response says Twilio owned-number lookup unavailable. Source route calls listOwnedTwilioNumbers, which returns this error when TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN is absent; fixture deliberately strips both.",
  },
  {
    id: "fixture-lead-has-no-application", status: 404, method: "GET", origin: "http://127.0.0.1:4320", path: "/api/leads/[REDACTED_ID]/application",
    classification: "expected synthetic fixture absence; not a candidate product defect",
    reason: "Response body says No application on file. The seeded Synthetic Contact fixture lead has no application record; all three role visits to the detail page made this normal absence request.",
  },
  {
    id: "rep-user-list-forbidden", status: 403, method: "GET", origin: "http://127.0.0.1:4320", path: "/api/users",
    classification: "API authorization rejection is expected; client requests are an actionable defect",
    reason: "Response body says Forbidden and the API route allows only admin/manager. The candidate UI nevertheless issues useListUsers requests for rep role on Leads, Lead Detail, Deals, and Settings (4 responses). Gate these calls by role or remove them where reps do not need the data; do not weaken the API authorization.",
    followup: "This is a confirmed defect in the immutable 853f4e4 candidate. The requester reports current source fixes at 5221ff2c54d908c2c2a06bd2e7fa6da55aa627de; do not treat this old-candidate trace as proof that the fix works. Final browser certification must verify the role-gated requests do not recur.",
    oldCandidateCallSites: "leads.tsx:546, lead-detail/header.tsx:24, deals.tsx:184, settings.tsx:34.",
  },
];
const classified = http.map(row => {
  const c = classes.find(item => item.status === row.status && item.method === row.method
    && item.origin === row.url?.origin && item.path === row.url?.path);
  return { eventId: row.eventId, role: row.role, phase: row.phase, pagePathAtInitiation: row.pagePathAtInitiation,
    method: row.method, url: row.url, status: row.status, statusText: row.statusText, responseReason: row.reason,
    initiator: row.initiator, classification: c?.classification ?? "unclassified; investigate before certification",
    evidence: c?.reason ?? "No classification rule matched; preserve as a potential defect." };
});
const statusCounts = Object.fromEntries([403,404,503].map(status => [status, http.filter(row => row.status === status).length]));
const correlationCounts = {
  unique: console.filter(row => row.correlation?.confidence?.startsWith("unique")).length,
  ambiguous: console.filter(row => row.correlation?.confidence?.startsWith("ambiguous")).length,
  unmatched: console.filter(row => row.correlation?.confidence?.startsWith("no matching")).length,
  noHttpStatusOrLocation: console.filter(row => row.correlation?.confidence?.startsWith("no status")).length,
};
const normalized = {
  source: "trace of immutable prior candidate; raw console texts are retained only in the sanitized raw artifact; normalized HTTP events merged by CDP requestId with Playwright response companions",
  build: summary.build, visits: summary.visits, campaign: summary.campaignResults,
  rawInstrumentationRecords: httpRaw.length, uniqueHttpResponses: http.length, statusCounts,
  consoleEvents: console.length, consoleCorrelationCounts: correlationCounts,
  pageExceptions: JSON.parse(await readFile(join(dir, "prior-candidate-page-errors.json"), "utf8")).length,
  classifications: classes,
  httpResponses: http, consoleEventsDetailed: console, classifiedResponses: classified,
  limitations: [
    "Only the reproduced candidate trace has response URLs. The original 229 console records had no URL fields and cannot be retroactively assigned exact endpoints.",
    "Console location URL is used as an exact endpoint clue; delayed console reports can occur after route navigation. Those with multiple nearby identical endpoint responses remain explicitly ambiguous.",
    "The diagnostic used serviceWorkers='block' as the earlier structural harness did; the old candidate's SW registration TypeError is a harness-induced console error. The later Main guard fix is not present in this immutable build and must be checked against the new build.",
    "The old candidate's rep-only /api/users 403 is an avoidable client request, although the server authorization response is correct. Per requester, a source fix is present at 5221ff2c54d908c2c2a06bd2e7fa6da55aa627de; the final browser run is pending separate user approval about disappearance of Retry controls from the archived inventory.",
  ],
};
await writeFile(join(dir, "prior-candidate-http-errors-normalized.json"), JSON.stringify(http, null, 2));
await writeFile(join(dir, "prior-candidate-console-correlations-normalized.json"), JSON.stringify(console, null, 2));
await writeFile(join(dir, "prior-candidate-classification.json"), JSON.stringify(normalized, null, 2));
