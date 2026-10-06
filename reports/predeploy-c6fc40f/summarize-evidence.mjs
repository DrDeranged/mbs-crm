import { readFile, writeFile } from "node:fs/promises";
const root = "reports/predeploy-c6fc40f";
const parse = async p => JSON.parse(await readFile(`${root}/${p}`, "utf8"));
const core = await parse("runs/core-final/reports/nate-workflows/after/assertions.json");
const continuation = await parse("runs/core-resume-role-boundary/reports/nate-workflows/after/assertions.json");
const campaign = await parse("runs/campaign-canonical-fixture-final/campaign5-fixture.json");
const single = await parse("runs/campaign-canonical-fixture-final/one-recipient-campaign.json");
const provenance = await parse("clone-provenance.json");
const source = await parse("source-pin.json");
const fullPreflight = await readFile(`${root}/preflight.raw.log`, "utf8");
const assertions = Object.entries(core.assertions).map(([name, value]) => ({ name, ...value }));
const roleRoutes = Object.entries(continuation.assertions)
  .filter(([name]) => name.includes("/campaigns list route"))
  .map(([name, value]) => ({ name, ...value }));
const errors = {
  targetCommit: source.commit,
  scope: "Authorized browser UI traffic; explicit API security-denial probes are separated below.",
  requiredPages: ["Dashboard", "Leads", "Lead Detail", "Deals", "Campaigns", "Settings"],
  roles: ["admin", "manager", "rep"],
  originalCoreRun: "runs/core-final",
  addedCampaignListRun: "runs/core-resume-role-boundary",
  browserHttpErrors: [...core.httpErrors, ...continuation.httpErrors],
  classifiedHttpResponses: [...core.httpErrors, ...continuation.httpErrors].map(response => ({
    ...response,
    expected: response.context === "behavior-api" && [400, 409].includes(response.status),
    reason: response.context === "behavior-api" && response.status === 400
      ? "Intentional inactive/pending/merged/missing assignment-destination rejection probe."
      : response.context === "behavior-api" && response.status === 409
        ? "Intentional stale campaign approval probe after modifying saved audience."
        : "Requires review; not silently excluded.",
  })),
  prohibitedDirectoryRequests: [...core.prohibitedRequests, ...continuation.prohibitedRequests],
  campaignListRoleChecks: roleRoutes,
  unrelatedConsoleMessages: core.consoleErrors,
  consoleMessageLimitation: "Six retained Radix DialogContent/DialogTitle accessibility console messages. The original collector did not associate them with pages; no page attribution is invented. They are not HTTP 4xx/5xx.",
  explicitSecurityApiProbes: assertions.filter(a => /forbidden from directory|inactive\/pending\/merged/.test(a.name)),
};
await writeFile(`${root}/browser-error-ledger.json`, JSON.stringify(errors, null, 2));
await writeFile(`${root}/functional-assertions.raw.json`, JSON.stringify({
  targetCommit: source.commit, originalBehaviorComplete: core.behaviorComplete,
  coreAssertions: assertions, continuationAssertions: continuation.assertions,
}, null, 2));
const items = [
  { item: 1, status: "FAIL", detail: "All 11 CLI gates PASS, exit 0; ledger 68, no pending migrations. The clone was schema-only, not an actual production backup. Read-only production ledger was 66; only 067–068 remain.", evidence: ["preflight.raw.log", "preflight-tail.txt", "clone-provenance.json", "migration-ledger-readonly.json"] },
  { item: 2, status: "FAIL", detail: "36/36 not established. Original comparison has 74 failures. Offline classification separates fixture/capture-plan issues; 27 Open softphone and six Apply-label discrepancies remain unproven exceptions. No allowlist was widened.", evidence: ["structure-delta-classification.md", "structure-delta-classification.json", "structure-raw-deltas.json", "runs/structure-final/reports/nate-workflows/control-review.json"] },
  { item: 3, status: "FAIL", detail: "Partial: six active eligible admin/manager/rep users, self included; inactive/pending/merged rejected; all eligible destinations and self persist through assignment APIs; admin/manager Lead-header UI self/other assignment passes; rep directory UI requests and assignee controls absent. Each of all five requested picker inventories/self-save paths was not individually completed in the browser.", evidence: ["functional-assertions.raw.json", "runs/core-final/reports/nate-workflows/after/controls.json"] },
  { item: 4, status: "FAIL", detail: "Partial: API identity checks and desktop Deals list/Pipeline/header captured. Referral matching did not pass in the continuation; Cmd-K and notification checks were not completed. No whole-request naming certification.", evidence: ["core-final.raw.log", "core-resume-role-boundary.raw.log", "functional-assertions.raw.json"] },
  { item: 5, status: "FAIL", detail: "Partial: US Fund Advisor=2, vendor_list=30, prospect_list=1, Website=1; exact selected-ID bulk assignment updated and persisted exactly two fixtures; manager/admin bulk UI and rep absence checked. Source-filter UI/requests exercised vendor_list, not the specifically requested USFA-only result set; that exact case remains unverified.", evidence: ["functional-assertions.raw.json"] },
  { item: 6, status: "PASS", detail: "Three Deals options, All/open/exclude-open preview behavior, picked-lead filtering/deduplication, closed/hold/archived/no-deal exclusion from open membership, and saved-rule approval invalidation pass.", evidence: ["functional-assertions.raw.json"] },
  { item: 7, status: campaign.verdict === "PASS" && single.verdict === "PASS" ? "PASS" : "FAIL", detail: "Unconfigured parse: one recipient, HTTP201, Sent1/Failed0, configured/captured Reply-To single-campaign-replies@example.invalid. Independent Campaign5 completed 13 fixture sends and Results UI showed13; read-only production Campaign5 also completed with13. Loopback transport only; 14 bounded simulated calls, no actual email/provider or production mutation.", evidence: ["runs/campaign-canonical-fixture-final/one-recipient-campaign.json", "runs/campaign-canonical-fixture-final/sendgrid-captured-body.json", "runs/campaign-canonical-fixture-final/campaign5-fixture.json", "runs/campaign-canonical-fixture-final/campaign5-fixture-results-sent-13.png", "campaign-5-production-readonly.json"] },
  { item: 8, status: errors.browserHttpErrors.length === 0 && roleRoutes.length === 3 && roleRoutes.every(r => r.passed) ? "PASS" : "FAIL", detail: "Required six pages covered across all three roles. Authorized UI 403/404/503: zero; rep Campaigns shows Manager Access Required without an HTTP error. Strict all-4xx/5xx requirement does not pass: the behavior browser deliberately generated twenty400 assignment-rejection responses and one409 stale-approval response; all request paths/pages and expected reasons are retained. Six unrelated accessibility console messages also retained. No unexpected authorized UI HTTP defect identified.", evidence: ["browser-error-ledger.json", "runs/core-final/reports/nate-workflows/after/capture-meta.json", "runs/core-resume-role-boundary/reports/nate-workflows/after/assertions.json"] },
];
const summary = {
  verdict: "NOT READY", targetCommit: source.commit, sourceTree: source.tree,
  verifiedSourceBlobCount: source.files.length,
  fullPreflightCliPassed: /PREFLIGHT PASS\s+AUTHORITATIVE_COMMAND_EXIT=0/.test(fullPreflight),
  actualProductionCloneSatisfied: provenance.sourceKind !== "schema-only",
  productCodeChanged: false, published: false, items,
};
await writeFile(`${root}/summary.json`, JSON.stringify(summary, null, 2));
const report = `# Pre-deploy validation: GitHub main c6fc40f

**Verdict: NOT READY TO PUBLISH.** Validation only. No product code changes or publishing.

Source commit: ${source.commit}; tree: ${source.tree}; ${source.files.length} verified Git blobs. Frozen build provenance is under frozen-builds/current.json and its referenced build-provenance.json. Source was restored byte-for-byte after an environment restart; completed preflight was not rerun or relabelled.

FAIL below can mean an unsatisfied requirement or an incomplete validation, not a confirmed product defect.

| Item | Result | Raw evidence and findings |
|---|---|---|
${items.map(i => `| ${i.item} | **${i.status}** | ${i.detail} Evidence: ${i.evidence.map(p => `[${p}](${p})`).join("; ")} |`).join("\n")}

## Migration rehearsal and production limits

All eleven command-line gates passed. The managed rehearsal metadata explicitly says **sourceKind=schema-only**, therefore it does **not** satisfy the actual-production-clone requirement. Rehearsal applied to ledger68 with no pending migrations and divergence PASS. Read-only production metadata reported66 (through066); development reported68. No production schema/data was changed.

## Interrupted/failed harness attempts

All attempts remain retained. Core-final stopped on an ambiguous two-deal label selector. Continuations encountered an environment restart, absent restored build outputs, Campaigns comparison-button/link ambiguity, the legitimate rep Manager Access Required boundary, and unfinished desktop command-palette/referral checks at a mobile viewport. These attempts are not converted into successful whole-run exits.

The original one-recipient sends failed **before transport** on fixture public-origin validation (first HTTP, then noncanonical HTTPS). The final fixture derives the canonical outbound origin from the pinned production URL policy. Final one-recipient + separate Campaign5 run exited0; no product URL-policy or reply-capture code was changed.

## Full preflight tail

The complete transcript is preflight.raw.log (and preflight-transcript.txt). Tail below includes clone provenance, rehearsal and divergence. Exported copies redact credentials and non-synthetic contact data; export-manifest.json records affected files.

\`\`\`text
${await readFile(`${root}/preflight-tail.txt`, "utf8")}
\`\`\`

## Release blockers

1. Obtain and rehearse an actual production backup/clone; schema-only fallback is insufficient.
2. Establish the requested canonical36/36 mobile comparison without unapproved exceptions.
3. Finish all five individual assignment picker paths, Cmd-K/notification/referral naming, and the specific USFA-only filtering case.

No live send, publishing, or production writes were performed. Final fixture screenshot is campaign5-fixture-results-sent-13.png; the production value is a separately labelled read-only query, not a production-browser capture.
`;
await writeFile(`${root}/REPORT.md`, report);
await writeFile(`${root}/preflight-transcript.txt`, fullPreflight);
console.log(JSON.stringify(summary, null, 2));
