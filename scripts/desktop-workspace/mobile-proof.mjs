import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { resolve } from "node:path";

const output = "reports/desktop-workspace-release";
const root = resolve("artifacts/mbs-crm-mobile/static-build");
const host = "app.my-business-solutions.com";
const platforms = [];
for (const platform of ["ios", "android"]) {
  const manifestBytes = await readFile(`${root}/${platform}/manifest.json`);
  const manifest = JSON.parse(manifestBytes);
  const url = new URL(manifest.launchAsset.url);
  assert.equal(url.host, host);
  const bundle = await readFile(`${root}${url.pathname}`);
  const text = bundle.toString("utf8");
  assert.ok(text.includes(`"https://${host}"`), `${platform}: compiled API origin missing`);
  assert.ok(!text.includes("mbs-arslandin.replit.app"), `${platform}: obsolete host baked in`);
  platforms.push({
    platform, manifestSha256: createHash("sha256").update(manifestBytes).digest("hex"),
    bundleSha256: createHash("sha256").update(bundle).digest("hex"),
    bytes: bundle.length, launchAssetOrigin: url.origin,
    compiledApiOrigin: `https://${host}`, obsoleteHostPresent: false,
  });
}
await mkdir(output, { recursive: true });
await writeFile(`${output}/mobile-build-proof.json`, JSON.stringify({
  passed: true, platforms, developmentWorkflowChanged: false,
  reproduction: "EXPO_PUBLIC_DOMAIN=app.my-business-solutions.com METRO_PORT=<free port> pnpm --filter @workspace/mbs-crm-mobile run build && node scripts/desktop-workspace/mobile-proof.mjs",
}, null, 2));
console.log("MOBILE RELEASE HOST PASS — iOS and Android manifests and compiled API origins");