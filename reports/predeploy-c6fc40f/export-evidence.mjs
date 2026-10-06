import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, relative, dirname } from "node:path";
const source = "reports/predeploy-c6fc40f";
const destination = "/tmp/predeploy-c6fc40f-evidence-export";
const records = [];
const skipped = [];
const redactions = [];
function sanitize(text) {
  return text
    .replace(/("[A-Za-z0-9_]*(?:secret|password|(?:private|signing|transport|api|encryption)_?key|(?:access|refresh|session|auth)_?token)"\s*:\s*")[^"]*"/gi, '$1[REDACTED]"')
    .replace(/("(?:authorization|cookie)"\s*:\s*")[^"]*"/gi, '$1[REDACTED]"')
    .replace(/(?:sk|pk)_(?:test|live)_[A-Za-z0-9_-]{12,}/g, "[REDACTED_CLERK_KEY]")
    .replace(/SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, "[REDACTED_SENDGRID_KEY]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED_JWT]")
    .replace(/Bearer\s+[A-Za-z0-9._~-]{12,}/gi, "Bearer [REDACTED]")
    .replace(/(postgres(?:ql)?:\/\/)[^@\s]+:[^@\s]+@/gi, "$1[REDACTED_CONNECTION]@")
    .replace(/([?&](?:__clerk_ticket|__clerk_handshake|__clerk_db_jwt|token|ticket|jwt|X-Goog-Signature|X-Amz-Signature|X-Goog-Credential|X-Amz-Credential|signature)=)[^&\s"'<>]+/gi, "$1[REDACTED]")
    .replace(/\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, (email, domain) =>
      /^(?:example\.(?:invalid|com|test)|fixture\.invalid|test\.invalid)$/i.test(domain) ? email : "[REDACTED_EMAIL]")
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[REDACTED_SSN]");
}
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const local = relative(source, path);
    if (entry.isSymbolicLink()) { skipped.push({ path: local, reason: "runtime dependency symlink" }); continue; }
    if (entry.isDirectory()) {
      if (["node_modules", ".local", ".git"].includes(entry.name)) {
        skipped.push({ path: local, reason: "runtime only" }); continue;
      }
      await walk(path);
      continue;
    }
    if (local.startsWith("frozen-builds/") && !/\/(?:current|build-provenance)\.json$/.test("/" + local)) {
      skipped.push({ path: local, reason: "compiled runtime, not evidence; digests retained" }); continue;
    }
    if (/(?:storage[-_]state|cookies|auth[-_]state|session[-_]state|\.sql$|\.dump$|\.backup$)/i.test(local)) {
      skipped.push({ path: local, reason: "private state or database export" }); continue;
    }
    const original = await readFile(path);
    let bytes = original;
    if (/\.(?:json|ndjson|log|txt|md|html|csv)$/i.test(local)) {
      const cleaned = sanitize(original.toString("utf8"));
      bytes = Buffer.from(cleaned);
      if (!bytes.equals(original)) redactions.push(local);
    }
    const output = join(destination, local);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, bytes);
    records.push({ path: `${source}/${local}`, bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex") });
  }
}
await mkdir(destination, { recursive: true });
await walk(source);
const manifest = {
  sourceCommit: "c6fc40fa76880972ad2d8b1226ef0fb45c5890ca",
  productionChanged: false, productCodeChanged: false, published: false,
  redactionPolicy: "Credentials/auth URLs/connection passwords/non-synthetic email addresses/SSNs removed; synthetic fixture addresses retained.",
  redactedFiles: redactions, skippedRuntimeOrPrivateFiles: skipped, files: records,
};
await writeFile(join(destination, "export-manifest.json"), JSON.stringify(manifest, null, 2));
// Make the public export manifest evidence without recursively hashing itself.
const manifestBytes = await readFile(join(destination, "export-manifest.json"));
records.push({ path: `${source}/export-manifest.json`, bytes: manifestBytes.length,
  sha256: createHash("sha256").update(manifestBytes).digest("hex") });
await writeFile(join(destination, "upload-manifest.json"), JSON.stringify({ files: records }, null, 2));
console.log(JSON.stringify({ files: records.length, bytes: records.reduce((n, f) => n + f.bytes, 0),
  redactedFiles: redactions.length, skippedFiles: skipped.length }, null, 2));
