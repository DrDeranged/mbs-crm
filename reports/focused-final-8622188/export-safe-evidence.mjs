// Export the passed focused run without publishing fixture auth resources or
// signed unsubscribe links. The unmodified run stays local for audit.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const reportDir = import.meta.dirname;
const runName = process.argv[2];
if (!/^run-2026-10-06T[\d-]+Z-\d+$/.test(runName ?? "")) {
  throw new Error("Provide the exact passed focused-run directory name.");
}
const run = resolve(reportDir, "runs", runName);
const exportDir = join(reportDir, "export");
const source = JSON.parse(readFileSync(join(run, "focused-run-result.json"), "utf8"));
if (source.status !== "passed" || source.targetGithubCommit !== "862218809a23c7f4d4adc748f07d74534746fb6d") {
  throw new Error("Only the passed final-build run may be exported.");
}
mkdirSync(exportDir, { recursive: true });
const hash = (value) => createHash("sha256").update(value).digest("hex");
const manifest = { sourceRun: basename(run), targetGithubCommit: source.targetGithubCommit, files: [] };

function save(name, sourceBytes, value, redactions) {
  const bytes = Buffer.from(value);
  writeFileSync(join(exportDir, name), bytes);
  manifest.files.push({
    path: `reports/focused-final-8622188/export/${name}`,
    source: `reports/focused-final-8622188/runs/${runName}/${name}`,
    originalSha256: hash(sourceBytes), exportedSha256: hash(bytes),
    redactions,
  });
}
for (const name of ["manager-pwr-statuses.ndjson", "manager-cdp-statuses.ndjson"]) {
  const raw = readFileSync(join(run, name));
  let redactions = 0;
  const rows = raw.toString().trim().split("\n").map((line) => {
    const row = JSON.parse(line);
    const field = name.startsWith("manager-cdp") ? "url" : "path";
    const old = row[field];
    // Browser devtools may report a Clerk-authenticated resource with an
    // opaque credential in the URL path; data URLs add no HTTP-status evidence.
    const next = /(?:base64,|^data:)/i.test(old) ? "[REDACTED_DATA_URL]"
      : old.replace(/[A-Za-z0-9_-]{60,}/g, "[REDACTED_OPAQUE_RESOURCE]");
    if (next !== old) redactions++;
    row[field] = next;
    return row;
  });
  if (rows.some((row) => [403, 404, 503].includes(row.status))) {
    throw new Error(`Unexpected HTTP error status in ${name}`);
  }
  save(name, raw, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", redactions);
}

const providerName = "sendgrid-raw-transport.ndjson";
const providerRaw = readFileSync(join(run, providerName));
const providerRows = providerRaw.toString().trim().split("\n").map(JSON.parse);
if (providerRows.length !== 1) throw new Error("Expected one intercepted outbound request.");
let signedLinksRedacted = 0;
for (const row of providerRows) {
  row.rawRequestBody = row.rawRequestBody.replace(/([?&](?:amp;)?token=)[A-Za-z0-9._~%-]+/gi, (_match, prefix) => {
    signedLinksRedacted++;
    return `${prefix}[REDACTED_SIGNED_LINK_TOKEN]`;
  });
  row.exportNote = "Original HTTP body except signed unsubscribe-token values, redacted before GitHub push.";
  if (row.parsedTo?.length !== 1 || row.parsedTo[0] !== "contact@example.invalid" ||
      row.parsedReplyTo !== "synthetic-replies@example.invalid" || row.response?.status !== 202) {
    throw new Error("Provider receipt does not match the passed one-recipient send.");
  }
}
if (!signedLinksRedacted || providerRows.some((row) => /token=[A-Za-z0-9._~%-]+/.test(row.rawRequestBody))) {
  throw new Error("Signed links were not completely redacted.");
}
save(providerName, providerRaw, providerRows.map((row) => JSON.stringify(row)).join("\n") + "\n", signedLinksRedacted);

const apiName = "campaign-api-status.ndjson";
const apiRaw = readFileSync(join(run, apiName));
const apiRows = apiRaw.toString().trim().split("\n").map(JSON.parse);
let previewTokensRedacted = 0;
for (const row of apiRows) {
  if (row.body?.previewToken) {
    row.body.previewToken = "[REDACTED_DISPOSABLE_PREVIEW_TOKEN]";
    previewTokensRedacted++;
  }
}
save(apiName, apiRaw, apiRows.map((row) => JSON.stringify(row)).join("\n") + "\n", previewTokensRedacted);

const cleanupName = "cleanup-verification.json";
const cleanupRaw = readFileSync(join(run, cleanupName));
const cleanup = JSON.parse(cleanupRaw);
if (!cleanup.fixtureDatabaseAbsent || !cleanup.allSyntheticUsersAbsent) throw new Error("Fixture cleanup incomplete.");
cleanup.syntheticUsersAbsent = cleanup.syntheticUsersAbsent.map(({ absent }) => ({ id: "[DELETED_FIXTURE_USER]", absent }));
save(cleanupName, cleanupRaw, JSON.stringify(cleanup, null, 2) + "\n", cleanup.syntheticUsersAbsent.length);
writeFileSync(join(exportDir, "export-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({
  sourceRun: runName, targetGithubCommit: source.targetGithubCommit, exported: manifest.files.length,
  signedLinksRedacted, previewTokensRedacted,
  managerRedactions: manifest.files.filter((f) => f.path.includes("manager-")).map((f) => [basename(f.path), f.redactions]),
  fixtureUsersRedacted: cleanup.syntheticUsersAbsent.length,
}, null, 2));
